/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Lemon Squeezy checkout links, one per plan (§24). Public by nature. */
  readonly VITE_CHECKOUT_STARTER?: string;
  readonly VITE_CHECKOUT_REGULAR?: string;
  readonly VITE_CHECKOUT_INTENSIVE?: string;
  readonly VITE_BILLING_PORTAL_URL?: string;
}

declare module '*.ndjson?raw' {
  const content: string;
  export default content;
}
