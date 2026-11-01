/**
 * The grant rules (§28.3).
 *
 * A pure function from (what Paddle says about a subscription, what OpenRouter
 * currently holds) to one action. No network in here, which is the point: the
 * rules that decide who gets credit are the ones that must be testable
 * exhaustively, and every one of them has to be idempotent because webhooks
 * are retried and activation runs the same rules again.
 */
import { planById, type PlanId } from '../../shared/plans.js';

/** The subset of an OpenRouter key that the rules read. */
export interface KeyRecord {
  hash: string;
  name: string;
  /** Spending cap in USD, cumulative over the key's life. */
  limit: number | null;
  /** USD spent so far, cumulative. */
  usage: number;
  disabled: boolean;
}

/** What Paddle says about a subscription, already normalized. */
export interface SubscriptionState {
  subscriptionId: string;
  planId: PlanId | null;
  /** Paddle's status: `active`, `trialing`, `past_due`, `paused` or `canceled`. */
  status: string;
  /** When the current paid period began, ISO. Null when Paddle sent none. */
  periodStart: string | null;
}

/**
 * What happened. Almost everything is a fresh look at the subscription;
 * a refund or a chargeback is the one thing the subscription's own status
 * does not show.
 */
export type BillingEvent = 'subscription' | 'refund';

export type Action =
  | { do: 'none'; why: string }
  | { do: 'create'; name: string; limit: number }
  | { do: 'update'; hash: string; patch: { name?: string; limit?: number; disabled?: boolean } };

/* ------------------------------ the key name ------------------------------ */

const PREFIX = 'lemmeteach';

export interface KeyName {
  subscriptionId: string;
  planId: PlanId;
  /** Epoch seconds of the start of the period last granted. */
  marker: string;
  /** That period's payment was refunded or charged back. */
  refunded: boolean;
}

export function formatKeyName(n: KeyName): string {
  return `${PREFIX}:s${n.subscriptionId}:p${n.planId}:r${n.marker}${n.refunded ? ':refunded' : ''}`;
}

export function parseKeyName(name: string): KeyName | null {
  const m = /^lemmeteach:s([^:]+):p([^:]+):r(\d+)(:refunded)?$/.exec(name);
  if (!m) return null;
  const plan = planById(m[2]);
  if (!plan || !m[1] || !m[3]) return null;
  return { subscriptionId: m[1], planId: plan.id, marker: m[3], refunded: m[4] !== undefined };
}

export function keyBelongsTo(name: string, subscriptionId: string): boolean {
  return parseKeyName(name)?.subscriptionId === subscriptionId;
}

/** The start of a period as a marker: epoch seconds, or null when unreadable. */
export function markerFor(periodStart: string | null): string | null {
  if (!periodStart) return null;
  const ms = Date.parse(periodStart);
  return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : null;
}

/* -------------------------------- the rules ------------------------------- */

/** Statuses that mean nobody is paying for this subscription any more. */
const ENDED = new Set(['canceled', 'paused']);
/** Statuses under which a key may be created or topped up. */
const PAYING = new Set(['active', 'trialing']);

export function decide(event: BillingEvent, sub: SubscriptionState, key: KeyRecord | null): Action {
  const current = key ? parseKeyName(key.name) : null;
  if (key && !current) return { do: 'none', why: 'key name is not one of ours' };

  if (event === 'refund') {
    if (!key || !current) return { do: 'none', why: 'refunded, and there is no key to disable' };
    if (key.disabled && current.refunded) return { do: 'none', why: 'already disabled' };
    // Marked as well as disabled, so a later look at a still-active
    // subscription does not switch it back on for the period refunded.
    return {
      do: 'update',
      hash: key.hash,
      patch: { disabled: true, name: formatKeyName({ ...current, refunded: true }) },
    };
  }

  if (ENDED.has(sub.status)) {
    if (!key) return { do: 'none', why: 'ended, and there is no key to disable' };
    if (key.disabled) return { do: 'none', why: 'already disabled' };
    return { do: 'update', hash: key.hash, patch: { disabled: true } };
  }

  const plan = planById(sub.planId);
  if (!plan) return { do: 'none', why: 'not one of our plans' };

  if (!PAYING.has(sub.status)) {
    // A renewal payment being retried: what was paid for still works, and
    // nothing new is granted until it succeeds.
    return { do: 'none', why: `status ${sub.status} changes nothing` };
  }

  const marker = markerFor(sub.periodStart);
  if (!marker) return { do: 'none', why: 'no billing period to grant against' };

  if (!key || !current) {
    return {
      do: 'create',
      name: formatKeyName({ subscriptionId: sub.subscriptionId, planId: plan.id, marker, refunded: false }),
      limit: plan.creditUsd,
    };
  }

  const patch: { name?: string; limit?: number; disabled?: boolean } = {};
  const rename = (next: KeyName): void => {
    const name = formatKeyName(next);
    if (name !== key.name) patch.name = name;
  };

  if (Number(marker) > Number(current.marker)) {
    // A new paid period. The cap is cumulative, so "this period's credit" is
    // whatever has been spent so far plus one period more. Unused credit from
    // the last period is dropped here, not carried over (§27.3). A new
    // payment also lifts a refund on an earlier one.
    patch.limit = round(key.usage + plan.creditUsd);
    if (key.disabled) patch.disabled = false;
    rename({ ...current, planId: plan.id, marker, refunded: false });
  } else if (current.refunded) {
    return { do: 'none', why: 'this period was refunded' };
  } else {
    if (key.disabled) patch.disabled = false;
    if (plan.id !== current.planId) {
      const before = planById(current.planId);
      const extra = plan.creditUsd - (before?.creditUsd ?? plan.creditUsd);
      if (extra > 0) {
        // Upgraded mid-period: add the difference now.
        patch.limit = round((key.limit ?? key.usage) + extra);
        rename({ ...current, planId: plan.id });
      }
      // A downgrade waits for the next renewal, which grants the smaller plan.
    }
  }

  if (Object.keys(patch).length === 0) return { do: 'none', why: 'nothing has changed' };
  return { do: 'update', hash: key.hash, patch };
}

/** Credit left on a key. Never negative, never more than the cap. */
export function remainingOn(key: KeyRecord): number {
  if (key.limit === null) return 0; // An uncapped key is not one we issued.
  return round(Math.max(0, key.limit - key.usage));
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}
