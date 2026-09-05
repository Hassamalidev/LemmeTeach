/**
 * Budget and cost accounting (§18).
 *
 * The learner is paying per token, so the app is accountable for every call.
 * The budget is not a safety net that fires at the end — it warns the tutor at
 * 80% so it can start wrapping up, and forces a graceful close at 100%. A
 * lesson never dies mid-sentence because of a budget.
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
  /** 0..1 of whichever limit is closest to being hit. */
  fraction: number;
  estimatedCostUsd: number | null;
  warned: boolean;
  exhausted: boolean;
  turns: number;
}

export class Budget {
  private input = 0;
  private output = 0;
  private turnCount = 0;
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

  add(usage: { inputTokens: number; outputTokens: number }): void {
    this.input += Math.max(0, usage.inputTokens || 0);
    this.output += Math.max(0, usage.outputTokens || 0);
    this.onChange?.(this.snapshot());
  }

  countTurn(): void {
    this.turnCount += 1;
  }

  get fraction(): number {
    return Math.max(
      this.input / Math.max(1, this.limits.inputTokens),
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
    const cost = price
      ? (this.input / 1e6) * price.inputPerMTok + (this.output / 1e6) * price.outputPerMTok
      : null;
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      limits: this.limits,
      fraction: this.fraction,
      estimatedCostUsd: cost,
      warned: this.shouldWrapUp,
      exhausted: this.isExhausted,
      turns: this.turnCount,
    };
  }
}

/**
 * A rough token estimate for text, used for the context-growth check in §7 and
 * for the first-run cost estimate. Around 4 characters per token holds well
 * enough across English prose, LaTeX and code for a budgeting decision; it is
 * never presented as an exact number.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
