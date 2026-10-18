/**
 * The solver's skills document (§8.5).
 *
 * A short, versioned list of things the solver has to be told because a real
 * run got them wrong. It is deliberately small and deliberately separate from
 * the main prompt: the main prompt says how to solve at a board, and this says
 * what we have learned since.
 *
 * How it grows:
 *   1. Run the golden set (evals/golden.json) or watch real sessions.
 *   2. When the solver gets something wrong, find the smallest instruction
 *      that would have prevented it, and add it here — not a paragraph.
 *   3. Bump the version, add a line to the changelog saying which failure it
 *      answers, and re-run the golden set to check nothing else moved.
 *   4. Change one thing at a time. Two edits at once and you cannot tell
 *      which one helped.
 *   5. Delete entries that no longer earn their place. Every line here is
 *      paid for on every turn of every question.
 *
 * It is version-controlled with the code on purpose: a prompt change is a
 * behaviour change and deserves a diff and a reason.
 */

export const SKILLS_VERSION = '0.2';

/**
 * 0.1  First version, from running the prepared walkthroughs through the
 *      engine: narration referred to answers nobody had given.
 * 0.2  Added with the scrolling board and the stop-and-ask flow: earlier work
 *      now stays on screen, and an answer to a question is one step.
 */
export const SOLVER_SKILLS: string[] = [
  'Never refer to something the learner said unless they said it. They have not answered anything; do not write "exactly" or "good" as if they had.',
  'Everything you have written stays on the board above, and they can scroll up to it. Do not write an earlier result out again: refer to it ("from the second line", "the time we found") and, on the same page, point at it with annotate.',
  'Give any line you will need again an id and a short label when you first write it, so you can point back at it later.',
  'When you are stopped with a question, answer that question and nothing else, in one step. Do not use it as a chance to move the solution on.',
  'If you are not sure a fact, a formula or a step is right, do not write it as if you were. Check it with compute or run_code first; if you still cannot be sure, say so on the board in a text with tone "warn".',
  'Before you state the final answer, get it a second way — a different method, a limiting case, or putting it back into the question — and say which check you did.',
];

export function skillsBlock(): string {
  return `WHAT REAL SESSIONS HAVE TAUGHT US (v${SKILLS_VERSION})

${SOLVER_SKILLS.map((s) => `  - ${s}`).join('\n')}`;
}
