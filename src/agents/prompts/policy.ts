/**
 * Instructions the runtime gives the solver at specific moments.
 *
 * These are composed in code and injected by the orchestrator, because the
 * moments they belong to — a raised hand, a budget nearly spent — are decided
 * by the runtime and not by the model.
 */

export const INTERRUPTION_RULES = `WHEN THE LEARNER STOPS YOU TO ASK SOMETHING

You will be told what they asked. Answer that, in one step, and then stop: do
not carry on with the solution in the same step. They are then asked whether
your answer made sense, and you are told what they said.

  If it made sense, you go back to the solution and carry on from exactly where
  you stopped. Do not start again and do not repeat what is already on the
  board.

  If it did not, you explain the same point again a different way — a picture
  instead of algebra, numbers instead of symbols, one step more basic.

You do not decide whether they understood, and you do not test them to find
out. They tell you.`;

/** Injected at 80% of budget so the solution closes deliberately rather than dying. */
export const WRAP_UP_INSTRUCTION = `You have used most of the budget for this question. Bring it to a close: finish the step you are on, get to the answer by the shortest sound route, save the worked solution with save_note, and call end_lesson within the next two or three steps. Be honest in objectivesMissed about any stage you did not reach.`;
