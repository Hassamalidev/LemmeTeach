/**
 * save_note (§9.7).
 */
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { SaveNoteInput, type SaveNoteIn } from './schemas';

export const saveNote: Tool = {
  name: 'save_note',
  description: `Save the worked solution for the learner to keep, in the same turn as end_lesson. One note per question.

Write it for them reading it next week: the question, the method in a sentence, the working line by line, the answer with units, the trap to avoid. This is read, not spoken, so Markdown and LaTeX between dollar signs are welcome.`,
  schema: SaveNoteInput,
  agents: ['tutor'],
  parallelSafe: false,
  suspends: false,

  async run(input: SaveNoteIn, ctx: ToolContext): Promise<ToolOutcome> {
    ctx.notes.save({ title: input.title, markdown: input.markdown, tags: input.tags });
    return { ok: true, message: `Saved "${input.title}" for them to keep.` };
  },
};
