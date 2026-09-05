/**
 * Learner memory records (§12).
 *
 * This is what makes a second lesson better than a first. It lives in
 * IndexedDB on the learner's own device and never leaves it. Every record here
 * is also visible and erasable from the UI (§12.4) — a hidden profile that
 * shapes the teaching without being inspectable would be the wrong thing to
 * build.
 */
import { z } from 'zod';
import { LEVELS, PACES, SUBJECT_IDS, type Level, type Pace, type SubjectId } from '../core/types';

export const LearnerProfileSchema = z.object({
  id: z.literal('default'),
  createdAt: z.number(),
  pace: z.enum(PACES),
  level: z.record(z.enum(SUBJECT_IDS), z.enum(LEVELS)),
  voice: z.object({ name: z.string(), rate: z.number() }).optional(),
  totals: z.object({ lessons: z.number(), minutes: z.number() }),
});

export interface LearnerProfile {
  id: 'default';
  createdAt: number;
  pace: Pace;
  level: Partial<Record<SubjectId, Level>>;
  voice?: { name: string; rate: number };
  totals: { lessons: number; minutes: number };
}

export const MisconceptionSchema = z.object({
  text: z.string(),
  seen: z.number(),
  resolved: z.boolean(),
});

export const ConceptRecordSchema = z.object({
  concept: z.string(),
  subject: z.enum(SUBJECT_IDS),
  mastery: z.number(),
  confidence: z.number(),
  lastSeen: z.number(),
  timesSeen: z.number(),
  misconceptions: z.array(MisconceptionSchema),
  evidence: z.array(z.object({ at: z.number(), delta: z.number(), note: z.string() })),
  dueAt: z.number().optional(),
  /** Index into REVIEW_INTERVALS; drives the expanding schedule in §12.3. */
  reviewStage: z.number().optional(),
});

export interface Misconception {
  text: string;
  seen: number;
  resolved: boolean;
}

export interface ConceptRecord {
  concept: string;
  subject: SubjectId;
  mastery: number;
  confidence: number;
  lastSeen: number;
  timesSeen: number;
  misconceptions: Misconception[];
  /** Last 10 only — this is re-sent to the model and has to stay small. */
  evidence: { at: number; delta: number; note: string }[];
  dueAt?: number;
  reviewStage?: number;
}

export interface LessonRecord {
  id: string;
  subject: SubjectId;
  topic: string;
  title: string;
  level: Level;
  startedAt: number;
  endedAt?: number;
  plan?: unknown;
  /** Board pages as stored ops, so a lesson can be re-read after the fact. */
  pages: unknown;
  transcript: { stepId: string; say: string; at: number }[];
  notes: { title: string; markdown: string; tags?: string[] }[];
  exam?: { score: number; strengths: string[]; gaps: string[]; verdict: string };
  masteryDiff: { concept: string; before: number; after: number }[];
  tokens?: { input: number; output: number };
}

export interface MaterialDoc {
  id: string;
  title: string;
  addedAt: number;
  bytes: number;
  pageCount: number;
  chunks: MaterialChunk[];
  /** BM25 postings, built at ingest so search is instant. */
  postings: Record<string, number[]>;
  docLengths: number[];
  avgLength: number;
}

export interface MaterialChunk {
  id: number;
  page: number;
  text: string;
}

export interface FigureRecord {
  id: string;
  lessonId: string;
  dataUrl: string;
  createdAt: number;
}
