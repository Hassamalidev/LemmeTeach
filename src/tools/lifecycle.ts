/**
 * The terminal tools (§9.8–§9.9, §9.1).
 *
 * Each one ends its agent's loop when it succeeds. The runtime enforces that —
 * `TERMINAL_TOOLS` in the bus — rather than the agent deciding when it is
 * finished, which is the same principle as the loop being code and not a
 * prompt.
 */
import { uid } from '../core/types';
import { validateOps } from '../board/validate';
import { BOARD_OPS_WIRE } from '../board/op-schema';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import {
  EndLessonInput,
  FixBoardInput,
  PlanLessonInput,
  type EndLessonIn,
  type FixBoardIn,
  type PlanLessonIn,
} from './schemas';

export const planLesson: Tool = {
  name: 'plan_lesson',
  description: `Commit your reading of the question and the plan for solving it. This ends your turn — the solver takes it from here and sees only what is in this call, never the learner's attachments.

problem: the question restated in full. Every number, unit, symbol and condition; exactly what is asked; and a description of any figure precise enough to redraw. If there are several questions, all of them, numbered.

objectives: the stages of the solution, in order — "Find the time in the air", "Find the range".

steps: one per board step, three to nine. Open with what is given and what is asked. Draw the situation early if it can be drawn. Close with the answer and a check that it is sensible.

Estimate the minutes honestly.`,
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
  description: `Finish. Call it once the answer is on the board and checked, in the same turn as save_note. Also call it if carrying on would not help: the budget is spent, or the question cannot be answered as given.

summary: the question, the method and the answer in two or three plain sentences. List honestly under objectivesMissed any stage you did not reach. nextTopics: up to three things worth trying next.`,
  schema: EndLessonInput,
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(input: EndLessonIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.signalOrchestrator({ t: 'end_lesson', payload: input });
    return { ok: true, message: 'Done.' };
  },
};

export const fixBoard: Tool = {
  name: 'fix_board',
  description: `Return corrected board operations for a step that failed validation.

You are given the rejected operations and exactly what the validator objected to. Change only what was wrong and keep everything else as it was — you are repairing one step, not rewriting the solution. Do not add narration; someone else is at the board.`,
  schema: FixBoardInput,
  wire: (schema) => ({
    ...schema,
    properties: { ...schema.properties, ops: { ...BOARD_OPS_WIRE, description: schema.properties?.ops?.description } },
  }),
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
