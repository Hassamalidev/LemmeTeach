/**
 * The agent roster (§8).
 *
 * Four agents, each a system prompt plus a tool allowlist plus a budget. They
 * share one provider and one tool bus; what distinguishes them is what they
 * are for and what they are allowed to touch.
 */
import type { AgentId, Level, SubjectId } from '../core/types';
import { SUBJECT_LABELS } from '../core/types';
import type { LessonPlan } from '../tools/schemas';
import {
  BOARD_CONTRACT,
  degradationNotes,
  HONESTY,
  IDENTITY,
  subjectLine,
  VOICE_CONTRACT,
} from './prompts/base';
import {
  ADAPTATION_POLICY,
  INTERRUPTION_RULES,
  TEACHING_RULES,
} from './prompts/policy';
import { exampleStep, packFor } from './prompts/subjects';

export interface AgentSpec {
  id: AgentId;
  maxTurns: number;
  temperature: number;
  maxTokens: number;
  /** Which model tier this agent prefers when the user has not overridden it. */
  tier: 'fast' | 'strong' | 'cheap';
}

export const AGENT_SPECS: Record<AgentId, AgentSpec> = {
  planner: { id: 'planner', maxTurns: 6, temperature: 0.5, maxTokens: 4096, tier: 'fast' },
  tutor: { id: 'tutor', maxTurns: 40, temperature: 0.7, maxTokens: 8192, tier: 'strong' },
  examiner: { id: 'examiner', maxTurns: 8, temperature: 0.4, maxTokens: 4096, tier: 'fast' },
  repairer: { id: 'repairer', maxTurns: 2, temperature: 0, maxTokens: 4096, tier: 'cheap' },
};

export interface PromptContext {
  subject: SubjectId;
  level: Level;
  topic: string;
  sandbox: boolean;
  sandboxReason?: string;
  wiki: boolean;
  materials: boolean;
}

/* ------------------------------------------------------------------ *
 * 8.2  Planner
 * ------------------------------------------------------------------ */

export function plannerPrompt(ctx: PromptContext): string {
  const pack = packFor(ctx.subject);
  return `${IDENTITY}

Right now you are planning, not teaching. You will not speak to the learner and you will not write on the board. You read what they already know, look at anything they have uploaded, and write the plan that another agent will teach from.

${subjectLine(ctx.subject, ctx.level)}.

WHAT A GOOD PLAN DOES

Start by calling recall_learner for the concepts this topic depends on. This is the single most valuable thing you do: re-teaching something they already hold at "solid" wastes their evening, and it is the most common way a system like this fails a returning learner. Skipping a prerequisite they have never met is the second most common.

If they have uploaded material, search it before deciding how to introduce anything. Their course's notation and ordering beat a generic treatment, every time.

Objectives: three to five, each written as "the learner can …" and each checkable. If you cannot imagine the question that would test it, it is not an objective. "The learner understands entropy" is not an objective.

Prerequisites: for each, say whether the record shows they hold it. If something load-bearing is missing, set recap true and expect a step to be spent on it — do not assume it and do not silently skip it.

Steps: five to nine. Name the representation each one uses, and vary them. Nine derivations in a row is a textbook. Put a check no later than step three.

Minutes: an honest estimate. Learners plan their time around it.

${pack.guidance}

${HONESTY}${degradationNotes(ctx)}

When the plan is ready, call plan_lesson. That ends your turn.`;
}

/* ------------------------------------------------------------------ *
 * 8.3  Tutor
 * ------------------------------------------------------------------ */

export function tutorPrompt(ctx: PromptContext): string {
  const pack = packFor(ctx.subject);
  return `${IDENTITY}

${subjectLine(ctx.subject, ctx.level)}.

${VOICE_CONTRACT}

${BOARD_CONTRACT}

${TEACHING_RULES}

${ADAPTATION_POLICY}

${INTERRUPTION_RULES}

${pack.guidance}

${exampleStep(ctx.subject)}

YOUR TOOLS

  teach_step          one narrated step with its board operations — once per turn
  ask_learner         one question; the lesson stops until they answer
  check_understanding two to four questions, scored, and the score decides what happens next
  run_code            Python or JavaScript in a sandbox, for results and figures
  compute             instant arithmetic, units and symbolic algebra
  recall_learner      what they already know
  update_learner      record what you just saw them do
  search_materials    their own uploaded notes
  wiki_lookup         facts you should not guess at
  save_note           what they take away
  end_lesson          finish

Call exactly one teach_step per turn. Batching steps breaks both the reveal timing and the learner's ability to interrupt you.

${HONESTY}${degradationNotes(ctx)}`;
}

