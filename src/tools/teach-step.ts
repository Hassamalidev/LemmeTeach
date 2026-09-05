/**
 * teach_step (§9.1) — the primary tool.
 *
 * One narrated step with its board operations, called once per turn. Batching
 * several steps into one call would defeat both interruption and reveal sync,
 * which is why the description says so plainly rather than leaving it implied.
 */
import { validateOps } from '../board/validate';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { TeachStepInput, type TeachStepIn } from './schemas';

export const teachStep: Tool = {
  name: 'teach_step',
  description: `Write the next step of the lesson on the board and say it out loud. This is your main tool — most turns are one teach_step.

Two channels doing different jobs. "say" is read aloud by a speech engine, so it must be plain spoken language: no markdown, no LaTeX, no symbols, no bullet characters. Say "d by d x of x squared is two x", never the notation. The board carries the notation and the structure. They complement each other; they must never be the same sentences twice.

Call this once per turn. One step is one idea: a worked instance, a derivation, a diagram, a comparison. If a step needs more than about eight board operations it is two steps.

Example — teaching the product rule:
  say: "Watch what happens when I differentiate x squared times sine x. I take the derivative of the first part and leave the second alone, then add the first part times the derivative of the second."
  board: [{"op":"math","tex":"\\\\frac{d}{dx}\\\\left(x^2 \\\\sin x\\\\right)","id":"target"},
          {"op":"derive","lines":[{"tex":"= 2x\\\\sin x + x^2\\\\cos x","note":"first' second + first second'"}]}]`,
  schema: TeachStepInput,
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
      ? 'The page is nearly full. Set "clear": true on your next teach_step to start a fresh page — the learner can still scroll back to this one.'
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
