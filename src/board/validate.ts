/**
 * Board validation (§10.3).
 *
 * Runs at the tool bus, before anything is rendered. A rejection is not a
 * crash and not a dropped step — it is an `ok:false` tool result naming the
 * offending field, which the model can read and repair on its next turn. Two
 * failures on the same step escalate to the repairer agent (§17.3).
 *
 * Never silently drop an operation. Telling the model what happened is the
 * whole point; a step that vanishes without explanation teaches the model
 * nothing and the learner less.
 */
import { parse as parseExpr } from 'mathjs';
import { BoardOpSchema, type BoardOp } from './op-schema';
import { estimateOpsHeight, PAGE_H, MAX_STEP_PAGES } from './layout';

export interface ValidateContext {
  /** Op ids already placed on the current page — `annotate` may target these. */
  knownIds?: ReadonlySet<string>;
  /** Figure ids produced by `run_code` this session. */
  knownFigures?: ReadonlySet<string>;
}

export type ValidateResult =
  | { ok: true; ops: BoardOp[] }
  | { ok: false; problems: string[] };

/** Turn a Zod issue into something a model can act on rather than a code trace. */
function describeIssue(index: number, path: (string | number)[], message: string): string {
  const where = path.length ? `.${path.join('.')}` : '';
  return `ops[${index}]${where}: ${message}`;
}

const OP_NAMES =
  'heading, text, math, derive, bullets, code, diagram, plot, vectors, reaction, table, figure, annotate';

export function validateOps(input: unknown, ctx: ValidateContext = {}): ValidateResult {
  const problems: string[] = [];

  if (!Array.isArray(input)) {
    return { ok: false, problems: ['board must be an array of operations'] };
  }
  if (input.length > 12) {
    problems.push(
      `board has ${input.length} operations; a single step may have at most 12. Split this across two steps.`,
    );
  }

  const ops: BoardOp[] = [];
  input.forEach((raw, i) => {
    const parsed = BoardOpSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 3)) {
        if (issue.code === 'invalid_union_discriminator') {
          const got = (raw as { op?: unknown } | null)?.op;
          problems.push(
            `ops[${i}].op: "${String(got)}" is not a board operation. Use one of: ${OP_NAMES}.`,
          );
        } else if (issue.code === 'unrecognized_keys') {
          const keys = issue.keys.map((k) => `"${k}"`).join(', ');
          problems.push(
            describeIssue(
              i,
              issue.path,
              `unknown field(s) ${keys}. The board has no coordinate or styling fields — describe the structure and the renderer places it.`,
            ),
          );
        } else {
          problems.push(describeIssue(i, issue.path, issue.message));
        }
      }
      return;
    }
    ops.push(parsed.data);
  });

  if (problems.length) return { ok: false, problems };

  // Ids this batch introduces are targetable by an annotate later in the batch.
  const idsInBatch = new Set<string>();
  for (const op of ops) if (op.id) idsInBatch.add(op.id);

  ops.forEach((op, i) => {
    switch (op.op) {
      case 'annotate': {
        const known = ctx.knownIds?.has(op.target) || idsInBatch.has(op.target);
        if (!known) {
          problems.push(
            `ops[${i}].target: nothing on the board has id "${op.target}". Give the operation you want to point at an "id", then annotate that id.`,
          );
        }
        break;
      }
      case 'plot': {
        op.fns.forEach((fn, j) => {
          try {
            parseExpr(fn.expr);
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            problems.push(
              `ops[${i}].fns[${j}].expr: "${fn.expr}" is not valid mathjs syntax (${why}). Use mathjs notation, for example "sin(x)/x" or "x^2 - 3*x".`,
            );
          }
        });
        const a = op.domain[0];
        const b = op.domain[1];
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          problems.push(`ops[${i}].domain: both ends must be finite numbers.`);
        } else if (a >= b) {
          problems.push(
            `ops[${i}].domain: [${a}, ${b}] is empty or reversed. Write it low to high.`,
          );
        }
        if (op.range && !(op.range[0] < op.range[1])) {
          problems.push(
            `ops[${i}].range: [${op.range[0]}, ${op.range[1]}] is empty or reversed.`,
          );
        }
        break;
      }
      case 'diagram': {
        const nodeIds = new Set<string>();
        for (const n of op.nodes) {
          if (nodeIds.has(n.id)) {
            problems.push(`ops[${i}].nodes: duplicate node id "${n.id}".`);
          }
          nodeIds.add(n.id);
        }
        op.edges.forEach((e, j) => {
          if (!nodeIds.has(e.from)) {
            problems.push(`ops[${i}].edges[${j}].from: no node with id "${e.from}".`);
          }
          if (!nodeIds.has(e.to)) {
            problems.push(`ops[${i}].edges[${j}].to: no node with id "${e.to}".`);
          }
        });
        if (op.layout === 'tree') {
          const cyc = findCycle(
            op.nodes.map((n) => n.id),
            op.edges,
          );
          if (cyc) {
            problems.push(
              `ops[${i}]: layout "tree" cannot contain a cycle (${cyc.join(' -> ')}). Use layout "cycle" or "web" instead.`,
            );
          }
        }
        break;
      }
      case 'figure': {
        if (ctx.knownFigures && !ctx.knownFigures.has(op.figureId)) {
          problems.push(
            `ops[${i}].figureId: "${op.figureId}" does not exist. Only figure ids returned by run_code can be placed on the board.`,
          );
        }
        break;
      }
      case 'code': {
        if (op.focus) {
          const from = op.focus[0];
          const to = op.focus[1];
          const lines = op.src.split('\n').length;
          if (from > to) {
            problems.push(`ops[${i}].focus: [${from}, ${to}] is reversed.`);
          } else if (to > lines) {
            problems.push(
              `ops[${i}].focus: line ${to} is past the end of the snippet (${lines} lines).`,
            );
          }
        }
        break;
      }
      case 'table': {
        const cols = op.headers.length;
        op.rows.forEach((r, j) => {
          if (r.length !== cols) {
            problems.push(
              `ops[${i}].rows[${j}]: has ${r.length} cells but there are ${cols} headers.`,
            );
          }
        });
        break;
      }
      default:
        break;
    }
  });

  const height = estimateOpsHeight(ops);
  if (height > PAGE_H * MAX_STEP_PAGES) {
    const pages = (height / PAGE_H).toFixed(1);
    problems.push(
      `this step is about ${pages} board pages, and one step may fill at most ${MAX_STEP_PAGES}. Put less on the board and split it across two teach_step calls.`,
    );
  }

  return problems.length ? { ok: false, problems } : { ok: true, ops };
}

/** DFS cycle detection; returns the cycle path so the message names it. */
function findCycle(
  nodes: string[],
  edges: readonly { from: string; to: string }[],
): string[] | null {
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n, []);
  for (const e of edges) out.get(e.from)?.push(e.to);

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (n: string): string[] | null => {
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    if (state.get(n) === 2) return null;
    state.set(n, 1);
    stack.push(n);
    for (const next of out.get(n) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };

  for (const n of nodes) {
    const found = visit(n);
    if (found) return found;
  }
  return null;
}
