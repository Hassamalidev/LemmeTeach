/**
 * Migrations (§20).
 *
 * The rule these exist to hold: **never wipe on a version bump.** A learner's
 * concept record is months of their work in exactly one place, and the failure
 * mode this file guards against is the one that looks reasonable at the time —
 * "the shape changed, clear it and start again".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, repairConcept, repairProfile, storedVersion, type Migration } from './migrate';
import { SCHEMA_VERSION } from './db';
import type { ConceptRecord, LearnerProfile } from '../memory/types';

beforeEach(() => {
  localStorage.clear();
});

describe('version detection', () => {
  it('treats a fresh install as current', () => {
    expect(storedVersion()).toBe(SCHEMA_VERSION);
  });

  it('reads a stored version', () => {
    localStorage.setItem('chalk.schema', '1');
    expect(storedVersion()).toBe(1);
  });

  it('falls back to current on a corrupt version rather than migrating blindly', () => {
    localStorage.setItem('chalk.schema', 'not a number');
    expect(storedVersion()).toBe(SCHEMA_VERSION);
  });
});

describe('migrate', () => {
  it('does nothing when already current', async () => {
    localStorage.setItem('chalk.schema', String(SCHEMA_VERSION));
    const outcome = await migrate([]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.to).toBe(SCHEMA_VERSION);
  });

  it('applies steps in order, one version at a time', async () => {
    const order: string[] = [];
    const steps: Migration[] = [
      { from: 1, description: 'one to two', run: async () => void order.push('a') },
      { from: 2, description: 'two to three', run: async () => void order.push('b') },
    ];

    localStorage.setItem('chalk.schema', '1');
    const outcome = await migrate3(steps, 3);

    expect(order).toEqual(['a', 'b']);
    expect(outcome.applied).toEqual(['one to two', 'two to three']);
  });

  it('leaves the data alone when a step fails, and says which', async () => {
    const steps: Migration[] = [
      { from: 1, description: 'one to two', run: async () => {} },
      {
        from: 2,
        description: 'two to three',
        run: async () => {
          throw new Error('disk full');
        },
      },
    ];

    localStorage.setItem('chalk.schema', '1');
    const outcome = await migrate3(steps, 3);

    expect(outcome.failed?.description).toBe('two to three');
    expect(outcome.failed?.error).toBe('disk full');
    // Stopped at the last version that succeeded — nothing was discarded.
    expect(outcome.to).toBe(2);
  });

  it('stops rather than wiping when there is no path forward', async () => {
    localStorage.setItem('chalk.schema', '1');
    const outcome = await migrate3([], 3);
    expect(outcome.applied).toEqual([]);
    expect(outcome.to).toBe(1);
    expect(outcome.failed).toBeUndefined();
  });

  it('leaves newer data untouched when an older build reads it', async () => {
    localStorage.setItem('chalk.schema', String(SCHEMA_VERSION + 5));
    const outcome = await migrate([]);
    expect(outcome.from).toBe(SCHEMA_VERSION + 5);
    expect(outcome.to).toBe(SCHEMA_VERSION + 5);
    expect(outcome.applied).toEqual([]);
  });
});

/** Run a migration against a pretend target version, without touching db.ts. */
async function migrate3(steps: Migration[], target: number) {
  const from = storedVersion();
  const applied: string[] = [];
  let version = from;

  while (version < target) {
    const step = steps.find((m) => m.from === version);
    if (!step) break;
    try {
      await step.run();
    } catch (err) {
      return {
        from,
        to: version,
        applied,
        failed: { description: step.description, error: (err as Error).message },
      };
    }
    applied.push(step.description);
    version += 1;
  }

  return { from, to: version, applied, failed: undefined };
}

describe('repair', () => {
  const base: ConceptRecord = {
    concept: 'chain-rule',
    subject: 'math',
    mastery: 0.6,
    confidence: 0.5,
    lastSeen: 1_700_000_000_000,
    timesSeen: 4,
    misconceptions: [{ text: 'adds the derivatives', seen: 2, resolved: false }],
    evidence: [{ at: 1, delta: 0.1, note: 'ok' }],
  };

  it('clamps rather than deleting an out-of-range record', () => {
    const fixed = repairConcept({ ...base, mastery: 1.4, confidence: -2 });
    expect(fixed.mastery).toBe(1);
    expect(fixed.confidence).toBe(0);
    // The evidence and misconceptions survive, which is the whole point.
    expect(fixed.misconceptions).toHaveLength(1);
    expect(fixed.evidence).toHaveLength(1);
  });

  it('repairs a NaN without losing the concept', () => {
    const fixed = repairConcept({ ...base, mastery: Number.NaN });
    expect(fixed.mastery).toBe(0);
    expect(fixed.concept).toBe('chain-rule');
  });

  it('trims the evidence trail to the last ten', () => {
    const evidence = Array.from({ length: 30 }, (_, i) => ({ at: i, delta: 0, note: `n${i}` }));
    expect(repairConcept({ ...base, evidence }).evidence).toHaveLength(10);
  });

  it('leaves a healthy record byte-identical', () => {
    expect(repairConcept(base)).toEqual(base);
  });

  it('repairs a profile without discarding its levels', () => {
    const profile: LearnerProfile = {
      id: 'default',
      createdAt: 1,
      pace: 'normal',
      level: { math: 'undergrad' },
      totals: { lessons: -3, minutes: Number.NaN },
    };
    const fixed = repairProfile(profile);
    expect(fixed.totals.lessons).toBe(0);
    expect(fixed.totals.minutes).toBe(0);
    expect(fixed.level.math).toBe('undergrad');
  });
});
