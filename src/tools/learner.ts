/**
 * recall_learner and update_learner (§9.8, §9.9).
 *
 * The two halves of the thing that makes a second session better than a first.
 * Note that `update_learner` reports an *observation*: the store applies the
 * decay-and-blend rule in §12.2 rather than overwriting, so a single lucky
 * answer cannot jump a concept to mastered. The prompt says so, because a
 * model handed a "mastery" field will otherwise try to maintain the running
 * average itself.
 */
import { conceptSlug } from '../core/types';
import { decayedMastery, masteryLabel, openMisconceptions } from '../memory/concepts';
import type { Tool, ToolOutcome } from './index';
import type { ToolContext } from './context';
import {
  RecallLearnerInput,
  UpdateLearnerInput,
  type RecallLearnerIn,
  type UpdateLearnerIn,
} from './schemas';

export const recallLearner: Tool = {
  name: 'recall_learner',
  description: `Read what this learner already knows, from their own record on this device.

Call it before you decide where to start. Re-teaching something they hold at "solid" wastes their time and is the most common way a system like this fails them; skipping a prerequisite they have never met is the second.

You get, per concept: how well they hold it, how much evidence that rests on, when they last saw it, and any misconception recorded in their own terms. Misconceptions are the useful part — if the record says they add derivatives instead of using the product form, you already know what your first example should catch.

Ask for specific concepts. With no concepts you get a short profile summary instead of the whole record, which is deliberate: the record is re-sent on every later turn and a large one is expensive.`,
  schema: RecallLearnerInput,
  agents: ['planner', 'tutor', 'examiner'],
  parallelSafe: true,
  suspends: false,

  async run(input: RecallLearnerIn, ctx: ToolContext): Promise<ToolOutcome> {
    const profile = await ctx.memory.profile();
    const recentLessons = input.includeRecentLessons
      ? await ctx.memory.recentLessonTitles(3)
      : undefined;

    if (!input.concepts || input.concepts.length === 0) {
      const all = await ctx.memory.concepts();
      const forSubject = all.filter((c) => c.subject === ctx.subject);
      const top = [...forSubject]
        .sort((a, b) => decayedMastery(b) - decayedMastery(a))
        .slice(0, 8)
        .map((c) => `${c.concept} (${masteryLabel(decayedMastery(c))})`);
      const openIssues = forSubject
        .flatMap((c) => openMisconceptions(c).map((m) => `${c.concept}: ${m.text}`))
        .slice(0, 5);

      return {
        ok: true,
        data: {
          summary: {
            lessonsTaken: profile.totals.lessons,
            pace: profile.pace,
            level: profile.level[ctx.subject] ?? null,
            conceptsRecorded: forSubject.length,
            strongest: top,
            openMisconceptions: openIssues,
            recentLessons,
          },
        },
        message:
          forSubject.length === 0
            ? 'This is their first lesson in this subject — nothing recorded yet. Start from the beginning and check as you go rather than assuming.'
            : undefined,
      };
    }

    const slugs = input.concepts.map(conceptSlug);
    const records = await ctx.memory.concepts(slugs);
    const byConcept = new Map(records.map((r) => [r.concept, r]));

    const out = slugs.map((slug) => {
      const rec = byConcept.get(slug);
      if (!rec) return { concept: slug, known: false as const };
      const m = decayedMastery(rec);
      return {
        concept: slug,
        known: true as const,
        mastery: Number(m.toFixed(2)),
        level: masteryLabel(m),
        confidence: Number(rec.confidence.toFixed(2)),
        lastSeenDaysAgo: Math.floor((Date.now() - rec.lastSeen) / 86_400_000),
        timesSeen: rec.timesSeen,
        misconceptions: openMisconceptions(rec).map((m2) => m2.text),
      };
    });

    return { ok: true, data: { concepts: out, pace: profile.pace, recentLessons } };
  },
};

export const updateLearner: Tool = {
  name: 'update_learner',
  description: `Record what you just saw this learner do.

Update as the evidence appears, not in a batch at the end — a lesson that ends early still has to leave an accurate record behind.

"mastery" is your reading of this moment, not a running average: the store decays the old value by how long it has been and blends yours in, weighted by the confidence you give. So report the observation honestly and let the store do the arithmetic. A single correct answer to an easy question is around 0.6 mastery at 0.3 confidence, not 1.0.

"misconception" is the most valuable field in the whole system. Write the belief in the learner's own terms — "thinks the derivative of a product is the product of the derivatives" — so that a future lesson can catch it with one example. Set "resolved" when a misconception you had on record has visibly cleared up.`,
  schema: UpdateLearnerInput,
  agents: ['tutor', 'examiner'],
  parallelSafe: false,
  suspends: false,

  async run(input: UpdateLearnerIn, ctx: ToolContext): Promise<ToolOutcome> {
    const applied: { concept: string; mastery: number; level: string }[] = [];

    for (const u of input.updates) {
      const slug = conceptSlug(u.concept);
      const rec = await ctx.memory.observe(slug, ctx.subject, {
        mastery: u.mastery,
        confidence: u.confidence,
        evidence: u.evidence,
        misconception: u.misconception,
        resolved: u.resolved,
      });
      applied.push({
        concept: slug,
        mastery: Number(rec.mastery.toFixed(2)),
        level: masteryLabel(rec.mastery),
      });
    }

    return {
      ok: true,
      data: { updated: applied },
      message:
        'Recorded. The figures shown are after blending with their history, so they will not match what you sent exactly.',
    };
  },
};
