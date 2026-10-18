/**
 * IndexedDB access (§20).
 *
 * Two stores behind one thin wrapper. Everything here degrades: a browser in
 * private mode, a full disk, or a user who has blocked storage must not
 * produce a blank screen — the session simply runs without a history and says
 * so once.
 */
import { createStore, get, set, del, keys, entries, clear, type UseStore } from 'idb-keyval';
import type { FigureRecord, SolutionRecord } from './records';

/** How many solved questions are kept. Eviction is oldest-first and always warns. */
export const CAPS = { solutions: 25 };

export type StoreName = 'lessons' | 'figures';
const STORE_NAMES: StoreName[] = ['lessons', 'figures'];

let stores: Record<StoreName, UseStore> | null = null;
let storageBroken = false;

function s(name: StoreName): UseStore {
  if (!stores) {
    // One database per store. idb-keyval creates an object store only when it
    // creates the database, so two stores sharing a database name means the
    // second one never exists and every write to it fails.
    stores = {
      lessons: createStore('chalk-lessons', 'lessons'),
      figures: createStore('chalk-figures', 'figures'),
    };
  }
  return stores[name];
}

/**
 * Every read and write funnels through here. A storage failure degrades the
 * session to "no history this time" rather than taking the solution down.
 */
async function guard<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  if (storageBroken) return fallback;
  try {
    return await op();
  } catch (err) {
    storageBroken = true;
    console.warn('[chalk] storage unavailable; continuing without history', err);
    return fallback;
  }
}

export function isStorageBroken(): boolean {
  return storageBroken;
}

/* ---------------------------- solved questions --------------------------- */

export const saveLesson = (l: SolutionRecord): Promise<void> =>
  guard(async () => {
    await set(l.id, l, s('lessons'));
    await evict();
  }, undefined);

export const loadLesson = (id: string): Promise<SolutionRecord | undefined> =>
  guard(() => get<SolutionRecord>(id, s('lessons')), undefined);

export const allLessons = (): Promise<SolutionRecord[]> =>
  guard(
    async () =>
      (await entries<string, SolutionRecord>(s('lessons')))
        .map(([, v]) => v)
        .sort((a, b) => b.startedAt - a.startedAt),
    [] as SolutionRecord[],
  );

export const deleteLesson = (id: string): Promise<void> => guard(() => del(id, s('lessons')), undefined);

async function evict(): Promise<void> {
  const all = await entries<string, SolutionRecord>(s('lessons'));
  if (all.length <= CAPS.solutions) return;
  const sorted = all.sort((a, b) => (a[1]?.startedAt ?? 0) - (b[1]?.startedAt ?? 0));
  const drop = sorted.slice(0, all.length - CAPS.solutions);
  for (const [k] of drop) await del(k, s('lessons'));
  notify(
    `Removed ${drop.length} of your oldest solved questions to stay under the limit of ${CAPS.solutions}.`,
  );
}

/* -------------------------------- figures -------------------------------- */

export const saveFigure = (f: FigureRecord): Promise<void> =>
  guard(() => set(f.id, f, s('figures')), undefined);

export const loadFigure = (id: string): Promise<FigureRecord | undefined> =>
  guard(() => get<FigureRecord>(id, s('figures')), undefined);

export const allFigureIds = (): Promise<string[]> =>
  guard(async () => (await keys<string>(s('figures'))).map(String), [] as string[]);

/* ------------------------------ whole-store ------------------------------ */

export async function eraseEverything(): Promise<void> {
  for (const n of STORE_NAMES) await guard(() => clear(s(n)), undefined);
}

/* ------------------------- user-visible storage notes -------------------- */

type Notifier = (message: string) => void;
let notifier: Notifier = (m) => console.info('[chalk]', m);

/** The UI installs a real notifier; eviction must never happen silently (§20). */
export function setStorageNotifier(fn: Notifier): void {
  notifier = fn;
}

function notify(message: string): void {
  notifier(message);
}
