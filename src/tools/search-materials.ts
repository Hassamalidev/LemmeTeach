/**
 * search_materials (§9.6) — BM25 over whatever the learner uploaded.
 *
 * Note the empty case: no materials returns `ok: true` with an empty list and
 * a note, never an error. An error here makes a model retry the call two or
 * three times before giving up, and every one of those turns is the learner's
 * money.
 */
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { SearchMaterialsInput, type SearchMaterialsIn } from './schemas';

export const searchMaterials: Tool = {
  name: 'search_materials',
  description: `Search the learner's own uploaded notes, syllabus, or textbook chapter.

When they have given you material, it is the framing to teach from: their notation, their terminology, their course's ordering. A learner following a specific course is badly served by a generic treatment that uses different letters for the same thing.

Search it before you plan how to introduce a term, and again when you are about to define something they may already have a definition for. Snippets come back with a page number, so you can say "this is the version on page 42 of your notes".

If they have uploaded nothing, this returns an empty list — that is a normal answer, not a failure. Do not call it again in that case.`,
  schema: SearchMaterialsInput,
  agents: ['planner', 'tutor'],
  parallelSafe: true,
  suspends: false,

  async run(input: SearchMaterialsIn, ctx: ToolContext): Promise<ToolOutcome> {
    const docs = await ctx.materials.list();
    if (docs.length === 0) {
      return {
        ok: true,
        data: { hits: [] },
        message:
          'The learner has not uploaded any material, so there is nothing to search. Teach from your own knowledge and do not call this again this lesson.',
      };
    }

    ctx.status('Checking your notes');
    const hits = await ctx.materials.search(input.query, input.k ?? 4, input.docId);
    ctx.status(null);

    if (hits.length === 0) {
      return {
        ok: true,
        data: { hits: [] },
        message: `Nothing in the ${docs.length} uploaded document${docs.length === 1 ? '' : 's'} matched "${input.query}". Try different words, or teach it your own way.`,
      };
    }

    return {
      ok: true,
      data: {
        hits: hits.map((h) => ({
          docId: h.docId,
          title: h.title,
          page: h.page,
          snippet: h.snippet.slice(0, 400),
          score: Number(h.score.toFixed(2)),
        })),
      },
    };
  },
};
