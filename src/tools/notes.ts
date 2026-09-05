/**
 * save_note and schedule_review (§9.10, §9.11).
 */
import { conceptSlug } from '../core/types';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import {
  SaveNoteInput,
  ScheduleReviewInput,
  type SaveNoteIn,
  type ScheduleReviewIn,
} from './schemas';

export const saveNote: Tool = {
  name: 'save_note',
  description: `Append a section to the notebook the learner takes away from this lesson, and exports as Markdown.

Write it for them reading it next week with no memory of the conversation: the statement of the idea, the worked example, the trap to avoid. Not a transcript of what you said.

Unlike narration, this is read rather than spoken, so Markdown and LaTeX between dollar signs are welcome here. One note per idea worth keeping — two or three across a lesson, not one per step.`,
  schema: SaveNoteInput,
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(input: SaveNoteIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.notes.save({ title: input.title, markdown: input.markdown, tags: input.tags });
    return { ok: true, message: `Added "${input.title}" to their notes.` };
  },
};

export const scheduleReview: Tool = {
  name: 'schedule_review',
  description: `Put a concept on the learner's "Due for review" list for a future session.

Use it for anything that was shaky rather than wrong, and for anything they got right but only just. A few days out for something fragile, a couple of weeks for something they mostly hold.

The reason is shown to them on the home screen, so write it as one plain sentence they will understand out of context.`,
  schema: ScheduleReviewInput,
  agents: ['examiner'],
  parallelSafe: false,
  suspends: false,

  async run(input: ScheduleReviewIn, ctx: ToolContext): Promise<ToolOutcome> {
    const slug = conceptSlug(input.concept);
    await ctx.memory.scheduleReview(slug, input.dueInDays, input.reason);
    return {
      ok: true,
      message: `${slug} is due for review in ${input.dueInDays} day${input.dueInDays === 1 ? '' : 's'}.`,
    };
  },
};
