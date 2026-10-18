/**
 * teach_step (§9.1) — the primary tool.
 *
 * One narrated step with its board operations, called once per turn. Batching
 * several steps into one call would defeat both interruption and reveal sync,
 * which is why the description says so plainly rather than leaving it implied.
 */
import { validateOps } from '../board/validate';
import { BOARD_OPS_WIRE } from '../board/op-schema';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { TeachStepInput, type TeachStepIn } from './schemas';

export const teachStep: Tool = {
  name: 'teach_step',
  description: `Write the next step on the board and say it aloud. Your main tool: once per turn, one idea per step.

"say" is read aloud by a speech engine: plain spoken words only, no markdown, LaTeX or symbols ("d by d x", not the notation). "board" carries the notation and structure, in the operation shapes listed under THE BOARD. The two complement each other and never repeat each other.

Example: say "I differentiate the first part and leave the second alone, then the other way round, and add." board [{"op":"derive","lines":[{"tex":"= 2x\\sin x + x^2\\cos x","note":"first' second + first second'"}]}]`,
  schema: TeachStepInput,
  wire: (schema) => ({
    ...schema,
    properties: {
      ...schema.properties,
      board: { ...BOARD_OPS_WIRE, description: schema.properties?.board?.description },
    },
  }),
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(input: TeachStepIn, ctx: ToolContext): Promise<ToolOutcome> {
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
    const note = outcome.boardFull
      ? 'This part of the board is getting long. Set "clear": true on your next teach_step to start a fresh section. Everything above stays on screen and the learner can scroll up to it, but annotate can only point at things in the current section.'
      : undefined;

    return {
      ok: true,
      data: {
        opsRendered: outcome.opsRendered,
        page: outcome.page,
        boardFull: outcome.boardFull,
      },
      message: note,
    };
  },
};
