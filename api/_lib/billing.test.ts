/**
 * The billing rules (§28), tested without a network.
 *
 * These are the rules that decide who gets credit. The failures they guard
 * against cost real money in one direction and a paying learner's month in the
 * other, so every row of the table in §28.3 has a case here, plus the retries.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decide,
  formatKeyName,
  keyBelongsTo,
  markerFor,
  parseKeyName,
  remainingOn,
  type KeyRecord,
  type SubscriptionState,
} from './grants';
import { planForPrice, readSubscription, verifySignature } from './paddle';
import { readEvent } from './events';
import { planById } from '../../shared/plans';

// Read from the pricing table, so a price change does not break these tests.
const credit = (id: string): number => planById(id)?.creditUsd ?? 0;
const STARTER = credit('starter');
const REGULAR = credit('regular');
const INTENSIVE = credit('intensive');

const SUB = 'sub_01hv8x2v3k4m5n6p7q8r9s0t1u';
const MAY = '2026-05-08T10:00:00.000000Z';
const JUNE = '2026-06-08T10:00:00.000000Z';
const MAY_MARKER = markerFor(MAY) ?? '';

const sub = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  subscriptionId: SUB,
  planId: 'regular',
  status: 'active',
  periodStart: MAY,
  ...over,
});

const key = (over: Partial<KeyRecord> = {}, refunded = false): KeyRecord => ({
  hash: 'h1',
  name: formatKeyName({ subscriptionId: SUB, planId: 'regular', marker: MAY_MARKER, refunded }),
  limit: REGULAR,
  usage: 2.5,
  disabled: false,
  ...over,
});

describe('the key name', () => {
  it('round-trips, with and without a refund on it', () => {
    for (const refunded of [false, true]) {
      const n = { subscriptionId: SUB, planId: 'intensive' as const, marker: '1780000000', refunded };
      expect(parseKeyName(formatKeyName(n))).toEqual(n);
    }
    expect(keyBelongsTo(formatKeyName({ subscriptionId: SUB, planId: 'starter', marker: '1', refunded: false }), SUB)).toBe(true);
  });

  it('rejects names that are not ours', () => {
    expect(parseKeyName('my laptop key')).toBeNull();
    expect(parseKeyName(`lemmeteach:s${SUB}:pplatinum:r1`)).toBeNull();
    expect(parseKeyName(`lemmeteach:o501:pregular:rinit`)).toBeNull();
    expect(keyBelongsTo('something else', SUB)).toBe(false);
  });

  it('turns the start of a period into a comparable marker', () => {
    expect(Number(markerFor(JUNE))).toBeGreaterThan(Number(markerFor(MAY)));
    expect(markerFor(null)).toBeNull();
    expect(markerFor('not a date')).toBeNull();
  });
});

describe('a new subscription', () => {
  it('creates a key capped at the plan credit', () => {
    const action = decide('subscription', sub(), null);
    expect(action).toEqual({
      do: 'create',
      name: formatKeyName({ subscriptionId: SUB, planId: 'regular', marker: MAY_MARKER, refunded: false }),
      limit: REGULAR,
    });
  });

  it('does nothing when the key already exists for this period', () => {
    expect(decide('subscription', sub(), key()).do).toBe('none');
  });

  it('does nothing for a price that is not one of our plans', () => {
    expect(decide('subscription', sub({ planId: null }), null).do).toBe('none');
  });

  it('does nothing without a billing period to grant against', () => {
    expect(decide('subscription', sub({ periodStart: null }), null).do).toBe('none');
  });

  it('creates one on a trial too', () => {
    expect(decide('subscription', sub({ status: 'trialing' }), null).do).toBe('create');
  });
});

describe('a renewal', () => {
  it('grants one period of credit on top of what has been spent', () => {
    const action = decide('subscription', sub({ periodStart: JUNE }), key());
    expect(action.do).toBe('update');
    if (action.do !== 'update') return;
    expect(action.patch.limit).toBe(2.5 + REGULAR);
    expect(parseKeyName(action.patch.name ?? '')?.marker).toBe(markerFor(JUNE));
  });

  it('does not grant twice when the webhook is retried', () => {
    const renewed = key({
      limit: 2.5 + REGULAR,
      name: formatKeyName({ subscriptionId: SUB, planId: 'regular', marker: markerFor(JUNE) ?? '', refunded: false }),
    });
    expect(decide('subscription', sub({ periodStart: JUNE }), renewed).do).toBe('none');
  });

  it('does not grant on an update inside the same period', () => {
    expect(decide('subscription', sub(), key()).do).toBe('none');
  });

  it('does not grant while a renewal payment is being retried', () => {
    expect(decide('subscription', sub({ status: 'past_due', periodStart: JUNE }), key()).do).toBe('none');
  });

  it('grants the new plan after a downgrade', () => {
    const action = decide('subscription', sub({ planId: 'starter', periodStart: JUNE }), key());
    if (action.do !== 'update') throw new Error('expected an update');
    expect(action.patch.limit).toBe(2.5 + STARTER);
    expect(parseKeyName(action.patch.name ?? '')?.planId).toBe('starter');
  });
});

describe('changing plan inside a period', () => {
  it('adds the difference on an upgrade', () => {
    const action = decide('subscription', sub({ planId: 'intensive' }), key());
    if (action.do !== 'update') throw new Error('expected an update');
    expect(action.patch.limit).toBe(REGULAR + (INTENSIVE - REGULAR));
  });

  it('adds it once, not on every retry', () => {
    const upgraded = key({
      limit: INTENSIVE,
      name: formatKeyName({ subscriptionId: SUB, planId: 'intensive', marker: MAY_MARKER, refunded: false }),
    });
    expect(decide('subscription', sub({ planId: 'intensive' }), upgraded).do).toBe('none');
  });

  it('takes nothing away on a downgrade until the period ends', () => {
    expect(decide('subscription', sub({ planId: 'starter' }), key()).do).toBe('none');
  });
});

describe('a subscription that has stopped paying', () => {
  for (const status of ['canceled', 'paused']) {
    it(`disables the key when the status is ${status}`, () => {
      expect(decide('subscription', sub({ status }), key())).toEqual({
        do: 'update',
        hash: 'h1',
        patch: { disabled: true },
      });
    });
  }

  it('never creates a key for one', () => {
    expect(decide('subscription', sub({ status: 'canceled' }), null).do).toBe('none');
  });

  it('re-enables the key if they start paying again', () => {
    expect(decide('subscription', sub(), key({ disabled: true }))).toEqual({
      do: 'update',
      hash: 'h1',
      patch: { disabled: false },
    });
  });
});

describe('a refund', () => {
  it('disables the key and marks the period refunded', () => {
    const action = decide('refund', sub(), key());
    if (action.do !== 'update') throw new Error('expected an update');
    expect(action.patch.disabled).toBe(true);
    expect(parseKeyName(action.patch.name ?? '')?.refunded).toBe(true);
  });

  it('is not undone by a later look at a subscription still marked active', () => {
    expect(decide('subscription', sub(), key({ disabled: true }, true)).do).toBe('none');
  });

  it('is lifted by a new paid period', () => {
    const action = decide('subscription', sub({ periodStart: JUNE }), key({ disabled: true }, true));
    if (action.do !== 'update') throw new Error('expected an update');
    expect(action.patch.disabled).toBe(false);
    expect(parseKeyName(action.patch.name ?? '')?.refunded).toBe(false);
  });

  it('is applied once', () => {
    expect(decide('refund', sub(), key({ disabled: true }, true)).do).toBe('none');
  });
});

describe('remaining credit', () => {
  it('is the cap less what was spent, and never negative', () => {
    expect(remainingOn(key())).toBe(REGULAR - 2.5);
    expect(remainingOn(key({ usage: 99 }))).toBe(0);
  });

  it('is nothing on an uncapped key, which is not one we issued', () => {
    expect(remainingOn(key({ limit: null }))).toBe(0);
  });
});

describe('the webhook signature', () => {
  const secret = 'pdl_ntfset_for_tests';
  const body = '{"event_type":"subscription.created"}';
  const now = 1_780_000_000;
  const sign = (ts: number, raw = body, s = secret): string =>
    `ts=${ts};h1=${createHmac('sha256', s).update(`${ts}:${raw}`).digest('hex')}`;

  it('accepts the right signature', () => {
    expect(verifySignature(body, sign(now), secret, now)).toBe(true);
  });

  it('accepts any of several while a secret is being rotated', () => {
    const header = `ts=${now};h1=${'0'.repeat(64)};h1=${sign(now).split('h1=')[1]}`;
    expect(verifySignature(body, header, secret, now)).toBe(true);
  });

  it('rejects a wrong, missing or truncated one, and a tampered body', () => {
    expect(verifySignature(body, sign(now, body, 'another secret'), secret, now)).toBe(false);
    expect(verifySignature(body, null, secret, now)).toBe(false);
    expect(verifySignature(body, sign(now).slice(0, 30), secret, now)).toBe(false);
    expect(verifySignature(`${body} `, sign(now), secret, now)).toBe(false);
    expect(verifySignature(body, sign(now), '', now)).toBe(false);
  });

  it('rejects an old one, so a captured request cannot be replayed', () => {
    expect(verifySignature(body, sign(now - 3600), secret, now)).toBe(false);
  });
});

describe('reading an event', () => {
  const prices = { PADDLE_PRICE_STARTER: 'pri_s', PADDLE_PRICE_REGULAR: 'pri_r', PADDLE_PRICE_INTENSIVE: 'pri_i' };
  const subscription = {
    id: SUB,
    status: 'active',
    items: [{ price: { id: 'pri_r' }, quantity: 1 }],
    current_billing_period: { starts_at: MAY, ends_at: JUNE },
  };

  it('maps a price to a plan through configuration', () => {
    expect(planForPrice('pri_i', prices)).toBe('intensive');
    expect(planForPrice('pri_unknown', prices)).toBeNull();
    expect(planForPrice('', prices)).toBeNull();
  });

  it('reads every subscription event as a fresh look at the subscription', () => {
    for (const type of ['subscription.created', 'subscription.updated', 'subscription.canceled']) {
      expect(readEvent({ event_type: type, data: subscription }, prices)).toEqual({
        event: 'subscription',
        sub: { subscriptionId: SUB, planId: 'regular', status: 'active', periodStart: MAY },
      });
    }
  });

  it('copes with a subscription that has no current period', () => {
    expect(readSubscription({ ...subscription, current_billing_period: null }, prices)?.periodStart).toBeNull();
  });

  it('reads an approved full refund and a chargeback', () => {
    const refund = { action: 'refund', status: 'approved', type: 'full', subscription_id: SUB };
    expect(readEvent({ event_type: 'adjustment.updated', data: refund }, prices)).toEqual({
      event: 'refund',
      subscriptionId: SUB,
    });
    const chargeback = { action: 'chargeback', status: 'approved', subscription_id: SUB };
    expect(readEvent({ event_type: 'adjustment.created', data: chargeback }, prices)?.event).toBe('refund');
  });

  it('ignores a refund still waiting for approval, a partial one, and a credit', () => {
    const base = { subscription_id: SUB, type: 'full' };
    expect(readEvent({ event_type: 'adjustment.created', data: { ...base, action: 'refund', status: 'pending_approval' } }, prices)).toBeNull();
    expect(readEvent({ event_type: 'adjustment.updated', data: { ...base, action: 'refund', status: 'approved', type: 'partial' } }, prices)).toBeNull();
    expect(readEvent({ event_type: 'adjustment.updated', data: { ...base, action: 'credit', status: 'approved' } }, prices)).toBeNull();
  });

  it('ignores events it has no rule for', () => {
    expect(readEvent({ event_type: 'transaction.completed', data: { id: 'txn_x' } }, prices)).toBeNull();
    expect(readEvent({}, prices)).toBeNull();
  });
});
