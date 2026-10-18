/**
 * Where the buying happens (§24).
 *
 * Checkout and the billing portal are Lemon Squeezy pages, so these are plain
 * links supplied at build time. A build without them is the demo-only build:
 * the plan buttons are disabled and say so, rather than leading nowhere.
 */
import type { PlanId } from '../../shared/plans';

const CHECKOUT: Record<PlanId, string | undefined> = {
  starter: import.meta.env.VITE_CHECKOUT_STARTER,
  regular: import.meta.env.VITE_CHECKOUT_REGULAR,
  intensive: import.meta.env.VITE_CHECKOUT_INTENSIVE,
};

function httpsOnly(url: string | undefined): string | null {
  return url && /^https:\/\//.test(url) ? url : null;
}

export function checkoutUrl(plan: PlanId): string | null {
  return httpsOnly(CHECKOUT[plan]);
}

/** Lemon Squeezy's own customer page is the fallback: every buyer has one. */
export function billingPortalUrl(): string {
  return httpsOnly(import.meta.env.VITE_BILLING_PORTAL_URL) ?? 'https://app.lemonsqueezy.com/my-orders';
}
