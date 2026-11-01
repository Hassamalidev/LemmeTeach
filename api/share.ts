/**
 * /api/share — solutions a learner chose to share (§30).
 *
 *   POST    stores one, and returns its id and a token that can remove it
 *   GET     ?id=… reads one back
 *   DELETE  { id, token } removes one
 *
 * This is the only place anything a learner wrote reaches our side, and only
 * because they pressed Share. Stored text is never rendered here: the browser
 * opens it through the same tool bus that checks a model's output, so a
 * tampered record is refused the way a malformed call is.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dayOf } from '../shared/dates.js';
import { blind, clientAddress, json } from './_lib/http.js';
import { bump, command, storeConfigured } from './_lib/store.js';

/** Bigger than any real solution, small enough that the store cannot be used as a disk. */
export const MAX_SHARE_BYTES = 200_000;
const KEEP_SECONDS = 180 * 86_400;
const PER_NETWORK = 30;
const ID = /^[A-Za-z0-9_-]{12}$/;

const refuse = (status: number, code: string): Response => json(status, { ok: false, code });
const hash = (token: string): Buffer => createHash('sha256').update(token).digest();

/** Enough of a shape to be worth keeping. The browser checks the rest. */
function looksLikeASolution(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { title?: unknown; topic?: unknown; pages?: unknown };
  return (
    typeof v.title === 'string' &&
    v.title.length <= 300 &&
    typeof v.topic === 'string' &&
    Array.isArray(v.pages) &&
    v.pages.length > 0 &&
    v.pages.length <= 40
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!storeConfigured()) return refuse(503, 'unavailable');
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_SHARE_BYTES) return refuse(413, 'too_big');

    let solution: unknown;
    try {
      solution = JSON.parse(text);
    } catch {
      return refuse(400, 'bad_request');
    }
    if (!looksLikeASolution(solution)) return refuse(400, 'bad_request');

    const network = blind(clientAddress(request), dayOf(Date.now()));
    if ((await bump(`share:net:${network}`, 86_400)) > PER_NETWORK) return refuse(429, 'limit_reached');

    const id = randomBytes(9).toString('base64url');
    const token = randomBytes(18).toString('base64url');
    await command(
      'SET',
      `share:${id}`,
      JSON.stringify({ solution, token: hash(token).toString('hex') }),
      'EX',
      KEEP_SECONDS,
    );
    return json(200, { ok: true, id, token });
  } catch {
    console.error('share: could not store a solution');
    return refuse(502, 'try_again');
  }
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) return refuse(404, 'gone');
  if (!storeConfigured()) return refuse(503, 'unavailable');
  try {
    const raw = await command('GET', `share:${id}`);
    if (typeof raw !== 'string') return refuse(404, 'gone');
    const { solution } = JSON.parse(raw) as { solution: unknown };
    // The removal token stays here.
    return json(200, { ok: true, solution });
  } catch {
    console.error('share: could not read a solution');
    return refuse(502, 'try_again');
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!storeConfigured()) return refuse(503, 'unavailable');
  try {
    const body = (await request.json().catch(() => null)) as { id?: unknown; token?: unknown } | null;
    if (!body || typeof body.id !== 'string' || !ID.test(body.id) || typeof body.token !== 'string') {
      return refuse(400, 'bad_request');
    }
    const raw = await command('GET', `share:${body.id}`);
    if (typeof raw !== 'string') return json(200, { ok: true }); // Already gone.

    const stored = Buffer.from((JSON.parse(raw) as { token: string }).token, 'hex');
    const given = hash(body.token);
    if (stored.length !== given.length || !timingSafeEqual(stored, given)) return refuse(403, 'forbidden');

    await command('DEL', `share:${body.id}`);
    return json(200, { ok: true });
  } catch {
    console.error('share: could not remove a solution');
    return refuse(502, 'try_again');
  }
}
