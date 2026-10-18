/**
 * POST /api/activate — a license key in, a spend-capped model key out (§28.2).
 *
 * This is the only moment a learner's browser talks to our backend. Nothing
 * about a lesson ever comes through here.
 */
import { planById } from '../shared/plans.js';
import { ConfigError, env, json, UpstreamError } from './_lib/http.js';
import { planForVariant, validateLicense } from './_lib/lemon.js';
import { createKey, deleteKey, findKeyByOrder } from './_lib/openrouter.js';
import { formatKeyName, INIT_MARKER, remainingOn } from './_lib/grants.js';

/** Codes the app turns into sentences. Never a raw upstream message. */
type Refusal =
  | 'bad_request'
  | 'invalid_license'
  | 'subscription_ended'
  | 'unknown_plan'
  | 'try_again'
  | 'not_configured';

const refuse = (status: number, code: Refusal): Response => json(status, { ok: false, code });

export async function POST(request: Request): Promise<Response> {
  let licenseKey = '';
  try {
    const body = (await request.json()) as { licenseKey?: unknown };
    if (typeof body.licenseKey === 'string') licenseKey = body.licenseKey.trim();
  } catch {
    return refuse(400, 'bad_request');
  }
  if (licenseKey.length < 8 || licenseKey.length > 200) return refuse(400, 'bad_request');

  try {
    const license = await validateLicense(licenseKey);

    // A valid license from somebody else's store is not a license for this.
    if (!license.valid || !license.orderId || license.storeId !== env('LEMONSQUEEZY_STORE_ID')) {
      return refuse(403, 'invalid_license');
    }
    if (license.status === 'expired' || license.status === 'disabled') {
      return refuse(403, 'subscription_ended');
    }

    const plan = planById(planForVariant(license.variantId));
    if (!plan) return refuse(403, 'unknown_plan');

    const existing = await findKeyByOrder(license.orderId);
    if (existing?.disabled) return refuse(403, 'subscription_ended');

    let name = formatKeyName({ orderId: license.orderId, planId: plan.id, marker: INIT_MARKER });
    let limit = plan.creditUsd;

    if (existing) {
      // The raw key cannot be read back, so rotate: the new key inherits
      // exactly what was left on the old one, and its record.
      name = existing.name;
      limit = remainingOn(existing);
      await deleteKey(existing.hash);
    }

    const { apiKey } = await createKey(name, limit);
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
