/**
 * POST /api/event — counts what people do, and nothing about who they are (§30).
 *
 * The event is a word from a fixed list. The visitor id is a random token made
 * in their browser; it goes only into HyperLogLog counters, which can say how
 * many distinct ids they have seen but cannot give any of them back. No
 * address, no question, no text is stored.
 *
 * Always answers 204. A count is never worth an error in someone's console,
 * and nothing depends on it.
 */
import { dayOf, weekOf } from '../shared/dates.js';
import { isUsageEvent } from '../shared/events.js';
import { blind, clientAddress } from './_lib/http.js';
import { bump, pipeline, storeConfigured } from './_lib/store.js';

const YEAR = 400 * 86_400;
const VISITOR = /^[a-f0-9]{16,40}$/;
const WEEK = /^\d{4}-W\d{2}$/;
/** Counted per network per day, so a script cannot write the numbers. */
const PER_NETWORK = 500;

const done = (): Response => new Response(null, { status: 204 });

export async function POST(request: Request): Promise<Response> {
  try {
    if (!storeConfigured()) return done();

    // Sent with sendBeacon, which posts text.
    const text = await request.text();
    if (text.length > 300) return done();
    const body = JSON.parse(text) as { event?: unknown; visitor?: unknown; firstWeek?: unknown };
    if (!isUsageEvent(body.event)) return done();

    const now = Date.now();
    const today = dayOf(now);
    if ((await bump(`event:net:${blind(clientAddress(request), today)}`, 86_400)) > PER_NETWORK) return done();

    const commands: (string | number)[][] = [
      ['INCR', `count:${today}:${body.event}`],
      ['EXPIRE', `count:${today}:${body.event}`, YEAR],
    ];
    if (typeof body.visitor === 'string' && VISITOR.test(body.visitor)) {
      commands.push(['PFADD', `active:${today}`, body.visitor], ['EXPIRE', `active:${today}`, YEAR]);
      if (typeof body.firstWeek === 'string' && WEEK.test(body.firstWeek)) {
        const cohort = `cohort:${body.firstWeek}:${weekOf(now)}`;
        commands.push(['PFADD', cohort, body.visitor], ['EXPIRE', cohort, YEAR]);
      }
    }
    await pipeline(commands);
  } catch {
    /* Counting is best effort. */
  }
  return done();
}
