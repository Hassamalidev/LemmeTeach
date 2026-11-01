/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Paddle's client-side token: it can only open checkouts (§24). Public by nature. */
  readonly VITE_PADDLE_CLIENT_TOKEN?: string;
  /** `sandbox` or `production`. */
  readonly VITE_PADDLE_ENV?: string;
  /** Paddle price id of each plan. */
  readonly VITE_PADDLE_PRICE_STARTER?: string;
  readonly VITE_PADDLE_PRICE_REGULAR?: string;
  readonly VITE_PADDLE_PRICE_INTENSIVE?: string;
  /** Paddle's customer portal for this seller. */
  readonly VITE_BILLING_PORTAL_URL?: string;
}

declare module '*.ndjson?raw' {
  const content: string;
  export default content;
}
