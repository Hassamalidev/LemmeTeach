/**
 * POST /api/webhook — Paddle payment events (§28.3).
 *
 * Verifies the signature over the raw body before parsing anything, turns the
 * event into a subscription state, asks the grant rules what to do, and does
 * exactly that one thing. A failure talking to OpenRouter or Paddle returns
 * 500 so Paddle retries; the rules are idempotent, so a retry is safe.
 */
import { ConfigError, env, json, UpstreamError } from './_lib/http.js';
import { verifySignature } from './_lib/paddle.js';
import { readEvent, type Payload } from './_lib/events.js';
import { createKey, findKeyBySubscription, updateKey } from './_lib/openrouter.js';
import { decide, type Action } from './_lib/grants.js';

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (!verifySignature(raw, request.headers.get('paddle-signature'), env('PADDLE_WEBHOOK_SECRET'))) {
      return json(401, { ok: false });
    }

    let payload: Payload;
    try {
      payload = JSON.parse(raw) as Payload;
    } catch {
      return json(400, { ok: false });
    }

    const read = readEvent(payload);
    if (!read) return json(200, { ok: true, did: 'ignored' });

    let action: Action;
    if (read.event === 'refund') {
      // A refund disables whatever key the subscription has; nothing about
      // the subscription itself is needed to decide that.
      const key = await findKeyBySubscription(read.subscriptionId);
      const sub = { subscriptionId: read.subscriptionId, planId: null, status: 'refunded', periodStart: null };
      action = decide('refund', sub, key);
    } else {
      const key = await findKeyBySubscription(read.sub.subscriptionId);
      action = decide('subscription', read.sub, key);
    }

    if (action.do === 'create') await createKey(action.name, action.limit);
    if (action.do === 'update') await updateKey(action.hash, action.patch);

    return json(200, { ok: true, did: action.do });
  } catch (err) {
    if (err instanceof ConfigError || err instanceof UpstreamError) {
      console.error(`webhook: ${err.message}`);
    } else {
      console.error('webhook: unexpected failure');
    }
    // Anything that stopped us acting is worth a retry.
    return json(500, { ok: false });
  }
}
