/**
 * The terminal tools (§9.12–§9.15).
 *
 * Each one ends its agent's loop when it succeeds. The runtime enforces that —
 * `TERMINAL_TOOLS` in the bus — rather than the agent deciding when it is
 * finished, which is the same principle as the loop being code and not a
 * prompt.
 */
import { uid } from '../core/types';
import { validateOps } from '../board/validate';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import {
  EndLessonInput,
  FinishExamInput,
  FixBoardInput,
  PlanLessonInput,
  type EndLessonIn,
  type FinishExamIn,
  type FixBoardIn,
  type PlanLessonIn,
} from './schemas';

export const planLesson: Tool = {
  name: 'plan_lesson',
  description: `Commit the lesson plan. This ends your turn as planner — the tutor takes it from here, so everything it needs must be in this call.

Objectives are written as "the learner can …" and must be checkable. "The learner understands integration by parts" is not an objective, because nothing you could observe would settle whether it is true; "the learner can choose u and dv sensibly for a product of a polynomial and a trig function" is.

Prerequisites: say for each whether the record shows they hold it. If something load-bearing is missing, set recap true and budget a step for it rather than hoping.

Steps: five to nine, each naming the representation it uses. Vary them — a lesson that is nine derivations in a row is a textbook, not a lesson. Put the first check no later than step three.

Estimate the minutes honestly. Learners plan their evening around it.`,
  schema: PlanLessonInput,
  agents: ['planner'],
  parallelSafe: false,
  suspends: false,

  async run(input: PlanLessonIn, ctx: ToolContext): Promise<ToolOutcome> {
    const plan = { ...input, id: uid('plan'), createdAt: Date.now() };
    ctx.signalOrchestrator({ t: 'plan', plan });
    return {
      ok: true,
      data: { planId: plan.id, steps: input.steps.length, objectives: input.objectives.length },
      message: 'Plan accepted.',
    };
  },
};

export const endLesson: Tool = {
  name: 'end_lesson',
  description: `Finish teaching. Call it when you have worked through the plan, or when carrying on would not help — you are out of budget, the learner is lost in a way this lesson cannot fix, or they have asked to stop.

Be honest about objectivesMissed. An examiner that tests something you never got to, and a record that says they learned something they did not, are both worse than a short lesson.`,
  schema: EndLessonInput,
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(input: EndLessonIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.signalOrchestrator({ t: 'end_lesson', payload: input });
    return { ok: true, message: 'Lesson closed.' };
  },
};

export const finishExam: Tool = {
  name: 'finish_exam',
  description: `Close the check and hand back the verdict.

Name the misconception in "gaps", not the question number — "treats the equilibrium constant as depending on concentration" is useful next session; "missed question 3" is not.

The verdict is one sentence the learner reads: are they ready to move on, or is there one specific thing to shore up first?`,
  schema: FinishExamInput,
  agents: ['examiner'],
  parallelSafe: false,
  suspends: false,

  async run(input: FinishExamIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.signalOrchestrator({ t: 'finish_exam', payload: input });
    return { ok: true, message: 'Result recorded.' };
  },
};

export const fixBoard: Tool = {
  name: 'fix_board',
  description: `Return corrected board operations for a step that failed validation.

You are given the rejected operations and exactly what the validator objected to. Change only what was wrong and keep everything else as it was — you are repairing one step, not rewriting the lesson. Do not add narration; someone else is teaching.`,
  schema: FixBoardInput,
  agents: ['repairer'],
  parallelSafe: false,
  suspends: false,

  async run(input: FixBoardIn, ctx: ToolContext): Promise<ToolOutcome> {
    const check = validateOps(input.ops, {
      knownIds: ctx.board.knownIds(),
      knownFigures: ctx.board.knownFigures(),
    });
    if (!check.ok) {
      return {
        ok: false,
        message: `Still invalid: ${check.problems.join(' ')}`,
      };
    }
    // The step these belong to was never written — validation stopped it — so
    // the corrected operations go back to the session, which completes the
    // original teach_step with them.
    ctx.signalOrchestrator({ t: 'board_repaired', ops: check.ops });
    return { ok: true, data: { opsRepaired: check.ops.length } };
  },
};
