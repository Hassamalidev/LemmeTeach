/**
 * The margin rule, enforced (§27.2).
 *
 * A price edit that quietly drops a plan below the target profit is the kind
 * of mistake nobody notices until the payout arrives, so it is a test.
 */
import { describe, expect, it } from 'vitest';
import {
  PLANS,
  TARGET_PROFIT_USD,
  TYPICAL_LESSON_USD,
  lessonsFor,
  nextPlanUp,
  planById,
  profitFor,
} from './plans';

describe('the plans', () => {
  for (const plan of PLANS) {
    it(`${plan.name} clears the target profit with every fee at its worst`, () => {
      expect(profitFor(plan), `profit ${profitFor(plan).toFixed(2)}`).toBeGreaterThanOrEqual(
        TARGET_PROFIT_USD,
      );
    });

    it(`${plan.name} does not give away margin it could hand to the learner`, () => {
      // More than fifty cents over target means the credit could be raised.
      expect(profitFor(plan)).toBeLessThan(TARGET_PROFIT_USD + 0.5);
    });

    it(`${plan.name} promises no more lessons than its credit buys`, () => {
      expect(plan.lessons).toBeLessThanOrEqual(lessonsFor(plan.creditUsd));
      expect(plan.lessons * TYPICAL_LESSON_USD).toBeLessThanOrEqual(plan.creditUsd);
    });

    it(`${plan.name} never hands out more credit than it charges`, () => {
      expect(plan.creditUsd).toBeLessThan(plan.priceUsd);
      expect(plan.creditUsd).toBeGreaterThan(0);
    });
  }

  it('are ordered from smallest to largest', () => {
    const prices = PLANS.map((p) => p.priceUsd);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(nextPlanUp('starter')?.id).toBe('regular');
    expect(nextPlanUp('intensive')).toBeNull();
  });

  it('are looked up by id, and an unknown id is nothing', () => {
    expect(planById('regular')?.priceUsd).toBe(12);
    expect(planById('regular')?.creditUsd).toBe(7.75);
    expect(planById('enterprise')).toBeNull();
    expect(planById(undefined)).toBeNull();
  });
});
