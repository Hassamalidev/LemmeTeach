/**
 * The managed provider (§5): what a subscriber's lessons run on.
 *
 * A subscriber never picks a provider or types a model id. Their plan funds a
 * spend-capped OpenRouter key (§28), and the models are chosen here. This file
 * is the one place that knows which gateway that is, so the screens above can
 * ask "what is left?" and "which models?" without naming it.
 */
import type { ProviderId } from '../core/types';

export const MANAGED_PROVIDER_ID: ProviderId = 'openrouter';
/** The adapter behind the free demo: bundled lessons, no key, no network. */
export const DEMO_PROVIDER_ID: ProviderId = 'mock';

const BASE = 'https://openrouter.ai/api/v1';

export type Quality = 'standard' | 'deep';

export interface ModelSet {
  /** The reader. */
  planner: string;
  /** The solver. */
  tutor: string;
  repairer: string;
}

const FAST = 'anthropic/claude-haiku-5.5';
const STRONG = 'anthropic/claude-sonnet-5.5';

/**
 * A second model at the same price, tried by the gateway when the first is
 * unavailable. A learner mid-lesson should not be the one to find out that a
 * model is having a bad hour.
 */
const FALLBACKS: Record<string, string> = {
  [FAST]: 'openai/gpt-6-luna',
  [STRONG]: 'openai/gpt-6.1-sol',
};

export function fallbackFor(model: string): string | null {
  return FALLBACKS[model] ?? null;
}

/**
 * The lesson counts on the pricing page are computed from the standard tier
 * (shared/plans.ts). Changing a model here changes what a plan is worth, so
 * re-check TYPICAL_LESSON_USD and the price table in pricing.ts with it.
 */
const TIERS: Record<Quality, ModelSet> = {
  standard: { planner: FAST, tutor: FAST, repairer: FAST },
  // Only the solving itself moves up; reading the question stays on the fast
  // model, which is most of why the deeper tier is eight times the cost and
  // not twenty.
  deep: { planner: FAST, tutor: STRONG, repairer: FAST },
};

export function managedModels(quality: Quality): ModelSet {
  return TIERS[quality];
}

/** Roughly how much faster the deeper tier uses credit. Shown in Settings. */
export const DEEP_COST_MULTIPLE = 8;

export interface Credit {
  /** This period's cap in USD. */
  limitUsd: number;
  /** What is left of it. */
  remainingUsd: number;
}

/**
 * Read what is left on a subscriber's key, straight from the gateway.
 *
 * Returns null on any failure: the credit line shows nothing rather than a
 * wrong number (§18), and a failed read must never block a lesson.
 */
export async function fetchCredit(apiKey: string, signal?: AbortSignal): Promise<Credit | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(`${BASE}/key`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { limit?: number | null; limit_remaining?: number | null };
    };
    const limit = body.data?.limit;
    const remaining = body.data?.limit_remaining;
    if (typeof limit !== 'number' || typeof remaining !== 'number') return null;
    return { limitUsd: limit, remainingUsd: Math.max(0, remaining) };
  } catch {
    return null;
  }
}
