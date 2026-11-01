/**
 * The one pricing table (§27).
 *
 * Imported by the landing page, by the app's credit line, and by the billing
 * functions, so a price can never say one thing on the page and grant another
 * on the server. Nothing in here is secret.
 *
 * To change a price or a credit, change it here and run the tests:
 * `plans.test.ts` fails if any plan stops clearing the target profit.
 */

export type PlanId = 'starter' | 'regular' | 'intensive';

export interface Plan {
  id: PlanId;
  name: string;
  /** What the learner pays each month, in USD, before tax. */
  priceUsd: number;
  /** The spending cap put on their model key each paid period. */
  creditUsd: number;
  /** Shown as "about N questions". Must not exceed what the credit buys. */
  lessons: number;
  /** One line under the plan name on the pricing table. */
  blurb: string;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 8,
    creditUsd: 4.5,
    lessons: 300,
    blurb: 'Around ten questions a day alongside a course.',
  },
  {
    id: 'regular',
    name: 'Regular',
    priceUsd: 12,
    creditUsd: 8,
    lessons: 530,
    blurb: 'Homework and revision across several subjects.',
  },
  {
    id: 'intensive',
    name: 'Intensive',
    priceUsd: 20,
    creditUsd: 15,
    lessons: 1000,
    blurb: 'Heavy daily use, long problem sheets, or the deeper tutor.',
  },
];

export const PLAN_IDS: readonly PlanId[] = PLANS.map((p) => p.id);

export function planById(id: string | null | undefined): Plan | null {
  return PLANS.find((p) => p.id === id) ?? null;
}

/** The plan one step up, for the "move to a bigger plan" offer. */
export function nextPlanUp(id: PlanId): Plan | null {
  const i = PLANS.findIndex((p) => p.id === id);
  return PLANS[i + 1] ?? null;
}

/* --------------------------------- margin --------------------------------- */

/** What must be left per subscriber per month after every cost below. */
export const TARGET_PROFIT_USD = 2;

/**
 * Set aside per subscriber for hosting and storage. A learner's lessons, notes
 * and record are stored in their own browser, so there is no per-user storage
 * bill; this covers the fixed hosting plan, which eighty subscribers pay off.
 */
export const INFRA_ALLOWANCE_USD = 0.25;

/**
 * Worst-case fees. They change, so these carry the date they were last read
 * off the providers' own pricing pages — re-check before changing a price.
 */
export const FEES = {
  checkedOn: '2026-10-18',
  /**
   * Paddle: 5% per transaction, all in. As merchant of record it handles tax,
   * cards, currencies and international sales inside that figure.
   */
  paymentPercent: 0.05,
  /** Paddle: fixed fee per transaction. */
  paymentFixedUsd: 0.5,
  /** Payout to a bank account outside the US, allowed for in case it costs. */
  payoutPercent: 0.01,
  /** OpenRouter: fee on buying the credit we hand out. */
  creditPurchasePercent: 0.055,
} as const;

/** What reaches the bank from one month of one plan. */
export function keptFrom(priceUsd: number): number {
  const afterPayment = priceUsd * (1 - FEES.paymentPercent) - FEES.paymentFixedUsd;
  return afterPayment * (1 - FEES.payoutPercent);
}

/** What it costs us to hand out a given amount of credit. */
export function costOfCredit(creditUsd: number): number {
  return creditUsd * (1 + FEES.creditPurchasePercent);
}

/** Profit on a plan when the learner spends every cent of their credit. */
export function profitFor(plan: Plan): number {
  return keptFrom(plan.priceUsd) - costOfCredit(plan.creditUsd) - INFRA_ALLOWANCE_USD;
}

/* -------------------------------- lessons --------------------------------- */

/**
 * What a typical solved question costs on the standard tutor.
 *
 * Worked out from measured prompt sizes, not yet from a live key. A question
 * is about one reader turn and fifteen solver turns. Each solver turn sends
 * roughly 3,600 tokens of instructions and tool definitions plus a
 * conversation capped near 8,000, and writes about 400. That is around
 * 80k input and 6k output tokens: 1.1 cents at $0.10 / $0.50 per million with
 * no prompt caching, and about half a cent with it.
 *
 * 1.5 cents leaves headroom over the uncached figure for longer questions.
 * Re-derive it from real usage once there is some: the counts on the pricing
 * page are this number and nothing else.
 */
export const TYPICAL_LESSON_USD = 0.015;

/** How many typical lessons an amount of credit buys, rounded down. */
export function lessonsFor(creditUsd: number): number {
  return Math.max(0, Math.floor(creditUsd / TYPICAL_LESSON_USD));
}

export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}
