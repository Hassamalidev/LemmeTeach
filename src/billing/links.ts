/**
 * Where a subscriber manages their subscription (§24).
 *
 * Paddle hosts a customer portal for each seller, at an address shown in the
 * Paddle dashboard under Checkout → Customer portal. It is supplied at build
 * time. Without it, the app points to the link in Paddle's receipt email,
 * which every buyer has.
 */
export function billingPortalUrl(): string | null {
  const url = import.meta.env.VITE_BILLING_PORTAL_URL;
  return url && /^https:\/\//.test(url) ? url : null;
}

export const NO_PORTAL =
  'To change plan or cancel, use the link to manage your subscription in the receipt email Paddle sent you.';
