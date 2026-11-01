/**
 * Small helpers shared by the server functions (§28, §30).
 */
import { createHmac } from 'node:crypto';

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** A server environment variable, or a thrown error naming the one missing. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(name);
  return value;
}

export class ConfigError extends Error {
  constructor(readonly variable: string) {
    super(`Missing environment variable ${variable}`);
    this.name = 'ConfigError';
  }
}

/** A failure talking to Paddle, OpenRouter or the store. Carries no response body. */
export class UpstreamError extends Error {
  constructor(
    readonly service: 'paddle' | 'openrouter' | 'store',
    readonly status: number,
  ) {
    super(`${service} responded ${status}`);
    this.name = 'UpstreamError';
  }
}

/**
 * The address a request came from, as the host reports it, for limits only.
 * Vercel sets these itself, so a client cannot choose its own.
 */
export function clientAddress(request: Request): string {
  const direct = request.headers.get('x-real-ip');
  if (direct) return direct.trim();
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * An address as an opaque token. Keyed with the store's own secret and the
 * day, so the store never holds an address and two days' records cannot be
 * joined up.
 */
export function blind(value: string, scope: string): string {
  const secret = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return createHmac('sha256', secret).update(`${scope}:${value}`).digest('hex').slice(0, 32);
}
