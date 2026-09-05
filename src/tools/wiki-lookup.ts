/**
 * wiki_lookup (§9.7) — the only network tool besides the model provider.
 *
 * Wikipedia's REST API sends permissive CORS headers, which is the entire
 * reason this can exist with no backend. Any other source would need a proxy,
 * and §2 forbids one.
 *
 * Off by default: some learners are on metered or restricted networks, and a
 * tutor that silently makes extra requests is not a good guest on someone
 * else's connection.
 */
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import { WikiLookupInput, type WikiLookupIn } from './schemas';
import { networkError } from '../runtime/errors';

const SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw networkError(`Wikipedia returned ${res.status} for that lookup.`);
  }
  return res.json();
}

export const wikiLookup: Tool = {
  name: 'wiki_lookup',
  description: `Look something up on Wikipedia.

Use it for facts you should not guess at: a date, a person's name, a constant, an atomic mass, the year a result was published, the accepted name of a reaction. Getting one of those wrong in front of a learner costs you all of your credibility.

Do not use it for explanations. Explaining is your job, and a summary paragraph is not a lesson — take the fact and teach it yourself.

"summary" fetches one article's opening; "search" lists candidate titles when you are not sure what the article is called.`,
  schema: WikiLookupInput,
  agents: ['planner', 'tutor'],
  parallelSafe: true,
  suspends: false,

  async run(input: WikiLookupIn, ctx: ToolContext): Promise<ToolOutcome> {
    if (!ctx.settings.wikiEnabled) {
      return {
        ok: false,
        message:
          'Wikipedia lookup is switched off for this session. Rely on what you know, and say plainly if you are unsure of a specific fact rather than guessing.',
      };
    }

    ctx.status('Looking that up');
    try {
      if (input.mode === 'search') {
        const url = `${SEARCH_URL}?action=query&list=search&srsearch=${encodeURIComponent(input.query)}&srlimit=5&format=json&origin=*`;
        const json = (await fetchJson(url, ctx.signal)) as {
          query?: { search?: { title: string; snippet: string }[] };
        };
        const results = (json.query?.search ?? []).map((r) => ({
          title: r.title,
          snippet: stripHtml(r.snippet).slice(0, 200),
        }));
        return {
          ok: true,
          data: { results },
          message: results.length ? undefined : 'Wikipedia found no article matching that.',
        };
      }

      const url = `${SUMMARY_URL}${encodeURIComponent(input.query.replace(/\s+/g, '_'))}`;
      const json = (await fetchJson(url, ctx.signal)) as {
        title?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
        type?: string;
      };

      if (!json.extract) {
        return {
          ok: true,
          data: { found: false },
          message: `No Wikipedia article called "${input.query}". Try mode "search" to find the right title.`,
        };
      }

      return {
        ok: true,
        data: {
          title: json.title ?? input.query,
          extract: json.extract.slice(0, 1200),
          url: json.content_urls?.desktop?.page ?? null,
        },
      };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Could not reach Wikipedia (${why}). Carry on without it; say if you are unsure of a fact rather than guessing.`,
      };
    } finally {
      ctx.status(null);
    }
  },
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
