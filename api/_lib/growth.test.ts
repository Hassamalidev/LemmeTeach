/**
 * Usage counts and shared solutions (§30), against an in-memory store. These
 * are the endpoints a stranger on the internet can call with no account, so
 * the failures that matter are the ones that fill the store or leak something.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as event } from '../event';
import { GET as stats } from '../stats';
import { DELETE as unshare, GET as readShare, MAX_SHARE_BYTES, POST as share } from '../share';
import { fakes, STORE_URL, type Fakes } from './fakes';
import { dayOf, weekOf } from '../../shared/dates';

let f: Fakes;

beforeEach(() => {
  f = fakes();
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => f.fetch(input, init));
  vi.stubEnv('KV_REST_API_URL', STORE_URL);
  vi.stubEnv('KV_REST_API_TOKEN', 'store-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body: unknown, ip = '203.0.113.7'): Request =>
  new Request('https://example.test/api/x', {
    method: 'POST',
    headers: { 'x-real-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('counting', () => {
  const send = (body: unknown): Promise<Response> => event(post(body));
  const visitor = 'a1b2c3d4e5f60718';
  const week = weekOf(Date.now());
  const today = dayOf(Date.now());

  it('counts a known event, and the visitor only as a distinct number', async () => {
    const res = await send({ event: 'question_solved', visitor, firstWeek: week });
    expect(res.status).toBe(204);
    expect(f.data.get(`count:${today}:question_solved`)).toBe(1);
    expect((f.data.get(`active:${today}`) as Set<string>).size).toBe(1);
    expect((f.data.get(`cohort:${week}:${week}`) as Set<string>).size).toBe(1);
  });

  it('ignores anything else, and never shows an error', async () => {
    const before = f.data.size;
    for (const body of ['not json', {}, { event: 'made_up' }, { event: 'x'.repeat(1000) }]) {
      expect((await send(body)).status).toBe(204);
    }
    expect(f.data.size).toBeLessThanOrEqual(before + 1);
    expect([...f.data.keys()].some((k) => k.startsWith('count:'))).toBe(false);
  });

  it('will not store text smuggled in as an id or a week', async () => {
    await send({ event: 'landing_view', visitor: 'my-name-is-someone', firstWeek: 'hello' });
    expect([...f.data.keys()].join()).not.toContain('hello');
    expect(f.data.has(`active:${today}`)).toBe(false);
  });

  it('stops counting a network that sends too much', async () => {
    for (let i = 0; i < 520; i++) await send({ event: 'landing_view' });
    expect(f.data.get(`count:${today}:landing_view`)).toBe(500);
  });

  it('answers the same when the store is down', async () => {
    f.storeDown = true;
    expect((await send({ event: 'landing_view' })).status).toBe(204);
  });
});

describe('the numbers', () => {
  const read = (auth?: string): Promise<Response> =>
    stats(new Request('https://example.test/api/stats', { headers: auth ? { authorization: auth } : {} }));

  it('answers nobody when no token is set', async () => {
    vi.stubEnv('STATS_TOKEN', '');
    expect((await read('Bearer ')).status).toBe(401);
  });

  it('refuses a wrong token and gives the right one the counts', async () => {
    vi.stubEnv('STATS_TOKEN', 'the-right-token');
    expect((await read()).status).toBe(401);
    expect((await read('Bearer wrong')).status).toBe(401);

    const week = weekOf(Date.now());
    await event(post({ event: 'question_solved', visitor: 'a1b2c3d4e5f60718', firstWeek: week }));
    await event(post({ event: 'question_solved', visitor: 'ffeeddccbbaa9988', firstWeek: week }));

    const res = await read('Bearer the-right-token');
    const body = (await res.json()) as {
      daily: { day: string; active: number; counts: Record<string, number> }[];
      retention: { firstWeek: string; returned: number[] }[];
    };
    expect(body.daily[0]).toMatchObject({ day: dayOf(Date.now()), active: 2, counts: { question_solved: 2 } });
    expect(body.retention.at(-1)).toEqual({ firstWeek: week, returned: [2] });
  });
});

describe('shared solutions', () => {
  const solution = { title: 'Range of a ball', topic: 'How far?', pages: [{ steps: [] }] };

  const create = async (body: unknown = solution): Promise<{ status: number; body: Record<string, string> }> => {
    const res = await share(post(body));
    return { status: res.status, body: (await res.json()) as Record<string, string> };
  };
  const open = (id: string): Promise<Response> =>
    readShare(new Request(`https://example.test/api/share?id=${encodeURIComponent(id)}`));
  const remove = (body: unknown): Promise<Response> =>
    unshare(new Request('https://example.test/api/share', { method: 'DELETE', body: JSON.stringify(body) }));

  it('stores a solution and reads it back, without the removal token', async () => {
    const made = await create();
    expect(made.status).toBe(200);
    const res = await open(made.body.id ?? '');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.solution).toEqual(solution);
    expect(JSON.stringify(body)).not.toContain(made.body.token);
  });

  it('refuses what is not a solution, and what is too big', async () => {
    expect((await create('not json')).status).toBe(400);
    expect((await create({ title: 'x' })).status).toBe(400);
    expect((await create({ ...solution, pages: [] })).status).toBe(400);
    expect((await create({ ...solution, topic: 'x'.repeat(MAX_SHARE_BYTES) })).status).toBe(413);
    expect(f.data.size).toBe(0);
  });

  it('works with only the store configured, for a site with no plans set up', async () => {
    vi.stubEnv('OPENROUTER_MANAGEMENT_KEY', '');
    expect((await create()).status).toBe(200);
  });

  it('keeps no address in the store', async () => {
    await create();
    expect(JSON.stringify([...f.data.keys()])).not.toContain('203.0.113.7');
  });

  it('stops one network filling the store', async () => {
    let last = await create();
    for (let i = 0; i < 31; i++) last = await create();
    expect(last.status).toBe(429);
  });

  it('answers gone for an unknown or malformed id, and never looks up a bad one', async () => {
    expect((await open('aaaaaaaaaaaa')).status).toBe(404);
    for (const bad of ['', '../../etc', 'x', 'share:abc:def']) expect((await open(bad)).status).toBe(404);
  });

  it('can be removed with its token, and only with its token', async () => {
    const { body } = await create();
    expect((await remove({ id: body.id, token: 'wrong' })).status).toBe(403);
    expect((await open(body.id ?? '')).status).toBe(200);
    expect((await remove({ id: body.id, token: body.token })).status).toBe(200);
    expect((await open(body.id ?? '')).status).toBe(404);
    // Removing it twice is not an error.
    expect((await remove({ id: body.id, token: body.token })).status).toBe(200);
  });

  it('tells the browser plainly when the store is down', async () => {
    f.storeDown = true;
    expect((await create()).status).toBe(502);
    expect((await open('aaaaaaaaaaaa')).status).toBe(502);
  });
});

describe('the week stamp', () => {
  it('follows ISO weeks across the new year', () => {
    expect(weekOf(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(weekOf(Date.UTC(2024, 11, 30))).toBe('2025-W01');
    expect(weekOf(Date.UTC(2021, 0, 3))).toBe('2020-W53');
  });
});
