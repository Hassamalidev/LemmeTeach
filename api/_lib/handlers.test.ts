/**
 * The two billing functions end to end (§28), against in-memory stand-ins for
 * Paddle and OpenRouter. No network.
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

const SECRET = 'pdl_ntfset_for_tests';
const TXN = 'txn_01hv8x2v3k4m5n6p7q8r9s0t1u';
const SUB = 'sub_01hv8x2v3k4m5n6p7q8r9s0t1u';
const MAY = '2026-05-08T10:00:00.000000Z';
const JUNE = '2026-06-08T10:00:00.000000Z';

interface FakeKey {
  hash: string;
  name: string;
  limit: number | null;
  usage: number;
  disabled: boolean;
  secret: string;
}

let keys: FakeKey[];
let created: number;
let openRouterDown: boolean;
let transaction: { status: string; subscription_id: string | null };
let subscription: Record<string, unknown>;

const respond = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const subscriptionWith = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SUB,
  status: 'active',
  items: [{ price: { id: 'pri_regular' }, quantity: 1 }],
  current_billing_period: { starts_at: MAY, ends_at: JUNE },
  ...over,
});

beforeEach(() => {
  keys = [];
  created = 0;
  openRouterDown = false;
  transaction = { status: 'completed', subscription_id: SUB };
  subscription = subscriptionWith();

  vi.stubEnv('OPENROUTER_MANAGEMENT_KEY', 'sk-or-v1-management-key-never-leaves-the-server');
  vi.stubEnv('PADDLE_API_KEY', 'pdl_sdbx_apikey_for_tests');
  vi.stubEnv('PADDLE_ENV', 'sandbox');
  vi.stubEnv('PADDLE_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('PADDLE_PRICE_STARTER', 'pri_starter');
  vi.stubEnv('PADDLE_PRICE_REGULAR', 'pri_regular');
  vi.stubEnv('PADDLE_PRICE_INTENSIVE', 'pri_intensive');
  vi.spyOn(console, 'error').mockImplementation(() => {});

  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';

    if (url.host === 'sandbox-api.paddle.com') {
      const auth = new Headers(init.headers).get('authorization');
      if (auth !== 'Bearer pdl_sdbx_apikey_for_tests') return respond(403, {});
      if (url.pathname === `/transactions/${TXN}`) return respond(200, { data: { id: TXN, ...transaction } });
      if (url.pathname === `/subscriptions/${SUB}`) return respond(200, { data: subscription });
      return respond(404, { error: { code: 'not_found' } });
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

async function callActivate(code: unknown = TXN): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await activate(
    new Request('https://example.test/api/activate', { method: 'POST', body: JSON.stringify({ code }) }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function send(
  eventType: string,
  data: Record<string, unknown>,
  opts: { signature?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify({ event_id: 'evt_1', event_type: eventType, data });
  const ts = Math.floor(Date.now() / 1000);
  const signature = opts.signature ?? `ts=${ts};h1=${createHmac('sha256', SECRET).update(`${ts}:${raw}`).digest('hex')}`;
  const res = await webhook(
    new Request('https://example.test/api/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': signature },
      body: raw,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('activation', () => {
  it('issues a key capped at the plan credit', async () => {
    const { status, body } = await callActivate();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, plan: 'regular', creditUsd: REGULAR });
    expect(body.apiKey).toBe('sk-or-v1-learner-key-1');
    expect(keys).toHaveLength(1);
    expect(keys[0]?.limit).toBe(REGULAR);
  });

  it('accepts the code however it was pasted', async () => {
    expect((await callActivate(`  ${TXN.toUpperCase()} `)).status).toBe(200);
  });

  it('never returns the management key or an upstream body', async () => {
    const ok = await callActivate();
    openRouterDown = true;
    const failed = await callActivate();
    for (const { body } of [ok, failed]) {
      expect(JSON.stringify(body)).not.toContain('management');
      expect(JSON.stringify(body)).not.toContain('pdl_');
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

  it('rejects an unknown code', async () => {
    const { status, body } = await callActivate('txn_00000000000000000000000000');
    expect(status).toBe(403);
    expect(body.code).toBe('invalid_code');
    expect(keys).toHaveLength(0);
  });

  it('rejects a transaction that has not been paid', async () => {
    transaction.status = 'ready';
    expect((await callActivate()).body.code).toBe('not_paid');
    expect(keys).toHaveLength(0);
  });

  it('asks to be tried again while Paddle is still attaching the subscription', async () => {
    transaction.subscription_id = null;
    const { status, body } = await callActivate();
    expect(status).toBe(409);
    expect(body.code).toBe('pending');
  });

  it('rejects a subscription that has ended', async () => {
    subscription = subscriptionWith({ status: 'canceled' });
    expect((await callActivate()).body.code).toBe('subscription_ended');
    expect(keys).toHaveLength(0);
  });

  it('rejects a price that is not one of our plans', async () => {
    subscription = subscriptionWith({ items: [{ price: { id: 'pri_somebody_else' } }] });
    expect((await callActivate()).body.code).toBe('unknown_plan');
    expect(keys).toHaveLength(0);
  });

  it('will not re-issue a key that billing has disabled', async () => {
    await callActivate();
    subscription = subscriptionWith({ status: 'canceled' });
    await send('subscription.canceled', subscription);
    const { body } = await callActivate();
    expect(body.code).toBe('subscription_ended');
    expect(keys[0]?.disabled).toBe(true);
  });

  it('rejects anything that is not an access code, without asking Paddle', async () => {
    expect((await callActivate(42)).status).toBe(400);
    expect((await callActivate('short')).status).toBe(400);
    expect((await callActivate('txn_../../subscriptions')).status).toBe(400);
  });

  it('says so when the server is not configured', async () => {
    vi.stubEnv('PADDLE_API_KEY', '');
    const { status, body } = await callActivate();
    expect(status).toBe(500);
    expect(body.code).toBe('not_configured');
  });
});

describe('the webhook', () => {
  it('changes nothing when the signature is wrong', async () => {
    const { status } = await send('subscription.created', subscription, { signature: 'ts=1;h1=forged' });
    expect(status).toBe(401);
    expect(keys).toHaveLength(0);
  });

  it('creates the key when a subscription starts', async () => {
    const { body } = await send('subscription.created', subscription);
    expect(body.did).toBe('create');
    expect(keys[0]?.limit).toBe(REGULAR);
  });

  it('ignores events it has no rule for', async () => {
    const { status, body } = await send('transaction.completed', { id: TXN });
    expect(status).toBe(200);
    expect(body.did).toBe('ignored');
  });

  it('asks to be retried when OpenRouter is down', async () => {
    openRouterDown = true;
    expect((await send('subscription.created', subscription)).status).toBe(500);
  });
});

describe('a subscription over time', () => {
  it('grants once per paid period, whatever order things arrive in', async () => {
    // Purchase: the webhook lands, then the learner activates.
    await send('subscription.created', subscription);
    const first = await callActivate();
    expect(first.body.creditUsd).toBe(REGULAR);
    expect(keys).toHaveLength(1);

    // A month of questions.
    const key = keys[0];
    if (!key) throw new Error('no key');
    key.usage = 5;

    // Renewal, delivered twice.
    const renewed = subscriptionWith({ current_billing_period: { starts_at: JUNE, ends_at: null } });
    await send('subscription.updated', renewed);
    expect(key.limit).toBe(5 + REGULAR); // what was spent plus one period; the rest is dropped
    const retry = await send('subscription.updated', renewed);
    expect(retry.body.did).toBe('none');
    expect(key.limit).toBe(5 + REGULAR);

    // The learner's key kept working throughout: it was never rotated.
    expect(key.secret).toBe(first.body.apiKey);
  });

  it('does not double the first month when activation beats the webhook', async () => {
    await callActivate();
    await send('subscription.created', subscription);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.limit).toBe(REGULAR);
  });

  it('catches up a missed renewal at activation', async () => {
    await callActivate();
    const key = keys[0];
    if (!key) throw new Error('no key');
    key.usage = 3;
    // The renewal webhook never arrived; Paddle says it is a new period.
    subscription = subscriptionWith({ current_billing_period: { starts_at: JUNE, ends_at: null } });
    const { body } = await callActivate();
    expect(body.creditUsd).toBe(REGULAR);
    expect(parseKeyName(keys[0]?.name ?? '')?.marker).toBe(String(Math.floor(Date.parse(JUNE) / 1000)));
  });

  it('ends with a disabled key on cancellation and on refund, and a refund stays', async () => {
    await send('subscription.created', subscription);
    await send('subscription.canceled', subscriptionWith({ status: 'canceled' }));
    expect(keys[0]?.disabled).toBe(true);

    keys = [];
    await send('subscription.created', subscription);
    await send('adjustment.updated', { action: 'refund', status: 'approved', type: 'full', subscription_id: SUB });
    expect(keys[0]?.disabled).toBe(true);
    // The subscription is still marked active in Paddle, but the period was refunded.
    expect((await callActivate()).body.code).toBe('subscription_ended');
    expect(keys[0]?.disabled).toBe(true);
  });

  it('keeps a subscription working while a renewal payment is retried', async () => {
    await send('subscription.created', subscription);
    await send('subscription.past_due', subscriptionWith({ status: 'past_due' }));
    expect(keys[0]?.disabled).toBe(false);
  });
});
