/**
 * Schema migrations (§20).
 *
 * Two rules, and the second one is the important one.
 *
 * 1. Migrations are explicit and versioned. Each step moves records from one
 *    version to the next and nothing skips.
 * 2. **Never wipe on a version bump.** Write a migration, or leave the record
 *    untouched. A learner's concept record is months of their work and it
 *    exists in exactly one place; "clear it and start again" is not a
 *    migration strategy, it is data loss with a changelog entry.
 *
 * A migration that throws leaves the record as it was and reports the failure.
 * Running an old app against newer data is also survivable: unknown fields are
 * ignored rather than stripped, so downgrading and upgrading again loses
 * nothing.
 */
import { allConcepts, loadProfile, saveConcept, saveProfile, SCHEMA_VERSION } from './db';
import type { ConceptRecord, LearnerProfile } from '../memory/types';

const SCHEMA_KEY = 'chalk.schema';

export interface Migration {
  /** Moves data from this version to `from + 1`. */
  from: number;
  description: string;
  run: () => Promise<void>;
}

/**
 * The list is empty because version 1 is the first shipped schema — there is
 * nothing before it to migrate from. It is here, with its plumbing tested, so
 * that the first real schema change is a five-line addition rather than a
 * design decision taken under pressure.
 *
 * To add one: append `{ from: 1, description: '…', run: async () => { … } }`
 * and bump SCHEMA_VERSION in db.ts.
 */
export const MIGRATIONS: Migration[] = [];

export function storedVersion(): number {
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    if (raw === null) return SCHEMA_VERSION; // A fresh install is current.
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : SCHEMA_VERSION;
  } catch {
    return SCHEMA_VERSION;
  }
}

function setStoredVersion(v: number): void {
  try {
    localStorage.setItem(SCHEMA_KEY, String(v));
  } catch {
    /* Storage is blocked; the session runs without persistence anyway. */
  }
}

export interface MigrationOutcome {
  from: number;
  to: number;
  applied: string[];
  /** Set when a migration threw. The data is left exactly as it was. */
  failed?: { description: string; error: string };
}

export async function migrate(
  migrations: Migration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const from = storedVersion();
  const applied: string[] = [];

  if (from > SCHEMA_VERSION) {
    // Newer data than this build understands. Leave it alone — an older app
    // reading a newer record must not "fix" it by throwing fields away.
    return { from, to: from, applied };
  }

  let version = from;
  while (version < SCHEMA_VERSION) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      // No path forward. Recording the version we reached is still correct;
      // wiping to force one would be the failure mode this file exists to
      // prevent.
      break;
    }
    try {
      await step.run();
    } catch (err) {
      return {
        from,
        to: version,
        applied,
        failed: {
          description: step.description,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
    applied.push(step.description);
    version += 1;
  }

  setStoredVersion(version);
  return { from, to: version, applied };
}

/* ------------------------------------------------------------------ *
 * Repair
 * ------------------------------------------------------------------ */

/**
 * Bring records back into range without discarding them.
 *
 * A record can go out of range through a bug, a hand-edited import, or a
 * partial write. Clamping is always better than deleting: a mastery of 1.4 is
 * wrong, but "they know this well" is still true, and dropping the record
 * loses the evidence trail and the misconceptions with it.
 */
export function repairConcept(rec: ConceptRecord): ConceptRecord {
  return {
    ...rec,
    mastery: clamp01(rec.mastery),
    confidence: clamp01(rec.confidence),
    timesSeen: nonNegative(rec.timesSeen),
    lastSeen: Number.isFinite(rec.lastSeen) && rec.lastSeen > 0 ? rec.lastSeen : Date.now(),
    misconceptions: (rec.misconceptions ?? []).filter((m) => typeof m.text === 'string'),
    evidence: (rec.evidence ?? []).slice(-10),
  };
}

export function repairProfile(profile: LearnerProfile): LearnerProfile {
  return {
    ...profile,
    totals: {
      lessons: nonNegative(profile.totals?.lessons),
      minutes: nonNegative(profile.totals?.minutes),
    },
    level: profile.level ?? {},
  };
}

/** `Math.max(0, NaN)` is NaN, so the finite check has to come first. */
function nonNegative(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

/** Run the repair over everything stored. Cheap, and safe to run at boot. */
export async function repairAll(): Promise<number> {
  let repaired = 0;

  const profile = await loadProfile();
  if (profile) {
    const fixed = repairProfile(profile);
    if (JSON.stringify(fixed) !== JSON.stringify(profile)) {
      await saveProfile(fixed);
      repaired += 1;
    }
  }

  for (const rec of await allConcepts()) {
    const fixed = repairConcept(rec);
    if (JSON.stringify(fixed) !== JSON.stringify(rec)) {
      await saveConcept(fixed);
      repaired += 1;
    }
  }

  return repaired;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
