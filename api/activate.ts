/**
 * POST /api/activate — an access code in, a spend-capped model key out (§28.2).
 *
 * The access code is the id of a Paddle transaction on the subscription
 * (`txn_…`). The browser gets it straight from Paddle when checkout finishes,
 * and the learner keeps it to use their plan on another device.
 *
 * This is the only moment a learner's browser talks to our backend. Nothing
 * about a question ever comes through here.
 */
import { planById } from '../shared/plans.js';
import { ConfigError, json, UpstreamError } from './_lib/http.js';
import { getSubscription, getTransaction } from './_lib/paddle.js';
import { createKey, deleteKey, findKeyBySubscription, updateKey } from './_lib/openrouter.js';
import { decide, remainingOn, type KeyRecord } from './_lib/grants.js';

/** Codes the app turns into sentences. Never a raw upstream message. */
type Refusal =
  | 'bad_request'
  | 'invalid_code'
  | 'not_paid'
  | 'pending'
  | 'subscription_ended'
  | 'unknown_plan'
  | 'try_again'
  | 'not_configured';

const refuse = (status: number, code: Refusal): Response => json(status, { ok: false, code });

/** What a Paddle transaction id looks like. Anything else is not sent upstream. */
const CODE = /^txn_[a-z0-9]{20,40}$/;

/** A transaction that has been paid for. */
const PAID = new Set(['paid', 'completed']);

export async function POST(request: Request): Promise<Response> {
  let code = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === 'string') code = body.code.trim().toLowerCase();
  } catch {
    return refuse(400, 'bad_request');
  }
  if (!CODE.test(code)) return refuse(400, 'bad_request');

  try {
    const transaction = await getTransaction(code);
    if (!transaction) return refuse(403, 'invalid_code');
    if (!PAID.has(transaction.status)) return refuse(402, 'not_paid');
    // Paid, but Paddle has not attached the subscription yet. It does within
    // seconds of checkout; the browser asks again.
    if (!transaction.subscriptionId) return refuse(409, 'pending');

    const sub = await getSubscription(transaction.subscriptionId);
    if (!sub) return refuse(409, 'pending');
    const plan = planById(sub.planId);
    if (!plan) return refuse(403, 'unknown_plan');

    // Run the same rules the webhook does, against what Paddle says right
    // now. A missed or delayed webhook is caught up here, and because the
    // rules are idempotent, nothing is ever granted twice.
    let key: KeyRecord | null = await findKeyBySubscription(sub.subscriptionId);
    const action = decide('subscription', sub, key);

    if (action.do === 'create') {
      const { apiKey } = await createKey(action.name, action.limit);
      return json(200, { ok: true, apiKey, plan: plan.id, creditUsd: action.limit });
    }
    if (action.do === 'update' && key) {
      await updateKey(action.hash, action.patch);
      key = { ...key, ...action.patch };
    }
    if (!key || key.disabled) return refuse(403, 'subscription_ended');

    // The raw key cannot be read back, so rotate: the new key inherits
    // exactly what was left on the old one, and its record.
    const limit = remainingOn(key);
    await deleteKey(key.hash);
    const { apiKey } = await createKey(key.name, limit);
    return json(200, { ok: true, apiKey, plan: plan.id, creditUsd: limit });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`activate: ${err.message}`);
      return refuse(500, 'not_configured');
    }
    if (err instanceof UpstreamError) {
      console.error(`activate: ${err.message}`);
      return refuse(502, 'try_again');
    }
    console.error('activate: unexpected failure');
    return refuse(500, 'try_again');
  }
}
