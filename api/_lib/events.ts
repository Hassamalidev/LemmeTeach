/**
 * Turning a Paddle webhook payload into what the grant rules read.
 */
import { readSubscription } from './paddle.js';
import type { BillingEvent, SubscriptionState } from './grants.js';

export interface Payload {
  event_type?: string;
  data?: Record<string, unknown>;
}

/** Adjustments that take a payment back. A partial credit changes nothing. */
const TAKEN_BACK = new Set(['refund', 'chargeback', 'chargeback_warning']);

export type ReadEvent =
  | { event: 'subscription'; sub: SubscriptionState }
  | { event: 'refund'; subscriptionId: string };

/** Normalize an event. Null means "not one we act on". */
export function readEvent(
  payload: Payload,
  prices: Record<string, string | undefined> = process.env,
): ReadEvent | null {
  const type = payload.event_type ?? '';
  const data = payload.data ?? {};

  // Every subscription.* event carries the whole subscription, so they are
  // all the same thing to us: a fresh look at it.
  if (type.startsWith('subscription.')) {
    const sub = readSubscription(data, prices);
    return sub ? { event: 'subscription', sub } : null;
  }

  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    const action = String(data.action ?? '');
    const approved = data.status === 'approved' || action.startsWith('chargeback');
    const full = data.type === undefined || data.type === 'full';
    const subscriptionId = typeof data.subscription_id === 'string' ? data.subscription_id : '';
    if (TAKEN_BACK.has(action) && approved && full && subscriptionId) {
      return { event: 'refund', subscriptionId };
    }
  }

  return null;
}

export type { BillingEvent };
