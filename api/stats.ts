/**
 * GET /api/stats — the numbers, for whoever runs the product (§30).
 *
 *   curl -H "Authorization: Bearer $STATS_TOKEN" https://<site>/api/stats
 *
 * Daily counts and active visitors for the last thirty days, and weekly
 * retention by the week people first came. Without STATS_TOKEN set, it
 * answers nothing to anyone.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { dayOf, weekOf } from '../shared/dates.js';
import { USAGE_EVENTS } from '../shared/events.js';
import { json } from './_lib/http.js';
import { pipeline, storeConfigured } from './_lib/store.js';

const DAY_MS = 86_400_000;

function authorized(request: Request): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  // Hashed first, so the comparison does not reveal the token's length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return json(401, { ok: false });
  if (!storeConfigured()) return json(503, { ok: false, code: 'unavailable' });

  try {
    const now = Date.now();
    const days = Array.from({ length: 30 }, (_, i) => dayOf(now - i * DAY_MS));
    const weeks = Array.from({ length: 8 }, (_, i) => weekOf(now - i * 7 * DAY_MS)).reverse();

    const dayRows = await pipeline(
      days.flatMap((d) => [
        ['PFCOUNT', `active:${d}`],
        ...USAGE_EVENTS.map((e) => ['GET', `count:${d}:${e}`]),
      ]),
    );
    const width = USAGE_EVENTS.length + 1;
    const daily = days.map((day, i) => {
      const row = dayRows.slice(i * width, (i + 1) * width);
      const counts: Record<string, number> = {};
      USAGE_EVENTS.forEach((e, j) => {
        const value = Number(row[j + 1] ?? 0);
        if (value) counts[e] = value;
      });
      return { day, active: Number(row[0] ?? 0), counts };
    });

    // Each row: people who first came that week, and how many returned in each
    // week since. The first number in a row is the size of that cohort.
    const cohortRows = await pipeline(
      weeks.flatMap((first) => weeks.map((week) => ['PFCOUNT', `cohort:${first}:${week}`])),
    );
    const retention = weeks.map((first, i) => ({
      firstWeek: first,
      returned: cohortRows
        .slice(i * weeks.length, (i + 1) * weeks.length)
        .map(Number)
        .slice(i),
    }));

    return json(200, { ok: true, daily, retention });
  } catch {
    console.error('stats: could not read the store');
    return json(502, { ok: false, code: 'try_again' });
  }
}
