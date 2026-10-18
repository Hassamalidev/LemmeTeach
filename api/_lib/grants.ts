/**
 * The grant rules (§28.3).
 *
 * A pure function from (what Lemon Squeezy just told us, what OpenRouter
 * currently holds) to one action. No network in here, which is the point: the
 * rules that decide who gets credit are the ones that must be testable
 * exhaustively, and every one of them has to be idempotent because webhooks
 * are retried.
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

/** What a webhook says about a subscription, already normalized. */
export interface SubscriptionState {
  orderId: string;
  planId: PlanId | null;
  status: string;
  /** ISO timestamp of the next renewal, where the event carries one. */
  renewsAt: string | null;
}

export type BillingEvent =
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_expired'
  | 'order_refunded';

export type Action =
  | { do: 'none'; why: string }
  | { do: 'create'; name: string; limit: number }
  | { do: 'update'; hash: string; patch: { name?: string; limit?: number; disabled?: boolean } };

/* ------------------------------ the key name ------------------------------ */

const PREFIX = 'lemmeteach';
/** A key made by activation before any webhook arrived. */
export const INIT_MARKER = 'init';

export interface KeyName {
  orderId: string;
  planId: PlanId;
  /** Epoch seconds of `renews_at` at the last grant, or `init`. */
  marker: string;
}

export function formatKeyName(n: KeyName): string {
  return `${PREFIX}:o${n.orderId}:p${n.planId}:r${n.marker}`;
}

export function parseKeyName(name: string): KeyName | null {
  const m = /^lemmeteach:o([^:]+):p([^:]+):r([^:]+)$/.exec(name);
  if (!m) return null;
  const plan = planById(m[2]);
  if (!plan || !m[1] || !m[3]) return null;
  return { orderId: m[1], planId: plan.id, marker: m[3] };
}

export function keyBelongsToOrder(name: string, orderId: string): boolean {
  return parseKeyName(name)?.orderId === orderId;
}

/** `renews_at` as a marker: epoch seconds, or `init` when there is none. */
export function markerFor(renewsAt: string | null): string {
  if (!renewsAt) return INIT_MARKER;
  const ms = Date.parse(renewsAt);
  return Number.isFinite(ms) ? String(Math.floor(ms / 1000)) : INIT_MARKER;
}

/* -------------------------------- the rules ------------------------------- */

/** Statuses that mean nobody is paying for this subscription any more. */
const ENDED = new Set(['expired', 'unpaid', 'paused']);
/** Statuses under which a key may be created or topped up. */
const PAYING = new Set(['active', 'on_trial']);

export function decide(
  event: BillingEvent,
  sub: SubscriptionState,
  key: KeyRecord | null,
): Action {
  const ended =
    event === 'subscription_expired' || event === 'order_refunded' || ENDED.has(sub.status);

  if (ended) {
    if (!key) return { do: 'none', why: 'ended, and there is no key to disable' };
    if (key.disabled) return { do: 'none', why: 'already disabled' };
    return { do: 'update', hash: key.hash, patch: { disabled: true } };
  }

  const plan = planById(sub.planId);
  if (!plan) return { do: 'none', why: 'not one of our plans' };

  if (!PAYING.has(sub.status)) {
    // Cancelled-but-paid-up, or a payment being retried: leave things alone.
    return { do: 'none', why: `status ${sub.status} changes nothing` };
  }

  const marker = markerFor(sub.renewsAt);

  if (!key) {
    return {
      do: 'create',
      name: formatKeyName({ orderId: sub.orderId, planId: plan.id, marker }),
      limit: plan.creditUsd,
    };
  }

  const current = parseKeyName(key.name);
  if (!current) return { do: 'none', why: 'key name is not one of ours' };

  const patch: { name?: string; limit?: number; disabled?: boolean } = {};
  if (key.disabled) patch.disabled = false;

  const rename = (planId: PlanId, m: string): void => {
    const name = formatKeyName({ orderId: current.orderId, planId, marker: m });
    if (name !== key.name) patch.name = name;
  };

  if (current.marker === INIT_MARKER) {
    // Activation got here first and already granted this period's credit.
    // Record which period that was; granting again would double it.
    if (marker !== INIT_MARKER) rename(current.planId, marker);
  } else if (marker !== INIT_MARKER && Number(marker) > Number(current.marker)) {
    // A new paid period. The cap is cumulative, so "this period's credit" is
    // whatever has been spent so far plus one period more. Unused credit from
    // the last period is dropped here, not carried over (§27.3).
    patch.limit = round(key.usage + plan.creditUsd);
    rename(plan.id, marker);
  } else if (plan.id !== current.planId) {
    const before = planById(current.planId);
    const extra = plan.creditUsd - (before?.creditUsd ?? plan.creditUsd);
    if (extra > 0) {
      // Upgraded mid-period: add the difference now.
      patch.limit = round((key.limit ?? key.usage) + extra);
      rename(plan.id, current.marker);
    }
    // A downgrade waits for the next renewal, which grants the smaller plan.
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
