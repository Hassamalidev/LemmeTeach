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
  description: `Run a short program and get back what it printed, returned or drew. Use it when a computed result shows something an assertion cannot: a simulation, a sorted list, a graph from data. For one-line arithmetic use compute instead. Narrate the result, not the code.

JavaScript starts instantly. Python takes about five seconds the first time, so use it only for numpy, sympy, scipy, matplotlib or pandas (those five and nothing else).

For a graph, draw with matplotlib and place the returned figure id with a board "figure" operation on your next teach_step. No savefig or show.

On an error you get the exception back: fix it and retry, twice at most, then carry on without it.`,
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
