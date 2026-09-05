/**
 * IndexedDB access (§20).
 *
 * Six stores, one thin wrapper. Everything here degrades: a browser in private
 * mode, a full disk, or a user who has blocked storage must not produce a
 * blank screen — the session simply runs without memory and says so once.
 */
import { createStore, get, set, del, keys, entries, clear, type UseStore } from 'idb-keyval';
import type {
  ConceptRecord,
  FigureRecord,
  LearnerProfile,
  LessonRecord,
  MaterialDoc,
} from '../memory/types';
import type { AgentEvent } from '../providers/types';

const DB_NAME = 'chalk';

export const SCHEMA_VERSION = 1;

/** Caps from §20. Eviction is oldest-first and always warns. */
export const CAPS = { lessons: 25, materials: 10, totalBytes: 20 * 1024 * 1024 };

let stores: Record<StoreName, UseStore> | null = null;
let storageBroken = false;

export type StoreName = 'profile' | 'concepts' | 'lessons' | 'materials' | 'figures' | 'tapes';

function s(name: StoreName): UseStore {
  if (!stores) {
    stores = {
      profile: createStore(DB_NAME, 'profile'),
      concepts: createStore(DB_NAME, 'concepts'),
      lessons: createStore(DB_NAME, 'lessons'),
      materials: createStore(DB_NAME, 'materials'),
      figures: createStore(DB_NAME, 'figures'),
      tapes: createStore(DB_NAME, 'tapes'),
    };
  }
  return stores[name];
}

/**
 * Every read and write funnels through here. A storage failure degrades the
 * session to "no memory this time" rather than taking the lesson down with it.
 */
async function guard<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  if (storageBroken) return fallback;
  try {
    return await op();
  } catch (err) {
    storageBroken = true;
    console.warn('[chalk] storage unavailable; continuing without memory', err);
    return fallback;
  }
}

export function isStorageBroken(): boolean {
  return storageBroken;
}

/* -------------------------------- profile -------------------------------- */

export const loadProfile = (): Promise<LearnerProfile | undefined> =>
  guard(() => get<LearnerProfile>('default', s('profile')), undefined);

export const saveProfile = (p: LearnerProfile): Promise<void> =>
  guard(() => set('default', p, s('profile')), undefined);

/* -------------------------------- concepts ------------------------------- */

export const loadConcept = (slug: string): Promise<ConceptRecord | undefined> =>
  guard(() => get<ConceptRecord>(slug, s('concepts')), undefined);

export const saveConcept = (rec: ConceptRecord): Promise<void> =>
  guard(() => set(rec.concept, rec, s('concepts')), undefined);

export const deleteConcept = (slug: string): Promise<void> =>
  guard(() => del(slug, s('concepts')), undefined);

export const allConcepts = (): Promise<ConceptRecord[]> =>
  guard(
    async () => (await entries<string, ConceptRecord>(s('concepts'))).map(([, v]) => v),
    [] as ConceptRecord[],
  );

/* -------------------------------- lessons -------------------------------- */

export const saveLesson = (l: LessonRecord): Promise<void> =>
  guard(async () => {
    await set(l.id, l, s('lessons'));
    await evictLessons();
  }, undefined);

export const loadLesson = (id: string): Promise<LessonRecord | undefined> =>
  guard(() => get<LessonRecord>(id, s('lessons')), undefined);

export const allLessons = (): Promise<LessonRecord[]> =>
  guard(
    async () =>
      (await entries<string, LessonRecord>(s('lessons')))
        .map(([, v]) => v)
        .sort((a, b) => b.startedAt - a.startedAt),
    [] as LessonRecord[],
  );

export const deleteLesson = (id: string): Promise<void> => guard(() => del(id, s('lessons')), undefined);

async function evictLessons(): Promise<void> {
  const all = await entries<string, LessonRecord>(s('lessons'));
  if (all.length <= CAPS.lessons) return;
  const sorted = all.sort((a, b) => (a[1]?.startedAt ?? 0) - (b[1]?.startedAt ?? 0));
  const drop = sorted.slice(0, all.length - CAPS.lessons);
  for (const [k] of drop) await del(k, s('lessons'));
  notify(`Removed ${drop.length} of your oldest lessons to stay under the ${CAPS.lessons}-lesson limit.`);
}

/* ------------------------------- materials ------------------------------- */

export const saveMaterial = (d: MaterialDoc): Promise<void> =>
  guard(() => set(d.id, d, s('materials')), undefined);

export const loadMaterial = (id: string): Promise<MaterialDoc | undefined> =>
  guard(() => get<MaterialDoc>(id, s('materials')), undefined);

export const allMaterials = (): Promise<MaterialDoc[]> =>
  guard(
    async () =>
      (await entries<string, MaterialDoc>(s('materials')))
        .map(([, v]) => v)
        .sort((a, b) => b.addedAt - a.addedAt),
    [] as MaterialDoc[],
  );

export const deleteMaterial = (id: string): Promise<void> =>
  guard(() => del(id, s('materials')), undefined);

/* -------------------------------- figures -------------------------------- */

export const saveFigure = (f: FigureRecord): Promise<void> =>
  guard(() => set(f.id, f, s('figures')), undefined);

export const loadFigure = (id: string): Promise<FigureRecord | undefined> =>
  guard(() => get<FigureRecord>(id, s('figures')), undefined);

export const allFigureIds = (): Promise<string[]> =>
  guard(async () => (await keys<string>(s('figures'))).map(String), [] as string[]);

/* --------------------------------- tapes --------------------------------- */

export const saveTape = (id: string, events: AgentEvent[]): Promise<void> =>
  guard(() => set(id, events, s('tapes')), undefined);

export const loadTape = (id: string): Promise<AgentEvent[] | undefined> =>
  guard(() => get<AgentEvent[]>(id, s('tapes')), undefined);

/* ------------------------------ whole-store ------------------------------ */

export async function eraseEverything(): Promise<void> {
  const names: StoreName[] = ['profile', 'concepts', 'lessons', 'materials', 'figures', 'tapes'];
  for (const n of names) await guard(() => clear(s(n)), undefined);
}

export async function exportAll(): Promise<Record<string, unknown>> {
  return {
    schema: SCHEMA_VERSION,
    exportedAt: Date.now(),
    profile: await loadProfile(),
    concepts: await allConcepts(),
    lessons: await allLessons(),
    materials: (await allMaterials()).map((m) => ({ ...m, postings: {}, chunks: m.chunks })),
  };
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
