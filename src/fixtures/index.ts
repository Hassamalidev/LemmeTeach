/**
 * Bundled fixture lessons.
 *
 * These drive three things: the board renderer during development (M2, where
 * there is no runtime at all), the integration tests, and replay mode — rung 5
 * of the degradation ladder, which is what a visitor with no key sees on the
 * landing page (§17.4).
 *
 * They are written in the shape a real session produces, one JSON object per
 * line, so the replay path and the live path consume the same records.
 */
import type { Level, SubjectId } from '../core/types';
import type { BoardOp } from '../board/op-schema';
import type { PlanLessonIn } from '../tools/schemas';

import mathRaw from './lessons/math-integration-by-parts.ndjson?raw';
import physicsRaw from './lessons/physics-projectile-motion.ndjson?raw';
import chemistryRaw from './lessons/chemistry-le-chatelier.ndjson?raw';
import csRaw from './lessons/cs-binary-search.ndjson?raw';
import biologyRaw from './lessons/biology-cellular-respiration.ndjson?raw';

export type FixtureLine =
  | {
      t: 'meta';
      subject: SubjectId;
      topic: string;
      title: string;
      level: Level;
      estimatedMinutes: number;
    }
  | ({ t: 'plan' } & PlanLessonIn)
  | { t: 'step'; say: string; board: BoardOp[]; clear?: boolean; objective?: string }
  | {
      t: 'ask';
      question: string;
      kind: 'free' | 'choice' | 'confirm' | 'number';
      options?: string[];
      why?: string;
      /** What the fixture's learner answered, for replay. */
      answer: string;
    }
  | {
      t: 'check';
      questions: {
        q: string;
        options: string[];
        answer: number;
        why: string;
        concept: string;
      }[];
      /** What the fixture's learner chose, for replay. */
      answers: number[];
    }
  | {
      t: 'code';
      language: 'python' | 'javascript';
      purpose: string;
      expect: 'value' | 'table' | 'figure' | 'text';
      source: string;
      stdout: string;
      figureId?: string;
    }
  | {
      t: 'end';
      summary: string;
      objectivesMet: string[];
      objectivesMissed: string[];
      nextTopics: string[];
      runExam: boolean;
    };

export interface FixtureLesson {
  id: string;
  meta: Extract<FixtureLine, { t: 'meta' }>;
  lines: FixtureLine[];
}

function parse(id: string, raw: string): FixtureLesson {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l) as FixtureLine;
      } catch (err) {
        throw new Error(`fixture ${id} line ${i + 1}: ${(err as Error).message}`);
      }
    });

  const meta = lines.find((l): l is Extract<FixtureLine, { t: 'meta' }> => l.t === 'meta');
  if (!meta) throw new Error(`fixture ${id} has no meta line`);
  return { id, meta, lines };
}

export const FIXTURE_LESSONS: FixtureLesson[] = [
  parse('math-integration-by-parts', mathRaw),
  parse('physics-projectile-motion', physicsRaw),
  parse('chemistry-le-chatelier', chemistryRaw),
  parse('cs-binary-search', csRaw),
  parse('biology-cellular-respiration', biologyRaw),
];

export function fixtureFor(subject: SubjectId): FixtureLesson | undefined {
  return FIXTURE_LESSONS.find((f) => f.meta.subject === subject);
}

export function fixtureById(id: string): FixtureLesson | undefined {
  return FIXTURE_LESSONS.find((f) => f.id === id);
}

/** Every board op in a fixture, in order. Used by the renderer harness. */
export function fixtureOps(lesson: FixtureLesson): BoardOp[] {
  return lesson.lines.flatMap((l) => (l.t === 'step' ? l.board : []));
}
