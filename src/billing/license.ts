/**
 * Activation (§15.2, §28.2).
 *
 * The one place the app talks to our own backend: a license key goes to
 * /api/activate and a spend-capped model key comes back. After that, lessons
 * go straight from this browser to the model gateway.
 */
import { planById, type Plan } from '../../shared/plans';
import { MANAGED_PROVIDER_ID } from '../providers/managed';
import {
  forgetAllKeys,
  forgetLicense,
  getKey,
  getLicense,
  setKey,
  setLicense,
} from '../storage/settings';

export type ActivationResult = { ok: true; plan: Plan } | { ok: false; message: string };

/** What each refusal from the server means, written for the learner. */
const MESSAGES: Record<string, string> = {
  bad_request: 'That does not look like a license key. Copy it from your receipt email and try again.',
  invalid_license:
    'We could not find that license key. Copy it from your receipt email, including the dashes.',
  subscription_ended:
    'That subscription has ended, so there is no credit on it. Pick a plan to start again.',
  unknown_plan:
    'That license is for a plan this site does not recognise, so it cannot be activated here.',
  try_again:
    'Your payment is fine, but we could not set up your lessons just now. Try again in a minute.',
  not_configured: 'Activation is not set up on this site yet.',
};

const UNREACHABLE =
  'Could not reach LemmeTeach to activate. Check your connection and try again.';
const NO_BACKEND =
  'This copy of LemmeTeach is demo-only, so it cannot activate a license. Open the main site instead.';

export async function activate(licenseKey: string): Promise<ActivationResult> {
  const key = licenseKey.trim();
  if (key.length < 8) return { ok: false, message: MESSAGES.bad_request ?? UNREACHABLE };

  let res: Response;
  try {
    res = await fetch('/api/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key }),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }

  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    code?: string;
    apiKey?: string;
    plan?: string;
  } | null;
  if (!body) {
    // A static host with no functions answers with its HTML page, or a 404.
    return { ok: false, message: res.status === 404 || res.ok ? NO_BACKEND : UNREACHABLE };
  }

  const plan = planById(body.plan);
  if (!res.ok || !body.ok || !body.apiKey || !plan) {
    return { ok: false, message: MESSAGES[body.code ?? ''] ?? UNREACHABLE };
  }

  setKey(MANAGED_PROVIDER_ID, body.apiKey, true);
  setLicense({ licenseKey: key, planId: plan.id, activatedAt: Date.now() });
  return { ok: true, plan };
}

/**
 * Activate again with the license already on this device. Used when the model
 * key stops working — usually because the license was activated somewhere
 * else, which rotates the key (§28.2).
 */
export function reactivate(): Promise<ActivationResult> {
  const stored = getLicense();
  if (!stored) return Promise.resolve({ ok: false, message: MESSAGES.invalid_license ?? UNREACHABLE });
  return activate(stored.licenseKey);
}

/** The plan activated on this device, if there is one with a key to use. */
export function currentPlan(): Plan | null {
  const stored = getLicense();
  if (!stored || !getKey(MANAGED_PROVIDER_ID)) return null;
  return planById(stored.planId);
}

export function modelKey(): string {
  return getKey(MANAGED_PROVIDER_ID);
}

/** Clears this device only. The subscription itself is untouched. */
export function signOut(): void {
  forgetAllKeys();
  forgetLicense();
}
