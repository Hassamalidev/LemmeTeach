/**
 * The two billing functions end to end (§28), against in-memory stand-ins for
 * Lemon Squeezy and OpenRouter. No network.
 *
 * This is where the rules meet the wiring: a purchase, an activation, a second
 * device, a renewal, a retry, and an ending, in the order they really happen.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as activate } from '../activate';
import { POST as webhook } from '../webhook';
import { parseKeyName } from './grants';
import { planById } from '../../shared/plans';

// Read from the pricing table, so a price change does not break these tests.
const credit = (id: string): number => planById(id)?.creditUsd ?? 0;
const REGULAR = credit('regular');

const SECRET = 'whsec-for-tests';
const LICENSE = '38B1460A-5104-4067-A91D-77B872934D51';

interface FakeKey {
  hash: string;
  name: string;
  limit: number | null;
  usage: number;
  disabled: boolean;
  secret: string;
}

let keys: FakeKey[];
let license: { valid: boolean; status: string; store: number; order: number; variant: number };
let created: number;
let openRouterDown: boolean;

const respond = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  keys = [];
  created = 0;
  openRouterDown = false;
  license = { valid: true, status: 'inactive', store: 77, order: 501, variant: 22 };

  vi.stubEnv('OPENROUTER_MANAGEMENT_KEY', 'sk-or-v1-management-key-never-leaves-the-server');
  vi.stubEnv('LEMONSQUEEZY_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('LEMONSQUEEZY_STORE_ID', '77');
  vi.stubEnv('LEMON_VARIANT_STARTER', '11');
  vi.stubEnv('LEMON_VARIANT_REGULAR', '22');
  vi.stubEnv('LEMON_VARIANT_INTENSIVE', '33');
  vi.spyOn(console, 'error').mockImplementation(() => {});

  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';

    if (url.host === 'api.lemonsqueezy.com') {
      const sent = new URLSearchParams(String(init.body)).get('license_key');
      if (sent !== LICENSE) return respond(404, { valid: false, error: 'license_key not found.' });
      return respond(200, {
        valid: license.valid,
        license_key: { status: license.status },
        meta: { store_id: license.store, order_id: license.order, variant_id: license.variant },
      });
    }

    if (url.host === 'openrouter.ai') {
      if (openRouterDown) return respond(503, {});
      const hash = url.pathname.split('/keys/')[1];
      if (method === 'GET') {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return respond(200, { data: keys.slice(offset, offset + 100) });
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string; limit: number };
        created += 1;
        const key: FakeKey = {
          hash: `hash-${created}`,
          name: body.name,
          limit: body.limit,
          usage: 0,
          disabled: false,
          secret: `sk-or-v1-learner-key-${created}`,
        };
        keys.push(key);
        return respond(200, { key: key.secret, data: key });
      }
      const target = keys.find((k) => k.hash === hash);
      if (!target) return respond(404, {});
      if (method === 'PATCH') {
        Object.assign(target, JSON.parse(String(init.body)));
        return respond(200, { data: target });
      }
      if (method === 'DELETE') {
        keys = keys.filter((k) => k !== target);
        return respond(200, { deleted: true });
      }
    }
    throw new Error(`unexpected request to ${url.host}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function callActivate(licenseKey: unknown = LICENSE): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await activate(
    new Request('https://example.test/api/activate', {
      method: 'POST',
      body: JSON.stringify({ licenseKey }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function send(
  event: string,
  attributes: Record<string, unknown>,
  opts: { id?: string; signature?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify({ meta: { event_name: event }, data: { id: opts.id ?? '9', attributes } });
  const signature = opts.signature ?? createHmac('sha256', SECRET).update(raw).digest('hex');
  const res = await webhook(
    new Request('https://example.test/api/webhook', {
      method: 'POST',
      headers: { 'x-signature': signature },
      body: raw,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const MAY = '2026-05-08T10:00:00.000000Z';
const JUNE = '2026-06-08T10:00:00.000000Z';
const subscription = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  order_id: 501,
  variant_id: 22,
  status: 'active',
  renews_at: MAY,
  ...over,
});

describe('activation', () => {
  it('issues a key capped at the plan credit', async () => {
    const { status, body } = await callActivate();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, plan: 'regular', creditUsd: REGULAR });
    expect(body.apiKey).toBe('sk-or-v1-learner-key-1');
    expect(keys).toHaveLength(1);
    expect(keys[0]?.limit).toBe(REGULAR);
  });

  it('never returns the management key or an upstream body', async () => {
    const ok = await callActivate();
    openRouterDown = true;
    const failed = await callActivate();
    for (const { body } of [ok, failed]) {
      expect(JSON.stringify(body)).not.toContain('management');
    }
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ ok: false, code: 'try_again' });
  });

  it('rotates on a second device, carrying over only what was left', async () => {
    await callActivate();
    const first = keys[0];
    if (!first) throw new Error('no key');
    first.usage = 2.5;

    const { body } = await callActivate();
    expect(body.apiKey).toBe('sk-or-v1-learner-key-2');
    expect(body.creditUsd).toBe(REGULAR - 2.5);
    // One live key, one pot of credit.
    expect(keys).toHaveLength(1);
    expect(keys[0]?.limit).toBe(REGULAR - 2.5);
    expect(keys[0]?.name).toBe(first.name);
  });

  it('rejects an unknown license', async () => {
    const { status, body } = await callActivate('00000000-0000-0000-0000-000000000000');
    expect(status).toBe(403);
    expect(body.code).toBe('invalid_license');
    expect(keys).toHaveLength(0);
  });

  it('rejects a valid license from somebody else’s store', async () => {
    license.store = 4242;
    expect((await callActivate()).body.code).toBe('invalid_license');
    expect(keys).toHaveLength(0);
  });

  it('rejects an expired or disabled license', async () => {
    for (const status of ['expired', 'disabled']) {
      license.status = status;
      expect((await callActivate()).body.code).toBe('subscription_ended');
    }
    expect(keys).toHaveLength(0);
  });

  it('rejects a variant that is not one of our plans', async () => {
    license.variant = 999;
    expect((await callActivate()).body.code).toBe('unknown_plan');
    expect(keys).toHaveLength(0);
  });

  it('will not re-issue a key that billing has disabled', async () => {
    await callActivate();
    await send('subscription_expired', subscription({ status: 'expired' }));
    const { body } = await callActivate();
    expect(body.code).toBe('subscription_ended');
    expect(keys[0]?.disabled).toBe(true);
  });

  it('rejects a body that is not a license key', async () => {
    expect((await callActivate(42)).status).toBe(400);
    expect((await callActivate('short')).status).toBe(400);
  });

  it('says so when the server is not configured', async () => {
    vi.stubEnv('LEMONSQUEEZY_STORE_ID', '');
    const { status, body } = await callActivate();
    expect(status).toBe(500);
    expect(body.code).toBe('not_configured');
  });
});

describe('the webhook', () => {
  it('changes nothing when the signature is wrong', async () => {
    const { status } = await send('subscription_created', subscription(), { signature: 'forged' });
    expect(status).toBe(401);
    expect(keys).toHaveLength(0);
  });

  it('creates the key when a subscription starts', async () => {
    const { body } = await send('subscription_created', subscription());
    expect(body.did).toBe('create');
    expect(keys[0]?.limit).toBe(REGULAR);
  });

  it('ignores events it has no rule for', async () => {
    const { status, body } = await send('order_created', {});
    expect(status).toBe(200);
    expect(body.did).toBe('ignored');
  });

  it('asks to be retried when OpenRouter is down', async () => {
    openRouterDown = true;
    expect((await send('subscription_created', subscription())).status).toBe(500);
  });
});

describe('a subscription over time', () => {
  it('grants once per paid period, whatever order things arrive in', async () => {
    // Purchase: the webhook lands, then the learner activates.
    await send('subscription_created', subscription());
    const first = await callActivate();
    expect(first.body.creditUsd).toBe(REGULAR);
    expect(keys).toHaveLength(1);

    // A month of lessons.
    const key = keys[0];
    if (!key) throw new Error('no key');
    key.usage = 5;

    // Renewal, delivered twice.
    await send('subscription_updated', subscription({ renews_at: JUNE }));
    expect(key.limit).toBe(5 + REGULAR); // what was spent plus one period; the rest is dropped
    const retry = await send('subscription_updated', subscription({ renews_at: JUNE }));
    expect(retry.body.did).toBe('none');
    expect(key.limit).toBe(5 + REGULAR);

    // The learner's key kept working throughout: it was never rotated.
    expect(key.secret).toBe(first.body.apiKey);
  });

  it('does not double the first month when activation beats the webhook', async () => {
    await callActivate();
    await send('subscription_created', subscription());
    expect(keys).toHaveLength(1);
    expect(keys[0]?.limit).toBe(REGULAR);
    expect(parseKeyName(keys[0]?.name ?? '')?.marker).not.toBe('init');

    // And the renewal after that still grants.
    await send('subscription_updated', subscription({ renews_at: JUNE }));
    expect(keys[0]?.limit).toBe(REGULAR); // nothing spent, so the cap is one period
  });

  it('ends with a disabled key on expiry and on refund', async () => {
    await send('subscription_created', subscription());
    await send('subscription_expired', subscription({ status: 'expired' }));
    expect(keys[0]?.disabled).toBe(true);

    keys = [];
    await send('subscription_created', subscription());
    await send('order_refunded', {}, { id: '501' });
    expect(keys[0]?.disabled).toBe(true);
  });

  it('keeps a cancelled subscription working until it expires', async () => {
    await send('subscription_created', subscription());
    await send('subscription_updated', subscription({ status: 'cancelled' }));
    expect(keys[0]?.disabled).toBe(false);
  });
});