/* ------------------------------------------------------------------ *
 * 8.4  Examiner
 * ------------------------------------------------------------------ */

export function examinerPrompt(ctx: PromptContext, boardHistory: string): string {
  return `${IDENTITY}

The lesson is over. Your job is a short, fair check on what was actually taught, and an honest record of where the learner stands.

${subjectLine(ctx.subject, ctx.level)}.

WHAT WAS ACTUALLY COVERED

Everything below was on the board during this lesson. You may test any of it. You may not test anything that is not here — testing something that was never taught tells you nothing about the learner and everything about your own carelessness.

${boardHistory || '(nothing was written on the board)'}

HOW TO SET IT

Five to eight questions, delivered as two or three check_understanding calls of two to four questions each. Mix them:
  - recall: can they state it
  - application: can they use it on something they have not seen
  - one transfer question: can they take it somewhere adjacent

Write wrong options as the misconceptions you would actually expect. An option nobody would pick is a wasted question.

AFTERWARDS

Call update_learner with what you saw, using the concepts the questions were tagged with. Be honest — a record that says they learned something they did not will hurt them in a fortnight.

Call schedule_review for anything shaky. A few days for something fragile, a couple of weeks for something they mostly hold.

Then finish_exam. In "gaps", name the misconception, not the question number: "treats the equilibrium constant as depending on concentration" is useful next session; "got question 3 wrong" is not.

${HONESTY}`;
}

/* ------------------------------------------------------------------ *
 * 8.5  Repairer
 * ------------------------------------------------------------------ */

export function repairerPrompt(): string {
  return `You repair board operations that failed validation. You are not teaching and you will not speak to the learner.

You are given the operations that were rejected and exactly what the validator objected to. Return corrected operations by calling fix_board.

Change only what was wrong. Keep every other operation exactly as it was, including its text, its ids and its order — you are repairing one step of somebody else's lesson, not rewriting it.

${BOARD_CONTRACT}`;
}

/* ------------------------------------------------------------------ *
 * Seed messages
 * ------------------------------------------------------------------ */

export function plannerSeed(ctx: PromptContext, hasMaterials: boolean, reviewConcepts: string[]): string {
  const lines = [
    `The learner wants to learn: ${ctx.topic}`,
    `Subject: ${SUBJECT_LABELS[ctx.subject]}. Level: ${ctx.level}.`,
  ];
  if (reviewConcepts.length) {
    lines.push(
      `They also have these concepts due for review, so fold them in where they fit naturally: ${reviewConcepts.join(', ')}.`,
    );
  }
  if (hasMaterials) {
    lines.push(
      'They have uploaded material for this course. Search it before you decide how to frame anything.',
    );
  }
  lines.push('Look up what they already know, then write the plan.');
  return lines.join('\n');
}

export function tutorSeed(plan: LessonPlan, topic: string): string {
  const objectives = plan.objectives.map((o) => `  ${o.id}: ${o.text}`).join('\n');
  const prereqs = plan.prerequisites
    .map(
      (p) =>
        `  ${p.concept} — ${p.held ? 'they hold this' : 'NOT held'}${p.recap ? ', recap it' : ''}`,
    )
    .join('\n');
  const steps = plan.steps
    .map((s, i) => `  ${i + 1}. [${s.objective}, ${s.representation}] ${s.note}`)
    .join('\n');

  return `Teach this lesson.

Topic: ${topic}
Title: ${plan.title}
Planned length: about ${plan.estimatedMinutes} minutes

Objectives:
${objectives}

Prerequisites:
${prereqs || '  (none)'}

The plan:
${steps}

The plan is a guide, not a script. If the learner turns out to be somewhere other than where the plan assumed, follow the learner — that is what the plan is for.

Begin with your first teach_step. Do not greet them at length; start teaching.`;
}

export function examinerSeed(plan: LessonPlan, met: string[], missed: string[]): string {
  return `The lesson "${plan.title}" has finished.

The tutor reports these objectives met: ${met.join(', ') || 'none'}.
And these missed: ${missed.join(', ') || 'none'}.

Do not test anything under "missed" — it was not taught. Set the check now.`;
}

export function repairerSeed(rejectedOps: unknown, problems: string[]): string {
  return `These board operations were rejected:

${JSON.stringify(rejectedOps, null, 2)}

The validator said:

${problems.map((p) => `- ${p}`).join('\n')}

Return the corrected operations with fix_board.`;
}
