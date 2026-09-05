/**
 * The mastery update rule (§12.2), including decay across simulated months.
 *
 * These tests exist mostly to stop the rule being "simplified" into an
 * assignment. Each one states the behaviour in the terms a learner would care
 * about, not in terms of the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { applyObservation, decayedMastery, emptyRecord, masteryLabel } from './concepts';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

const seeded = (mastery: number, confidence = 0.8, lastSeen = T0) => ({
  ...emptyRecord('chain-rule', 'math'),
  mastery,
  confidence,
  lastSeen,
  timesSeen: 5,
});

describe('mastery update', () => {
  it('one lucky answer cannot mark a new concept mastered', () => {
    const fresh = emptyRecord('chain-rule', 'math');
    const after = applyObservation(fresh, { mastery: 1, confidence: 1 }, T0);
    expect(after.mastery).toBeLessThan(0.65);
  });

  it('one slip cannot erase a month of demonstrated work', () => {
    const strong = seeded(0.9);
    const after = applyObservation(strong, { mastery: 0, confidence: 0.5 }, T0);
    expect(after.mastery).toBeGreaterThan(0.4);
  });

  it('repeated good evidence does converge on mastered', () => {
    let rec = emptyRecord('chain-rule', 'math');
    for (let i = 0; i < 8; i++) {
      rec = applyObservation(rec, { mastery: 0.95, confidence: 0.8 }, T0 + i * DAY);
    }
    expect(rec.mastery).toBeGreaterThan(0.85);
  });

  it('a higher-confidence observation moves the record further', () => {
    const base = seeded(0.5, 0.5);
    const weak = applyObservation(base, { mastery: 1, confidence: 0 }, T0);
    const strong = applyObservation(base, { mastery: 1, confidence: 1 }, T0);
    expect(strong.mastery).toBeGreaterThan(weak.mastery);
  });

  it('knowledge decays when it has not been seen', () => {
    const rec = seeded(0.9);
    expect(decayedMastery(rec, T0)).toBeCloseTo(0.9, 5);
    const afterAMonth = decayedMastery(rec, T0 + 30 * DAY);
    expect(afterAMonth).toBeLessThan(0.9);
    expect(afterAMonth).toBeGreaterThan(0.3);
    const afterHalfAYear = decayedMastery(rec, T0 + 180 * DAY);
    expect(afterHalfAYear).toBeLessThan(0.1);
  });

  it('decay applies before the new observation is blended in', () => {
    const stale = seeded(0.9, 0.9);
    const recent = seeded(0.9, 0.9, T0 + 60 * DAY);
    const at = T0 + 60 * DAY;
    const staleAfter = applyObservation(stale, { mastery: 0.5, confidence: 0.5 }, at);
    const recentAfter = applyObservation(recent, { mastery: 0.5, confidence: 0.5 }, at);
    expect(staleAfter.mastery).toBeLessThan(recentAfter.mastery);
  });

  it('never leaves the 0..1 range', () => {
    const rec = seeded(0.5);
    expect(applyObservation(rec, { mastery: 5, confidence: 5 }, T0).mastery).toBeLessThanOrEqual(1);
    expect(applyObservation(rec, { mastery: -3, confidence: 1 }, T0).mastery).toBeGreaterThanOrEqual(0);
  });

  it('keeps only the last ten pieces of evidence', () => {
    let rec = emptyRecord('chain-rule', 'math');
    for (let i = 0; i < 15; i++) {
      rec = applyObservation(rec, { mastery: 0.6, evidence: `note ${i}` }, T0 + i * DAY);
    }
    expect(rec.evidence).toHaveLength(10);
    expect(rec.evidence.at(-1)?.note).toBe('note 14');
  });
});

describe('misconceptions', () => {
  it('records a misconception the first time and counts repeats', () => {
    let rec = emptyRecord('product-rule', 'math');
    rec = applyObservation(rec, { misconception: 'Adds the derivatives instead of the product form' });
    rec = applyObservation(rec, { misconception: 'adds the derivatives instead of the product form.' });
    expect(rec.misconceptions).toHaveLength(1);
    expect(rec.misconceptions[0]?.seen).toBe(2);
  });

  it('marks one resolved without deleting the history', () => {
    let rec = emptyRecord('product-rule', 'math');
    rec = applyObservation(rec, { misconception: 'Adds the derivatives' });
    rec = applyObservation(rec, { resolved: true });
    expect(rec.misconceptions[0]?.resolved).toBe(true);
    expect(rec.misconceptions).toHaveLength(1);
  });

  it('re-opens a misconception that comes back', () => {
    let rec = emptyRecord('product-rule', 'math');
    rec = applyObservation(rec, { misconception: 'Adds the derivatives' });
    rec = applyObservation(rec, { resolved: true });
    rec = applyObservation(rec, { misconception: 'Adds the derivatives' });
    expect(rec.misconceptions[0]?.resolved).toBe(false);
    expect(rec.misconceptions[0]?.seen).toBe(2);
  });
});

describe('masteryLabel', () => {
  it('reads as plain language', () => {
    expect(masteryLabel(0)).toBe('new');
    expect(masteryLabel(0.3)).toBe('just started');
    expect(masteryLabel(0.5)).toBe('shaky');
    expect(masteryLabel(0.7)).toBe('mostly there');
    expect(masteryLabel(0.95)).toBe('solid');
  });
});
