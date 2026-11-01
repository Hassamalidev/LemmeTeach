/**
 * Activation (§15.2, §28.2).
 *
 * The one place the app talks to our own backend: an access code goes to
 * /api/activate and a spend-capped model key comes back. After that,
 * questions go straight from this browser to the model gateway.
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
  bad_request:
    'That does not look like an access code. It starts with txn_ and is shown after you pay. Copy it whole and try again.',
  invalid_code: 'We could not find that access code. Check it and paste it again.',
  not_paid: 'That payment has not gone through yet, so there is nothing to activate.',
  pending: 'Your payment went through, but it is still being set up. Try again in a minute.',
  subscription_ended:
    'That subscription has ended, so there is no credit on it. Pick a plan to start again.',
  unknown_plan:
    'That code is for a plan this site does not recognise, so it cannot be activated here.',
  try_again:
    'Your payment is fine, but we could not set up your questions just now. Try again in a minute.',
  not_configured: 'Activation is not set up on this site yet.',
};

const UNREACHABLE =
  'Could not reach LemmeTeach to activate. Check your connection and try again.';
const NO_BACKEND =
  'This copy of LemmeTeach is demo-only, so it cannot activate a plan. Open the main site instead.';

/** What a Paddle transaction id looks like: the access code (§28.2). */
export function looksLikeCode(code: string): boolean {
  return /^txn_[a-z0-9]{20,40}$/i.test(code.trim());
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Turn an access code into a plan on this device.
 *
 * Straight after checkout, Paddle can take a few seconds to attach the
 * subscription to the payment; the server says `pending` and this asks again,
 * for up to `waitMs`, rather than showing an error for something that is
 * about to work.
 */
export async function activate(code: string, waitMs = 0): Promise<ActivationResult> {
  const trimmed = code.trim();
  if (!looksLikeCode(trimmed)) return { ok: false, message: MESSAGES.bad_request ?? UNREACHABLE };

  const deadline = Date.now() + waitMs;
  for (;;) {
    let res: Response;
    try {
      res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
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

    if (body.code === 'pending' && Date.now() + 2500 < deadline) {
      await sleep(2500);
      continue;
    }

    const plan = planById(body.plan);
    if (!res.ok || !body.ok || !body.apiKey || !plan) {
      return { ok: false, message: MESSAGES[body.code ?? ''] ?? UNREACHABLE };
    }

    setKey(MANAGED_PROVIDER_ID, body.apiKey, true);
    // Stored under the old field name, so a device activated before the move
    // to Paddle is read the same way.
    setLicense({ licenseKey: trimmed, planId: plan.id, activatedAt: Date.now() });
    return { ok: true, plan };
  }
}

/** The access code kept on this device, to show the learner again. */
export function storedCode(): string | null {
  return getLicense()?.licenseKey ?? null;
}

/**
 * Activate again with the access code already on this device. Used when the
 * model key stops working — usually because the code was used on another
 * device, which rotates the key (§28.2).
 */
export function reactivate(): Promise<ActivationResult> {
  const stored = getLicense();
  if (!stored) return Promise.resolve({ ok: false, message: MESSAGES.invalid_code ?? UNREACHABLE });
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
