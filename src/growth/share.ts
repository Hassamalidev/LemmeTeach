/**
 * Sharing a solved question as a link (§30).
 *
 * Only what is needed to play it back goes up: the plan, the board, the
 * narration, the notes. A shared record is opened through a normal replay, so
 * it passes the same tool bus as a model's output, and anything malformed is
 * refused there rather than trusted here.
 */
import type { Level, SubjectId } from '../core/types';
import { canReplay } from '../providers/replay';
import type { SolutionRecord } from '../storage/records';
import { scrubKeys } from '../storage/settings';

const LINKS = 'chalk.shares';
const MAX_BYTES = 190_000;

interface Link {
  id: string;
  token: string;
}

function links(): Record<string, Link> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LINKS) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Link>) : {};
  } catch {
    return {};
  }
}

function remember(solutionId: string, link: Link | null): void {
  try {
    const all = links();
    if (link) all[solutionId] = link;
    else delete all[solutionId];
    localStorage.setItem(LINKS, JSON.stringify(all));
  } catch {
    /* The link still works; this browser just will not remember making it. */
  }
}

export function shareUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?s=${id}`;
}

/** The link already made for this solution, so sharing twice gives the same one. */
export function existingShare(solutionId: string): string | null {
  const link = links()[solutionId];
  return link ? shareUrl(link.id) : null;
}

/** Just what a replay needs. Nothing about the session, the budget or the device. */
export function shareable(record: SolutionRecord): unknown {
  const pages = Array.isArray(record.pages) ? (record.pages as { steps?: unknown[] }[]) : [];
  return {
    title: record.title,
    topic: record.topic,
    subject: record.subject,
    level: record.level,
    plan: record.plan,
    pages: pages.map((p) => ({
      steps: (p.steps ?? []).map((s) => {
        const step = s as { say?: unknown; ops?: unknown; objective?: unknown };
        return { say: step.say, ops: step.ops, objective: step.objective };
      }),
    })),
    notes: record.notes,
    ending: record.ending,
  };
}

export type ShareResult = { ok: true; url: string } | { ok: false; message: string };

export async function createShare(record: SolutionRecord): Promise<ShareResult> {
  const known = existingShare(record.id);
  if (known) return { ok: true, url: known };

  const body = scrubKeys(JSON.stringify(shareable(record)));
  if (new TextEncoder().encode(body).length > MAX_BYTES) {
    return { ok: false, message: 'This solution is too long to share as a link. Copy the worked solution instead.' };
  }

  let res: Response;
  try {
    res = await fetch('/api/share', { method: 'POST', body });
  } catch {
    return { ok: false, message: 'Could not reach LemmeTeach. Check your connection and try again.' };
  }
  const reply = (await res.json().catch(() => null)) as {
    ok?: boolean;
    id?: string;
    token?: string;
    code?: string;
  } | null;
  if (reply?.code === 'limit_reached') {
    return { ok: false, message: 'That is a lot of links for one day. Try again tomorrow.' };
  }
  if (!res.ok || !reply?.ok || !reply.id || !reply.token) {
    return { ok: false, message: 'Sharing is not available right now. Copy the worked solution instead.' };
  }
  remember(record.id, { id: reply.id, token: reply.token });
  return { ok: true, url: shareUrl(reply.id) };
}

export async function stopSharing(solutionId: string): Promise<boolean> {
  const link = links()[solutionId];
  if (!link) return true;
  try {
    const res = await fetch('/api/share', { method: 'DELETE', body: JSON.stringify(link) });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  remember(solutionId, null);
  return true;
}

/** The id in a shared link, if this page was opened from one. */
export function sharedIdInUrl(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get('s');
    return id && /^[A-Za-z0-9_-]{12}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const SUBJECTS: readonly string[] = [
  'math',
  'physics',
  'chemistry',
  'cs',
  'biology',
  'finance',
  'psychology',
  'general',
];
const LEVELS: readonly string[] = ['intro', 'school', 'undergrad', 'deep'];

/** A stored solution as a record to replay. Anything that does not fit is null. */
export function readShared(value: unknown): SolutionRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || typeof v.topic !== 'string' || !Array.isArray(v.pages)) return null;

  const notes = Array.isArray(v.notes)
    ? v.notes.filter(
        (n): n is SolutionRecord['notes'][number] =>
          typeof n === 'object' &&
          n !== null &&
          typeof (n as { title?: unknown }).title === 'string' &&
          typeof (n as { markdown?: unknown }).markdown === 'string',
      )
    : [];
  const ending = v.ending as Partial<NonNullable<SolutionRecord['ending']>> | undefined;
  const strings = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];

  const record: SolutionRecord = {
    id: `shared-${Math.random().toString(36).slice(2)}`,
    title: v.title,
    topic: v.topic,
    subject: (SUBJECTS.includes(String(v.subject)) ? v.subject : 'general') as SubjectId,
    level: (LEVELS.includes(String(v.level)) ? v.level : 'school') as Level,
    startedAt: Date.now(),
    plan: v.plan,
    pages: v.pages,
    transcript: [],
    notes,
    ending: {
      summary: typeof ending?.summary === 'string' ? ending.summary : v.title,
      objectivesMet: strings(ending?.objectivesMet),
      objectivesMissed: strings(ending?.objectivesMissed),
      nextTopics: strings(ending?.nextTopics),
    },
  };
  return canReplay(record) ? record : null;
}

export type OpenResult = { ok: true; record: SolutionRecord } | { ok: false; message: string };

export async function openShared(id: string): Promise<OpenResult> {
  const gone = 'That link no longer works. It may have been removed, or it has expired.';
  try {
    const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`);
    if (res.status === 404) return { ok: false, message: gone };
    const body = (await res.json().catch(() => null)) as { ok?: boolean; solution?: unknown } | null;
    if (!res.ok || !body?.ok) {
      return { ok: false, message: 'That link could not be opened just now. Try again in a minute.' };
    }
    const record = readShared(body.solution);
    return record ? { ok: true, record } : { ok: false, message: gone };
  } catch {
    return { ok: false, message: 'Could not reach LemmeTeach. Check your connection and try again.' };
  }
}
