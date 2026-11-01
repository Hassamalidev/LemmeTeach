/**
 * The one small store the backend has (§30): Upstash Redis over its REST API.
 *
 * It holds things that must be counted atomically or that exist for someone
 * who is not on this device: usage counts, rate limits and shared solutions.
 * It holds no question that was not deliberately shared. Vercel's marketplace integration sets the
 * `KV_REST_API_*` variables; a direct Upstash database sets `UPSTASH_REDIS_*`.
 */
import { UpstreamError } from './http.js';

function config(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export function storeConfigured(): boolean {
  return config() !== null;
}

type Command = (string | number)[];

/** Several commands in one request, answered in order. */
export async function pipeline(commands: Command[]): Promise<unknown[]> {
  const c = config();
  if (!c) throw new UpstreamError('store', 503);
  const res = await fetch(`${c.url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new UpstreamError('store', res.status);
  const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
  if (!Array.isArray(body) || body.some((r) => r.error)) throw new UpstreamError('store', 502);
  return body.map((r) => r.result);
}

export async function command(...args: Command): Promise<unknown> {
  return (await pipeline([args]))[0];
}

/** Add one to a counter that clears itself. Returns the new count. */
export async function bump(key: string, ttlSeconds: number): Promise<number> {
  const [count] = await pipeline([
    ['INCR', key],
    ['EXPIRE', key, ttlSeconds],
  ]);
  return typeof count === 'number' ? count : Number(count);
}
