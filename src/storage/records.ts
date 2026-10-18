/**
 * What is kept on the learner's device (§20).
 *
 * Two things: the questions they have had solved, and the figures those
 * solutions drew. Both live in IndexedDB in their own browser and never leave
 * it.
 */
import type { Level, SubjectId } from '../core/types';

/** One solved question, as it is saved when the solution ends. */
export interface SolutionRecord {
  id: string;
  subject: SubjectId;
  /** The question, in the learner's own words. */
  topic: string;
  title: string;
  level: Level;
  startedAt: number;
  endedAt?: number;
  plan?: unknown;
  /** Board pages as stored ops, so a solution can be re-read after the fact. */
  pages: unknown;
  transcript: { stepId: string; say: string; at: number }[];
  notes: { title: string; markdown: string; tags?: string[] }[];
  /** How it ended. Present on a finished solution, and needed to replay one. */
  ending?: { summary: string; objectivesMet: string[]; objectivesMissed: string[]; nextTopics: string[] };
  tokens?: { input: number; output: number };
}

export interface FigureRecord {
  id: string;
  lessonId: string;
  dataUrl: string;
  createdAt: number;
}
