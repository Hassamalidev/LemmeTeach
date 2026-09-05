/**
 * Concept records and the mastery update rule (§12.2).
 *
 * The rule below is deliberately not an assignment, and this comment exists so
 * that nobody "simplifies" it into one.
 *
 * Two things have to be true at once. A learner who answered one question
 * correctly six weeks ago should not still read as mastered — knowledge decays
 * and the record has to admit that. And a learner who slips on one question
 * today should not lose a month of demonstrated work — a single observation is
 * weak evidence, not a verdict.
 *
 * So: decay by elapsed time first, then blend the new observation in with a
 * weight that grows with how much the observation is worth. One lucky guess
 * cannot mark a concept mastered; one bad day cannot erase it.
 */
import { clamp01, now, type SubjectId } from '../core/types';
import type { ConceptRecord, Misconception } from './types';

/** Roughly a 30-day decay constant — a month unseen costs about a third. */
export const DECAY_DAYS = 30;

export interface Observation {
  mastery?: number;
  /** 0..1. How much this single observation is worth. Defaults to middling. */
  confidence?: number;
  evidence?: string;
  misconception?: string;
  resolved?: boolean;
}

export function emptyRecord(concept: string, subject: SubjectId): ConceptRecord {
  return {
    concept,
    subject,
    mastery: 0,
    confidence: 0,
    lastSeen: now(),
    timesSeen: 0,
    misconceptions: [],
    evidence: [],
  };
}

/** Mastery decayed to `at`, without mutating the record. Used for display too. */
export function decayedMastery(rec: ConceptRecord, at: number = now()): number {
  const days = Math.max(0, (at - rec.lastSeen) / 86_400_000);
  return clamp01(rec.mastery * Math.exp(-days / DECAY_DAYS));
}

export function applyObservation(
  rec: ConceptRecord,
  obs: Observation,
  at: number = now(),
): ConceptRecord {
  const next: ConceptRecord = {
    ...rec,
    misconceptions: rec.misconceptions.map((m) => ({ ...m })),
    evidence: [...rec.evidence],
  };

  const before = rec.mastery;

  if (typeof obs.mastery === 'number') {
    const decayed = decayedMastery(rec, at);
    const observationConfidence = clamp01(obs.confidence ?? 0.5);
    // 0.25 at no confidence, 0.60 at full: even a certain observation moves
    // the record a bit over half way, never all the way.
    const w = 0.25 + 0.35 * observationConfidence;
    next.mastery = clamp01(decayed * (1 - w) + clamp01(obs.mastery) * w);
    next.confidence = clamp01(rec.confidence * 0.9 + 0.2);
  }

  next.lastSeen = at;
  next.timesSeen = rec.timesSeen + 1;

  if (obs.evidence) {
    next.evidence = [
      ...next.evidence,
      { at, delta: Number((next.mastery - before).toFixed(3)), note: obs.evidence },
    ].slice(-10);
  }

  if (obs.misconception) {
    const key = normalizeMisconception(obs.misconception);
    const existing = next.misconceptions.find((m) => normalizeMisconception(m.text) === key);
    if (existing) {
      existing.seen += 1;
      existing.resolved = false;
    } else {
      next.misconceptions = [
        ...next.misconceptions,
        { text: obs.misconception, seen: 1, resolved: false },
      ].slice(-8);
    }
  }

  if (obs.resolved) {
    // Resolving without naming which one clears the most recent open note,
    // which is what "we just cleared that up" means in practice.
    const target = obs.misconception
      ? next.misconceptions.find(
          (m) => normalizeMisconception(m.text) === normalizeMisconception(obs.misconception!),
        )
      : [...next.misconceptions].reverse().find((m) => !m.resolved);
    if (target) target.resolved = true;
  }

  return next;
}

function normalizeMisconception(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function openMisconceptions(rec: ConceptRecord): Misconception[] {
  return rec.misconceptions.filter((m) => !m.resolved);
}

/** A short human phrase for a mastery number, used in the UI and in prompts. */
export function masteryLabel(m: number): string {
  if (m >= 0.85) return 'solid';
  if (m >= 0.65) return 'mostly there';
  if (m >= 0.4) return 'shaky';
  if (m > 0) return 'just started';
  return 'new';
}
