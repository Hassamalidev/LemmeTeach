/**
 * OpenRouter's key management API (§28).
 *
 * The management key used here can create and cap keys but is never sent to a
 * browser. Every key this module creates carries a limit — there is no code
 * path that issues an uncapped one.
 */
import { env, UpstreamError } from './http.js';
import { keyBelongsTo, type KeyRecord } from './grants.js';

const BASE = 'https://openrouter.ai/api/v1';

interface RawKey {
  hash: string;
  name: string;
  limit: number | null;
  usage: number;
  disabled: boolean;
}

function toRecord(raw: RawKey): KeyRecord {
  return {
    hash: raw.hash,
    name: raw.name ?? '',
    limit: typeof raw.limit === 'number' ? raw.limit : null,
    usage: typeof raw.usage === 'number' ? raw.usage : 0,
    disabled: raw.disabled === true,
  };
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env('OPENROUTER_MANAGEMENT_KEY')}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new UpstreamError('openrouter', res.status);
  return res.status === 204 ? null : res.json();
}

/**
 * Find the key belonging to a Paddle subscription.
 *
 * There is no database (§26.10): the key's name is the record, so this walks
 * the key list. Fine for hundreds of subscribers; move to a key-value store
 * before thousands.
 */
export async function findKeyBySubscription(subscriptionId: string): Promise<KeyRecord | null> {
  const MAX_PAGES = 100;
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = (await call(`/keys?include_disabled=true&offset=${offset}`)) as {
      data?: RawKey[];
    };
    const keys = body.data ?? [];
    if (keys.length === 0) return null;
    const match = keys.find((k) => keyBelongsTo(k.name ?? '', subscriptionId));
    if (match) return toRecord(match);
    offset += keys.length;
  }
  return null;
}

export async function createKey(
  name: string,
  limit: number,
): Promise<{ apiKey: string; record: KeyRecord }> {
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error('Refusing to create a key without a spending cap.');
  }
  const body = (await call('/keys', {
    method: 'POST',
    body: JSON.stringify({ name, limit }),
  })) as { key?: string; data?: RawKey };
  if (!body.key || !body.data) throw new UpstreamError('openrouter', 502);
  return { apiKey: body.key, record: toRecord(body.data) };
}

export async function updateKey(
  hash: string,
  patch: { name?: string; limit?: number; disabled?: boolean },
): Promise<void> {
  await call(`/keys/${encodeURIComponent(hash)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteKey(hash: string): Promise<void> {
  await call(`/keys/${encodeURIComponent(hash)}`, { method: 'DELETE' });
}
