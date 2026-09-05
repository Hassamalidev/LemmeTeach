/**
 * Spaced review (§12.3).
 *
 * An expanding schedule — 1, 3, 7, 16, 35 days — that advances on a pass and
 * steps back one interval on a failure. Deliberately not SM-2: without a
 * per-card quality rating from the learner there is nothing to feed the
 * harder algorithm, and a schedule nobody can explain is a schedule nobody
 * trusts.
 */
import { now } from '../core/types';
import type { ConceptRecord } from './types';
import { decayedMastery } from './concepts';

export const REVIEW_INTERVALS = [1, 3, 7, 16, 35] as const;

export function nextDue(stage: number, at: number = now()): { dueAt: number; stage: number } {
  const s = Math.max(0, Math.min(REVIEW_INTERVALS.length - 1, stage));
  const days = REVIEW_INTERVALS[s] ?? 1;
  return { dueAt: at + days * 86_400_000, stage: s };
}

export function advanceReview(rec: ConceptRecord, passed: boolean, at: number = now()): ConceptRecord {
  const stage = rec.reviewStage ?? 0;
  const next = passed ? stage + 1 : stage - 1;
  const { dueAt, stage: clamped } = nextDue(next, at);
  return { ...rec, dueAt, reviewStage: clamped };
}

/** Schedule an explicit review N days out, as `schedule_review` asks. */
export function scheduleIn(rec: ConceptRecord, days: number, at: number = now()): ConceptRecord {
  return { ...rec, dueAt: at + Math.max(1, days) * 86_400_000 };
}

export interface DueItem {
  concept: string;
  record: ConceptRecord;
  mastery: number;
  overdueDays: number;
}

export function dueForReview(records: ConceptRecord[], at: number = now()): DueItem[] {
  return records
    .filter((r) => typeof r.dueAt === 'number' && r.dueAt <= at)
    .map((r) => ({
      concept: r.concept,
      record: r,
      mastery: decayedMastery(r, at),
      overdueDays: Math.floor((at - (r.dueAt ?? at)) / 86_400_000),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays || a.mastery - b.mastery);
}
