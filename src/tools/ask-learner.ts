/**
 * ask_learner and check_understanding (§9.2, §9.3) — the tools that suspend.
 *
 * These are what make the system a tutor rather than a video. The loop
 * genuinely stops here and waits on a human, with no timeout: the tab can sit
 * on this call for an hour. Fabricating an answer to keep the loop moving is
 * listed under "never acceptable" (§17.5) and there is nowhere in this file it
 * could happen.
 */
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import {
  AskLearnerInput,
  CheckUnderstandingInput,
  type AskLearnerIn,
  type CheckUnderstandingIn,
} from './schemas';

export const askLearner: Tool = {
  name: 'ask_learner',
  description: `Ask the learner one question and wait for their real answer. The lesson pauses here until they respond, so use it whenever you actually want to know something rather than to punctuate a monologue.

Reach for it before introducing an idea that depends on something they may not hold, when you want a prediction before showing a result, and any time you have said three or four things in a row without hearing from them.

The answer comes back as a tool result. Read it properly: a wrong answer tells you which specific thing they believe, and your next step should address that belief, not repeat the last explanation more slowly. "I don't know" is never a reason to advance — split the question into a smaller one.

They can press Skip. A skipped question means they chose not to answer, which is not the same as being wrong; do not record it as a miss.

Example:
  question: "Before I show you, what do you think happens to the current if I double the resistance?"
  kind: "choice"
  options: ["It doubles", "It halves", "It stays the same", "It depends on the battery"]
  why: "checking whether the inverse relationship has landed"`,
  schema: AskLearnerInput,
  agents: ['tutor', 'examiner'],
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
          'The learner skipped this question. That is a choice, not a wrong answer — do not record it against them. Carry on, or ask something smaller.',
      };
    }

    return {
      ok: true,
      data: { answer: res.answer, elapsedMs: res.elapsedMs, skipped: false },
    };
  },
};

export const checkUnderstanding: Tool = {
  name: 'check_understanding',
  description: `Put two to four multiple-choice questions to the learner at once and get them scored back. Use this for a real checkpoint, and use ask_learner for a single question mid-explanation.

Ask your first one no later than the third step. A check only at the end is a test, not teaching.

Write the wrong options as the misconceptions you actually expect, not as filler — which option they pick is the whole signal, and "none of the above" tells you nothing. Tag every question with the concept it tests so a wrong answer lands on the right record.

What happens next is decided in code from the score, not by you: at or above 80% the lesson continues, between 40 and 79% you will be asked to re-explain that one point with a different representation, and below 40% you will be sent back to the prerequisite. Write questions that can carry that weight.

Example question:
  {"q": "Which quantity is conserved in an elastic collision but not an inelastic one?",
   "options": ["Momentum", "Kinetic energy", "Both", "Neither"],
   "answer": 1, "why": "Momentum is conserved in both; elastic means kinetic energy is too.",
   "concept": "elastic-collision"}`,
  schema: CheckUnderstandingInput,
  agents: ['tutor', 'examiner'],
  parallelSafe: false,
  suspends: true,

  async run(input: CheckUnderstandingIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.status('Waiting for your answers');
    const outcome = await ctx.learner.quiz(input.questions, ctx.signal);
    ctx.status(null);

    const perQuestion = outcome.perQuestion.map((p, i) => ({
      concept: p.concept,
      chosen: p.chosen,
      correct: p.correct,
      right: p.chosen === p.correct,
      skipped: p.skipped,
      /** The exact wrong option they picked, which is the useful part. */
      chosenText: p.skipped ? null : (input.questions[i]?.options[p.chosen] ?? null),
    }));

    const weak = perQuestion.filter((p) => !p.right && !p.skipped).map((p) => p.concept);

    if (outcome.answered === 0) {
      return {
        ok: true,
        data: { answered: 0, perQuestion },
        message:
          'The learner skipped every question, so there is no score. That is a choice, not a failure — do not record it against them, and do not remediate on the strength of it. Consider asking one smaller question instead.',
      };
    }

    ctx.signalOrchestrator({
      t: 'check_scored',
      score: outcome.score,
      onFail: input.onFail,
      weak: [...new Set(weak)],
    });

    const summary =
      outcome.score >= 0.8
        ? 'They have this. Keep going, and consider raising the level.'
        : outcome.score >= 0.4
          ? 'Partly there. Re-explain the point they missed using a different representation than last time, then check that one point again.'
          : 'This has not landed. Back up to the prerequisite rather than repeating the explanation.';

    return {
      ok: true,
      data: {
        score: Number(outcome.score.toFixed(2)),
        answered: outcome.answered,
        perQuestion,
        weakConcepts: [...new Set(weak)],
      },
      message: summary,
    };
  },
};
