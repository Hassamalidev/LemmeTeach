/**
 * teach_step (§9.1) — the primary tool.
 *
 * One narrated step with its board operations, called once per turn. Batching
 * several steps into one call would defeat both interruption and reveal sync,
 * which is why the description says so plainly rather than leaving it implied.
 */
import { validateOps } from '../board/validate';
import { BOARD_OPS_WIRE } from '../board/op-schema';
import { explainOps, tidyOps } from '../board/tidy';
import { fillNumbersDeep } from './compute';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { TeachStepInput, type TeachStepIn } from './schemas';

export const teachStep: Tool = {
  name: 'teach_step',
  description: `Write the next step on the board and say it aloud. Your main tool: once per turn, one idea per step.

"say" is read aloud by a speech engine: plain spoken words only, no markdown, LaTeX or symbols ("d by d x", not the notation). "board" carries the notation and structure, in the operation shapes listed under THE BOARD. The two complement each other and never repeat each other.

Numbers are never worked out in your head: write {{expression}} where a number goes, in "say" or on the board, and it is computed as the step is drawn — "{{20*sin(35 deg)}}" becomes 11.47, "{{9.81*2 | 3}}" 19.6. The result lists the values.

Example: say "I differentiate the first part and leave the second alone, then the other way round, and add." board [{"op":"derive","lines":[{"tex":"= 2x\\sin x + x^2\\cos x","note":"first' second + first second'"}]}]`,
  schema: TeachStepInput,
  wire: (schema) => ({
    ...schema,
    properties: {
      ...schema.properties,
      board: { ...BOARD_OPS_WIRE, description: schema.properties?.board?.description },
    },
  }),
  prepare: (input) => {
    if (typeof input !== 'object' || input === null) return { input, notes: [] };
    const { ops, fixes } = tidyOps((input as { board?: unknown }).board);
    return { input: { ...input, board: ops }, notes: fixes };
  },
  explain: (input, paths) =>
    explainOps(
      (input as { board?: unknown } | null)?.board,
      paths.filter((p) => p[0] === 'board' && typeof p[1] === 'number').map((p) => p[1] as number),
    ),
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(raw: TeachStepIn, ctx: ToolContext): Promise<ToolOutcome> {
    // The numbers written as {{expression}} are worked out first, so what is
    // drawn and said is a computed figure, not one the model made up.
    const numbers: Record<string, string> = {};
    const unworkable: string[] = [];
    const filled = fillNumbersDeep(raw, numbers, unworkable);
    if (unworkable.length) {
      return {
        ok: false,
        message: `Some numbers could not be worked out, so nothing was drawn: ${unworkable.slice(0, 3).join('; ')}. Use mathjs syntax inside {{ }} and send the step again.`,
      };
    }

    // A pointer at something that is not there is not worth a whole turn: the
    // step is drawn without it, and the model is told.
    const here = new Set(filled.board.flatMap((op) => (op.id ? [op.id] : [])));
    const known = ctx.board.knownIds();
    const lost = filled.board.flatMap((op) =>
      op.op === 'annotate' && !known.has(op.target) && !here.has(op.target) ? [op.target] : [],
    );
    const input = lost.length
      ? { ...filled, board: filled.board.filter((op) => !(op.op === 'annotate' && lost.includes(op.target))) }
      : filled;

    // Shape is already guaranteed by the bus; this pass adds the contextual
    // rules the schema cannot express — annotate targets, real figure ids,
    // parseable plot expressions, and whether it all fits on a page.
    const check = validateOps(input.board, {
      knownIds: ctx.board.knownIds(),
      knownFigures: ctx.board.knownFigures(),
    });

    let ops = check.ok ? check.ops : null;

    if (!check.ok) {
      const problems = check.problems;
      // Second failure on the same step escalates to the repairer (§17.3). The
      // session decides when that happens; here we only report the outcome.
      const repaired = await ctx.boardRejected(input.board, problems);
      if (!repaired) {
        return {
          ok: false,
          message: `The board operations were rejected, so nothing was drawn. ${problems.join(' ')} Send teach_step again with these fixed — the narration was not spoken either.`,
        };
      }
      ops = repaired;
    }

    if (!ops) {
      return { ok: false, message: 'The board operations could not be drawn.' };
    }

    const outcome = ctx.board.writeStep({
      say: input.say,
      ops,
      clear: input.clear ?? false,
      objective: input.objective,
      pace: input.pace,
    });

    ctx.signalOrchestrator({
      t: 'step_written',
      stepId: outcome.stepId,
      say: input.say,
      pace: input.pace,
    });

    // Models otherwise keep writing off the bottom of the page, so the
    // instruction goes in the result itself rather than only in the prompt.
    const notes = [
      outcome.boardFull
        ? 'This part of the board is getting long. Set "clear": true on your next teach_step to start a fresh section. Everything above stays on screen and the learner can scroll up to it, but annotate can only point at things in the current section.'
        : '',
      lost.length
        ? `The step was drawn, but annotate was left out: nothing in this section has the id "${lost.join('", "')}". To point at something, give it an id when you write it.`
        : '',
    ].filter(Boolean);
    const note = notes.length ? notes.join(' ') : undefined;

    return {
      ok: true,
      data: {
        opsRendered: outcome.opsRendered,
        page: outcome.page,
        boardFull: outcome.boardFull,
        ...(Object.keys(numbers).length ? { numbers } : {}),
      },
      message: note,
    };
  },
};
