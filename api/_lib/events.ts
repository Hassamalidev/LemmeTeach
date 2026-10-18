/**
 * Turning a Lemon Squeezy webhook payload into what the grant rules read.
 */
import { planForVariant } from './lemon.js';
import type { BillingEvent, SubscriptionState } from './grants.js';

const HANDLED: readonly BillingEvent[] = [
  'subscription_created',
  'subscription_updated',
  'subscription_expired',
  'order_refunded',
];

export interface Payload {
  meta?: { event_name?: string };
  data?: {
    id?: string | number;
    attributes?: {
      order_id?: number;
      variant_id?: number;
      status?: string;
      renews_at?: string | null;
    };
  };
}

/** Normalize an event into what the grant rules read. Null means "not ours". */
export function readEvent(
  payload: Payload,
  variants: Record<string, string | undefined> = process.env,
): { event: BillingEvent; sub: SubscriptionState } | null {
  const event = payload.meta?.event_name as BillingEvent | undefined;
  if (!event || !HANDLED.includes(event)) return null;

  const attrs = payload.data?.attributes ?? {};
  // A refund arrives as the order itself; every other event is a subscription
  // that names its order.
  const orderId = event === 'order_refunded' ? payload.data?.id : attrs.order_id;
  if (orderId === undefined || orderId === null || orderId === '') return null;

  return {
    event,
    sub: {
      orderId: String(orderId),
      planId: planForVariant(String(attrs.variant_id ?? ''), variants),
      status: event === 'order_refunded' ? 'refunded' : (attrs.status ?? 'unknown'),
      renewsAt: attrs.renews_at ?? null,
    },
  };
}
