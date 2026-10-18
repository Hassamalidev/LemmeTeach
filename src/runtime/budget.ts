/**
 * Budget and cost accounting (§18).
 *
 * The learner has prepaid a fixed credit, so the app is accountable for every
 * call. The budget is not a safety net that fires at the end — it warns the
 * tutor at 80% so it can start wrapping up, and forces a graceful close at
 * 100%. A lesson never dies mid-sentence because of a budget.
 *
 * Input is counted in *billable* tokens. Most of every turn is the same system
 * prompt and tool definitions read back from the prompt cache at a tenth of
 * the price, and counting those at full weight would end a cheap lesson early.
 */
import { budgetError } from './errors';
import { priceFor } from '../providers/pricing';

export interface BudgetLimits {
  inputTokens: number;
  outputTokens: number;
}

export interface BudgetSnapshot {
  inputTokens: number;
  outputTokens: number;
  limits: BudgetLimits;
  /** Input tokens that came from the prompt cache, included in inputTokens. */
  cachedInputTokens: number;
  /** 0..1 of whichever limit is closest to being hit. */
  fraction: number;
  estimatedCostUsd: number | null;
  /** True when the cost is the gateway's own figure rather than our estimate. */
  costIsExact: boolean;
  warned: boolean;
  exhausted: boolean;
  turns: number;
}

export class Budget {
  private input = 0;
  private cached = 0;
  private output = 0;
  private turnCount = 0;
  private reportedCost = 0;
  /** Stays true only while every turn so far came with the gateway's cost. */
  private allCostsReported = true;
  private usageCount = 0;
  private model: string;
  private providerId: string;
  private onChange?: (s: BudgetSnapshot) => void;

  constructor(
    public limits: BudgetLimits,
    opts: { model: string; providerId: string; onChange?: (s: BudgetSnapshot) => void },
  ) {
    this.model = opts.model;
    this.providerId = opts.providerId;
    this.onChange = opts.onChange;
  }

  setModel(model: string): void {
    this.model = model;
  }

  add(usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    costUsd?: number;
  }): void {
    const input = Math.max(0, usage.inputTokens || 0);
    this.input += input;
    this.cached += Math.min(input, Math.max(0, usage.cachedInputTokens || 0));
    this.output += Math.max(0, usage.outputTokens || 0);
    this.usageCount += 1;
    if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) {
      this.reportedCost += Math.max(0, usage.costUsd);
    } else {
      this.allCostsReported = false;
    }
    this.onChange?.(this.snapshot());
  }

  /** Input weighted by what it costs: a cached token is a tenth of a fresh one. */
  private get billableInput(): number {
    return this.input - this.cached * (1 - CACHED_TOKEN_WEIGHT);
  }

  countTurn(): void {
    this.turnCount += 1;
  }

  get fraction(): number {
    return Math.max(
      this.billableInput / Math.max(1, this.limits.inputTokens),
      this.output / Math.max(1, this.limits.outputTokens),
    );
  }

  /** True once the tutor should start closing the lesson down. */
  get shouldWrapUp(): boolean {
    return this.fraction >= 0.8;
  }

  get isExhausted(): boolean {
    return this.fraction >= 1;
  }

  assertNotExhausted(): void {
    if (this.isExhausted) {
      throw budgetError(
        'This lesson has used its whole token budget. Wrapping up with what we covered.',
        { detail: `input ${this.input}/${this.limits.inputTokens}, output ${this.output}/${this.limits.outputTokens}` },
      );
    }
  }

  snapshot(): BudgetSnapshot {
    const price = priceFor(this.providerId, this.model);
    const exact = this.allCostsReported && this.usageCount > 0;
    const estimate = price
      ? ((this.input - this.cached) / 1e6) * price.inputPerMTok +
        (this.cached / 1e6) * (price.cachedInputPerMTok ?? price.inputPerMTok) +
        (this.output / 1e6) * price.outputPerMTok
      : null;
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      cachedInputTokens: this.cached,
      limits: this.limits,
      fraction: this.fraction,
      // The gateway's own figure wins: it knows cache writes and fallbacks.
      estimatedCostUsd: exact ? this.reportedCost : estimate,
      costIsExact: exact,
      warned: this.shouldWrapUp,
      exhausted: this.isExhausted,
      turns: this.turnCount,
    };
  }
}

/** What a cache-read token costs relative to a fresh one, across our models. */
export const CACHED_TOKEN_WEIGHT = 0.1;

/**
 * A rough token estimate for text, used for the context-growth check in §7 and
 * for the first-run cost estimate. Around 4 characters per token holds well
 * enough across English prose, LaTeX and code for a budgeting decision; it is
 * never presented as an exact number.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
