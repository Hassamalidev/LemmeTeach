/**
 * run_code (§9.4) — execution in the sandbox.
 *
 * The tutor gets a real interpreter, and the point is that the lesson can show
 * a computed result rather than assert one. It is also entirely optional:
 * teaching must never depend on the sandbox, so when Pyodide is blocked this
 * returns a clear failure and the lesson carries on (§11, rung 2 of §17.4).
 */
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { RunCodeInput, type RunCodeIn } from './schemas';
import { truncateResult } from './index';

export const runCode: Tool = {
  name: 'run_code',
  description: `Run a short program and get back what it printed, returned, or drew. Use it when a computed result teaches something an assertion cannot: integrate a trajectory, sort a real list and show the passes, verify a stoichiometry, sample a distribution, or draw a graph from data rather than by hand.

Do not use it for arithmetic a person does in their head — use compute for that. Do not narrate the code; narrate the result. And trace a small input by hand on the board before you run it, so the code confirms an idea the learner already has rather than replacing it.

JavaScript starts instantly. Python takes about five seconds the first time while the runtime loads, so choose it only when you need numpy, sympy, scipy, matplotlib or pandas — those five are available, nothing else is.

To put a graph on the board, draw it with matplotlib and then place the returned figure id with a board "figure" operation on your next teach_step. There is no need to call savefig or show.

If it errors, the exception comes back to you. Fix it and try again, at most twice; after that, teach the point without it.`,
  schema: RunCodeInput,
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(input: RunCodeIn, ctx: ToolContext): Promise<ToolOutcome> {
    if (!ctx.settings.sandboxEnabled) {
      return {
        ok: false,
        message:
          'Code execution is switched off in this session. Teach the point without running anything, and do not offer to run code again.',
      };
    }
    if (!ctx.sandbox.available()) {
      return {
        ok: false,
        message: `Code execution is unavailable: ${ctx.sandbox.unavailableReason()} Teach the point without it.`,
      };
    }

    ctx.status(
      `${input.language === 'python' ? 'Working that out in Python' : 'Working that out in JavaScript'}: ${input.purpose}`,
    );

    const res = await ctx.sandbox.run(input.language, input.source, ctx.signal);
    ctx.status(null);

    if (res.timedOut) {
      return {
        ok: false,
        message:
          'That ran for ten seconds without finishing, so it was stopped. Reduce the work — fewer iterations, a smaller grid, a closed form — and try once more.',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        data: { stdout: truncateResult(res.stdout, 800), error: res.error },
        message: 'The program raised an error. Read it, fix the code, and try again.',
      };
    }

    if (input.expect === 'figure' && res.figures.length === 0) {
      return {
        ok: true,
        data: { stdout: truncateResult(res.stdout, 800), result: res.result, figures: [] },
        message:
          'It ran, but produced no figure. If you meant to draw one, plot it with matplotlib — a figure is captured automatically once something has been drawn.',
      };
    }

    return {
      ok: true,
      data: {
        stdout: truncateResult(res.stdout, 1200),
        result: res.result,
        figures: res.figures,
      },
      message: res.figures.length
        ? `Place ${res.figures.length === 1 ? 'this figure' : 'these figures'} on the board with a "figure" operation on your next teach_step.`
        : undefined,
    };
  },
};
