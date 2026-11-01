/**
 * Paddle checkout in the browser (§24, §28).
 *
 * Paddle.js is loaded only when someone is about to pay, and opens Paddle's
 * own checkout over the page. When the payment goes through, Paddle hands the
 * browser the transaction id, which is the learner's access code: it goes to
 * /api/activate and a spend-capped model key comes back.
 *
 * Everything here is public by design: the client-side token can only open
 * checkouts, and the price ids are on every checkout anyway.
 */
import type { PlanId } from '../../shared/plans';

const SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

interface PaddleEvent {
  name?: string;
  data?: { transaction_id?: string };
}

interface PaddleJs {
  Environment: { set: (env: string) => void };
  Initialize: (opts: { token: string; eventCallback: (e: PaddleEvent) => void }) => void;
  Checkout: {
    open: (opts: {
      items: { priceId: string; quantity: number }[];
      settings?: Record<string, unknown>;
    }) => void;
    close: () => void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

const PRICES: Record<PlanId, string | undefined> = {
  starter: import.meta.env.VITE_PADDLE_PRICE_STARTER,
  regular: import.meta.env.VITE_PADDLE_PRICE_REGULAR,
  intensive: import.meta.env.VITE_PADDLE_PRICE_INTENSIVE,
};

function token(): string | null {
  const t = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
  return t && /^(test|live)_[A-Za-z0-9]+$/.test(t) ? t : null;
}

/** Whether a plan can be bought on this build. A demo-only build has no checkout. */
export function checkoutAvailable(plan: PlanId): boolean {
  return token() !== null && /^pri_[a-z0-9]+$/.test(PRICES[plan] ?? '');
}

/** Called with the transaction id when a checkout is paid. */
let onPaid: ((transactionId: string) => void) | null = null;
let loading: Promise<PaddleJs | null> | null = null;

/** Load and set up Paddle.js once. Resolves to null when it cannot be. */
export function loadPaddle(): Promise<PaddleJs | null> {
  const t = token();
  if (!t) return Promise.resolve(null);
  loading ??= new Promise<PaddleJs | null>((resolve) => {
    const ready = (): void => {
      const paddle = window.Paddle;
      if (!paddle) return resolve(null);
      if (import.meta.env.VITE_PADDLE_ENV !== 'production') paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: t,
        eventCallback: (e) => {
          const id = e.data?.transaction_id;
          if (e.name === 'checkout.completed' && id) onPaid?.(id);
        },
      });
      resolve(paddle);
    };
    if (window.Paddle) return ready();
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Open the checkout for a plan. `paid` is called once, with the access code,
 * when the payment has gone through. Resolves to false if checkout could not
 * be opened, so the page can say so instead of doing nothing.
 */
export async function openCheckout(plan: PlanId, paid: (transactionId: string) => void): Promise<boolean> {
  const priceId = PRICES[plan];
  if (!checkoutAvailable(plan) || !priceId) return false;
  const paddle = await loadPaddle();
  if (!paddle) return false;
  onPaid = paid;
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    settings: { displayMode: 'overlay', theme: 'dark', variant: 'one-page' },
  });
  return true;
}

/**
 * Paddle's payment links come back to this site with `_ptxn` in the address,
 * and Paddle.js opens that checkout by itself once it is loaded. This loads
 * it when that is the case, and reports the payment like any other.
 */
export function resumeLinkedCheckout(paid: (transactionId: string) => void): boolean {
  let linked = false;
  try {
    linked = new URLSearchParams(window.location.search).has('_ptxn');
  } catch {
    linked = false;
  }
  if (!linked || !token()) return false;
  onPaid = paid;
  void loadPaddle();
  return true;
}

export function closeCheckout(): void {
  try {
    window.Paddle?.Checkout.close();
  } catch {
    /* Already closed. */
  }
}
