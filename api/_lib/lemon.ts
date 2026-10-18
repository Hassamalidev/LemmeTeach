/**
 * Lemon Squeezy: license validation and webhook verification (§28).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLAN_IDS, type PlanId } from '../../shared/plans.js';
import { UpstreamError } from './http.js';

const LICENSE_API = 'https://api.lemonsqueezy.com/v1/licenses';

export interface LicenseCheck {
  valid: boolean;
  /** `active`, `inactive`, `expired` or `disabled`. */
  status: string;
  storeId: string;
  orderId: string;
  variantId: string;
}

/** Ask Lemon Squeezy whether a license key is real and current. */
export async function validateLicense(licenseKey: string): Promise<LicenseCheck> {
  const res = await fetch(`${LICENSE_API}/validate`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ license_key: licenseKey }).toString(),
  });

  // An unknown key comes back as a 4xx with a JSON body saying so; only a
  // response we cannot read at all is an upstream failure.
  const body = (await res.json().catch(() => null)) as {
    valid?: boolean;
    license_key?: { status?: string };
    meta?: { store_id?: number; order_id?: number; variant_id?: number };
  } | null;
  if (!body) throw new UpstreamError('lemonsqueezy', res.status);

  return {
    valid: body.valid === true,
    status: body.license_key?.status ?? 'unknown',
    storeId: String(body.meta?.store_id ?? ''),
    orderId: String(body.meta?.order_id ?? ''),
    variantId: String(body.meta?.variant_id ?? ''),
  };
}

/**
 * Which plan a Lemon Squeezy variant is. The mapping is configuration, not
 * code, because variant ids differ between a test store and the live one.
 */
export function planForVariant(
  variantId: string,
  source: Record<string, string | undefined> = process.env,
): PlanId | null {
  if (!variantId) return null;
  for (const id of PLAN_IDS) {
    if (source[`LEMON_VARIANT_${id.toUpperCase()}`] === variantId) return id;
  }
  return null;
}

/**
 * Verify a webhook's `X-Signature`: HMAC-SHA256 of the raw body, hex encoded.
 * Compared in constant time, and before anything in the body is trusted.
 */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
