/**
 * The page model — what is on the board, and when it fills up.
 *
 * Board pages persist for the whole session: the learner can scroll back
 * through everything written, which is the main advantage a whiteboard has
 * over a video (§10.2). So nothing is ever deleted here; `clear` starts a new
 * page rather than wiping the old one.
 *
 * This module is pure. It holds no DOM and imports no React, which is what
 * lets the renderer be driven straight from a fixture file.
 */
import { uid, type Pace } from '../core/types';
import type { BoardOp } from './op-schema';
import { estimateOpHeight, MAIN_W, PAGE_H, SHRINK_AT, SHRINK_SCALE } from './layout';

export interface BoardStep {
  id: string;
  say: string;
  ops: BoardOp[];
  objective?: string;
  pace?: Pace;
  at: number;
  /** Cached estimate, so pagination never re-walks the whole page. */
  height: number;
}

export interface BoardPage {
  index: number;
  steps: BoardStep[];
  /** 1, or SHRINK_SCALE once the page has been asked to hold a little more. */
  scale: number;
  height: number;
}

export interface WriteOutcome {
  stepId: string;
  opsRendered: number;
  page: number;
  boardFull: boolean;
}

export class BoardModel {
  pages: BoardPage[] = [{ index: 0, steps: [], scale: 1, height: 0 }];

  get current(): BoardPage {
    const p = this.pages[this.pages.length - 1];
    if (p) return p;
    const fresh = { index: 0, steps: [], scale: 1, height: 0 };
    this.pages.push(fresh);
    return fresh;
  }

  get stepCount(): number {
    return this.pages.reduce((n, p) => n + p.steps.length, 0);
  }

  allSteps(): BoardStep[] {
    return this.pages.flatMap((p) => p.steps);
  }

  lastStep(): BoardStep | undefined {
    return this.allSteps().at(-1);
  }

  write(input: {
    say: string;
    ops: BoardOp[];
    clear: boolean;
    objective?: string;
    pace?: Pace;
  }): WriteOutcome {
    const height = input.ops.reduce((n, op) => n + estimateOpHeight(op, MAIN_W), 0);

    if (input.clear) this.newPage();

    let page = this.current;
    if (page.steps.length > 0 && page.height + height > capacity(page)) {
      if (page.scale === 1) {
        // Shrink type by one step before giving up on the page — a heading
        // stranded alone at the top of a fresh page looks like a mistake.
        page.scale = SHRINK_SCALE;
        if (page.height + height > capacity(page)) page = this.newPage();
      } else {
        page = this.newPage();
      }
    }

    const step: BoardStep = {
      id: uid('step'),
      say: input.say,
      ops: input.ops,
      objective: input.objective,
      pace: input.pace,
      at: Date.now(),
      height,
    };
    page.steps.push(step);
    page.height += height;

    return {
      stepId: step.id,
      opsRendered: input.ops.length,
      page: page.index,
      boardFull: page.height >= capacity(page) * SHRINK_AT,
    };
  }

  /** Used by the repairer (§8.5): swap the ops of the step just written. */
  replaceLastOps(ops: BoardOp[]): WriteOutcome {
    const page = this.current;
    const step = page.steps.at(-1);
    if (!step) {
      return { stepId: '', opsRendered: 0, page: page.index, boardFull: false };
    }
    const height = ops.reduce((n, op) => n + estimateOpHeight(op, MAIN_W), 0);
    page.height += height - step.height;
    step.ops = ops;
    step.height = height;
    return {
      stepId: step.id,
      opsRendered: ops.length,
      page: page.index,
      boardFull: page.height >= capacity(page) * SHRINK_AT,
    };
  }

  /** Drop the ops of the last step but keep its narration (§17.3 last resort). */
  stripLastOps(): void {
    const step = this.current.steps.at(-1);
    if (!step) return;
    this.current.height -= step.height;
    step.ops = [];
    step.height = 0;
  }

  newPage(): BoardPage {
    if (this.current.steps.length === 0) return this.current;
    const page = { index: this.pages.length, steps: [], scale: 1, height: 0 };
    this.pages.push(page);
    return page;
  }

  /** Ids on the current page — the scope `annotate` may target. */
  knownIds(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const step of this.current.steps) {
      for (const op of step.ops) if (op.id) out.add(op.id);
    }
    return out;
  }

  /**
   * A compact account of what is on the board so far. Used when older turns
   * are compacted (§7), so the solver keeps track of its own working.
   */
  historySummary(): string {
    const lines: string[] = [];
    for (const page of this.pages) {
      for (const step of page.steps) {
        const bits = step.ops.map(describeOp).filter(Boolean);
        lines.push(`- ${step.say}${bits.length ? ` [board: ${bits.join('; ')}]` : ''}`);
      }
    }
    return lines.join('\n');
  }
}

function capacity(page: BoardPage): number {
  // A shrunk page holds proportionally more content in the same physical space.
  return PAGE_H / page.scale;
}

function describeOp(op: BoardOp): string {
  switch (op.op) {
    case 'heading':
      return `heading "${op.text}"`;
    case 'text':
      return op.tone === 'key' ? `key point "${op.text}"` : `"${op.text}"`;
    case 'math':
      return `math ${op.tex}`;
    case 'derive':
      return `derivation ${op.lines.map((l) => l.tex).join(' then ')}`;
    case 'bullets':
      return `list: ${op.items.join(', ')}`;
    case 'code':
      return `${op.lang} snippet (${op.src.split('\n').length} lines)`;
    case 'diagram':
      return `${op.layout} diagram of ${op.nodes.map((n) => n.label).join(', ')}`;
    case 'plot':
      return `plot of ${op.fns.map((f) => f.expr).join(' and ')}`;
    case 'vectors':
      return `vectors ${op.arrows.map((a) => a.label).join(', ')}`;
    case 'reaction':
      return `reaction ${op.left.map((s) => s.formula).join(' + ')} to ${op.right.map((s) => s.formula).join(' + ')}`;
    case 'table':
      return `table of ${op.headers.join(' / ')}`;
    case 'figure':
      return `figure${op.caption ? ` "${op.caption}"` : ''}`;
    case 'annotate':
      return op.text ? `annotation "${op.text}"` : '';
  }
}

/**
 * How many discrete pieces an op reveals in. Content is *written*, not faded
 * in (§16), and the unit of writing differs per op: a derivation appears line
 * by line, a list one item at a time, a diagram node by node.
 */
export function revealUnits(op: BoardOp): number {
  switch (op.op) {
    case 'derive':
      return op.lines.length;
    case 'bullets':
      return op.items.length;
    case 'diagram':
      return op.nodes.length + op.edges.length;
    case 'vectors':
      return op.arrows.length;
    case 'table':
      return op.rows.length + 1;
    case 'reaction':
      return op.left.length + op.right.length;
    case 'plot':
      return 1 + op.fns.length;
    default:
      return 1;
  }
}

export function totalRevealUnits(ops: BoardOp[]): number {
  return ops.reduce((n, op) => n + revealUnits(op), 0);
}
