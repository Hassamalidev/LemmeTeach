/**
 * The learner store — the `MemoryPort` the tools talk to (§12).
 *
 * Records are read through here, updated through the decay-and-blend rule, and
 * written straight back to IndexedDB. Nothing is batched until the end of a
 * lesson: a session that is abandoned halfway must still leave an accurate
 * record behind.
 */
import { conceptSlug, now, type SubjectId } from '../core/types';
import {
  allConcepts,
  allLessons,
  deleteConcept,
  loadConcept,
  loadProfile,
  saveConcept,
  saveProfile,
} from '../storage/db';
import { applyObservation, decayedMastery, emptyRecord, type Observation } from './concepts';
import { dueForReview, scheduleIn, type DueItem } from './scheduling';
import type { ConceptRecord, LearnerProfile } from './types';
import type { MemoryPort } from '../tools/context';

export class LearnerStore implements MemoryPort {
  private profileCache: LearnerProfile | null = null;
  private listeners = new Set<() => void>();
  /** Mastery before this lesson touched a concept, for the review screen. */
  private sessionBaseline = new Map<string, number>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  async profile(): Promise<LearnerProfile> {
    if (this.profileCache) return this.profileCache;
    const stored = await loadProfile();
    this.profileCache = stored ?? {
      id: 'default',
      createdAt: now(),
      pace: 'normal',
      level: {},
      totals: { lessons: 0, minutes: 0 },
    };
    return this.profileCache;
  }

  async updateProfile(patch: Partial<LearnerProfile>): Promise<LearnerProfile> {
    const current = await this.profile();
    const next = { ...current, ...patch };
    this.profileCache = next;
    await saveProfile(next);
    this.changed();
    return next;
  }

  async concept(slug: string): Promise<ConceptRecord | undefined> {
    return loadConcept(conceptSlug(slug));
  }

  async concepts(slugs?: string[]): Promise<ConceptRecord[]> {
    if (!slugs) return allConcepts();
    const out: ConceptRecord[] = [];
    for (const slug of slugs) {
      const rec = await loadConcept(conceptSlug(slug));
      if (rec) out.push(rec);
    }
    return out;
  }

  async observe(slug: string, subject: SubjectId, obs: Observation): Promise<ConceptRecord> {
    const id = conceptSlug(slug);
    const existing = (await loadConcept(id)) ?? emptyRecord(id, subject);

    if (!this.sessionBaseline.has(id)) {
      this.sessionBaseline.set(id, decayedMastery(existing));
    }

    const next = applyObservation(existing, obs);
    await saveConcept(next);
    this.changed();
    return next;
  }

  async scheduleReview(slug: string, days: number, reason: string): Promise<void> {
    const id = conceptSlug(slug);
    const existing = await loadConcept(id);
    if (!existing) return;
    const next = scheduleIn(existing, days);
    // The reason is shown on the home screen, so it goes in the evidence trail
    // rather than into a field only the model would ever read.
    next.evidence = [...next.evidence, { at: now(), delta: 0, note: `Review scheduled: ${reason}` }].slice(-10);
    await saveConcept(next);
    this.changed();
  }

  async recentLessonTitles(n: number): Promise<string[]> {
    const lessons = await allLessons();
    return lessons.slice(0, n).map((l) => l.title || l.topic);
  }

  async due(): Promise<DueItem[]> {
    return dueForReview(await allConcepts());
  }

  async forSubject(subject: SubjectId): Promise<ConceptRecord[]> {
    return (await allConcepts())
      .filter((c) => c.subject === subject)
      .sort((a, b) => decayedMastery(b) - decayedMastery(a));
  }

  /** What moved this lesson, and by how much — the mastery diff on Review. */
  masteryDiff(records: ConceptRecord[]): { concept: string; before: number; after: number }[] {
    const out: { concept: string; before: number; after: number }[] = [];
    for (const [concept, before] of this.sessionBaseline) {
      const rec = records.find((r) => r.concept === concept);
      if (!rec) continue;
      out.push({ concept, before, after: rec.mastery });
    }
    return out.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  }

  /** The deltas as short strings, for deterministic context compaction (§7). */
  deltaSummaries(records: ConceptRecord[]): string[] {
    return this.masteryDiff(records).map(
      (d) => `${d.concept}: ${d.before.toFixed(2)} → ${d.after.toFixed(2)}`,
    );
  }

  beginSession(): void {
    this.sessionBaseline.clear();
  }

  touchedConcepts(): string[] {
    return [...this.sessionBaseline.keys()];
  }

  async reset(slug: string): Promise<void> {
    await deleteConcept(conceptSlug(slug));
    this.changed();
  }

  invalidate(): void {
    this.profileCache = null;
    this.changed();
  }
}

export const learnerStore = new LearnerStore();
