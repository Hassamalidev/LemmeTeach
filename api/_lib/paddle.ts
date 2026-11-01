/**
 * Paddle: reading transactions and subscriptions, and verifying webhooks (§28).
 *
 * The API key used here is a server environment variable and never reaches a
 * browser. Only read calls are made: nothing here changes anything in Paddle.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLAN_IDS, type PlanId } from '../../shared/plans.js';
import { env, UpstreamError } from './http.js';
import type { SubscriptionState } from './grants.js';

function base(): string {
  return process.env.PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
}

/** One GET against Paddle. A 404 is "no such thing", not an outage. */
async function get(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${base()}${path}`, {
    headers: { authorization: `Bearer ${env('PADDLE_API_KEY')}`, accept: 'application/json' },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new UpstreamError('paddle', res.status);
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
  if (!body?.data) throw new UpstreamError('paddle', 502);
  return body.data;
}

export interface TransactionCheck {
  /** Paddle's status: `draft`, `ready`, `billed`, `paid`, `completed`, `canceled`, `past_due`. */
  status: string;
  subscriptionId: string | null;
}

export async function getTransaction(id: string): Promise<TransactionCheck | null> {
  const data = await get(`/transactions/${encodeURIComponent(id)}`);
  if (!data) return null;
  return {
    status: String(data.status ?? 'unknown'),
    subscriptionId: typeof data.subscription_id === 'string' ? data.subscription_id : null,
  };
}

export async function getSubscription(id: string): Promise<SubscriptionState | null> {
  const data = await get(`/subscriptions/${encodeURIComponent(id)}`);
  return data ? readSubscription(data) : null;
}

/** A subscription entity, from the API or from a webhook, as the rules read it. */
export function readSubscription(
  data: Record<string, unknown>,
  prices: Record<string, string | undefined> = process.env,
): SubscriptionState | null {
  if (typeof data.id !== 'string' || !data.id) return null;
  const items = Array.isArray(data.items) ? (data.items as { price?: { id?: unknown } }[]) : [];
  // Our plans are single-item subscriptions: the first item says which.
  const priceId = items[0]?.price?.id;
  const period = data.current_billing_period as { starts_at?: unknown } | null | undefined;
  return {
    subscriptionId: data.id,
    planId: planForPrice(typeof priceId === 'string' ? priceId : '', prices),
    status: String(data.status ?? 'unknown'),
    periodStart: typeof period?.starts_at === 'string' ? period.starts_at : null,
  };
}

/**
 * Which plan a Paddle price is. The mapping is configuration, not code,
 * because price ids differ between the sandbox and the live account.
 */
export function planForPrice(
  priceId: string,
  source: Record<string, string | undefined> = process.env,
): PlanId | null {
  if (!priceId) return null;
  for (const id of PLAN_IDS) {
    if (source[`PADDLE_PRICE_${id.toUpperCase()}`] === priceId) return id;
  }
  return null;
}

/** How far a webhook's signing time may be from ours before it is refused. */
const TOLERANCE_SECONDS = 300;

/**
 * Verify a webhook's `Paddle-Signature`: `ts=<seconds>;h1=<hex>`, where h1 is
 * an HMAC-SHA256 of `<ts>:<raw body>`. Compared in constant time, before
 * anything in the body is trusted. Several h1 values appear while a secret is
 * being rotated; any one matching is enough. An old timestamp is refused, so
 * a captured request cannot be replayed later.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (!header || !secret) return false;
  let ts = '';
  const hashes: string[] = [];
  for (const part of header.split(';')) {
    const [k, v] = part.split('=', 2).map((s) => s.trim());
    if (k === 'ts' && v) ts = v;
    if (k === 'h1' && v) hashes.push(v);
  }
  if (!/^\d+$/.test(ts) || hashes.length === 0) return false;
  if (Math.abs(nowSeconds - Number(ts)) > TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex'), 'utf8');
  return hashes.some((h) => {
    const given = Buffer.from(h, 'utf8');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
