/**
 * ask_learner (§9.2) — the one tool that suspends.
 *
 * The loop genuinely stops here and waits on a human, with no timeout: the tab
 * can sit on this call for an hour. Fabricating an answer to keep the loop
 * moving is listed under "never acceptable" (§17.5) and there is nowhere in
 * this file it could happen.
 *
 * Only the reader has it, and only to clarify a question it cannot solve as
 * given. The solver never asks the learner anything.
 */
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { AskLearnerInput, type AskLearnerIn } from './schemas';

export const askLearner: Tool = {
  name: 'ask_learner',
  description: `Ask the learner one clarifying question and wait for their answer. Everything stops until they respond.

Use it only when the question cannot be solved as given: part of what they attached cannot be read, or the question can be taken two ways that lead to different answers. Solving the wrong question wastes their money, so in those two cases asking is right.

Never use it for anything else. Do not ask them to confirm what they wrote, do not ask their level, do not ask permission to begin, and do not quiz them. When a detail is missing and a standard assumption exists, make the assumption and state it instead.

They can press Skip. Then proceed on the most likely reading and say which one you chose.

Example:
  question: "The exponent in the second term is cut off in your photo. Is it x squared or x cubed?"
  kind: "choice"
  options: ["x squared", "x cubed"]
  why: "the answer differs depending on which"`,
  schema: AskLearnerInput,
  agents: ['planner'],
  parallelSafe: false,
  suspends: true,

  async run(input: AskLearnerIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.status('Waiting for your answer');
    const res = await ctx.learner.ask(
      { question: input.question, kind: input.kind, options: input.options },
      ctx.signal,
    );
    ctx.status(null);

    if (res.skipped) {
      return {
        ok: true,
        data: { skipped: true, elapsedMs: res.elapsedMs },
        message:
          'The learner skipped this. Proceed on the most likely reading of their question, and state which reading you chose.',
      };
    }

    return {
      ok: true,
      data: { answer: res.answer, elapsedMs: res.elapsedMs, skipped: false },
    };
  },
};
