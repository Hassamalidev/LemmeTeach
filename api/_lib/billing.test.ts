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
  INIT_MARKER,
  keyBelongsToOrder,
  markerFor,
  parseKeyName,
  remainingOn,
  type KeyRecord,
  type SubscriptionState,
} from './grants';
import { planForVariant, verifySignature } from './lemon';
import { readEvent } from './events';
import { planById } from '../../shared/plans';

// Read from the pricing table, so a price change does not break these tests.
const credit = (id: string): number => planById(id)?.creditUsd ?? 0;
const STARTER = credit('starter');
const REGULAR = credit('regular');
const INTENSIVE = credit('intensive');

const MAY = '2026-05-08T10:00:00.000000Z';
const JUNE = '2026-06-08T10:00:00.000000Z';

const sub = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  orderId: '501',
  planId: 'regular',
  status: 'active',
  renewsAt: JUNE,
  ...over,
});

const key = (over: Partial<KeyRecord> = {}): KeyRecord => ({
  hash: 'h1',
  name: formatKeyName({ orderId: '501', planId: 'regular', marker: markerFor(MAY) }),
  limit: REGULAR,
  usage: 2.5,
  disabled: false,
  ...over,
});

describe('the key name', () => {
  it('round-trips', () => {
    const name = formatKeyName({ orderId: '501', planId: 'starter', marker: INIT_MARKER });
    expect(name).toBe('lemmeteach:o501:pstarter:rinit');
    expect(parseKeyName(name)).toEqual({ orderId: '501', planId: 'starter', marker: 'init' });
  });

  it('rejects names that are not ours', () => {
    expect(parseKeyName('my personal key')).toBeNull();
    expect(parseKeyName('lemmeteach:o501:penterprise:rinit')).toBeNull();
    expect(keyBelongsToOrder('lemmeteach:o5010:pstarter:rinit', '501')).toBe(false);
    expect(keyBelongsToOrder('lemmeteach:o501:pstarter:rinit', '501')).toBe(true);
  });

  it('turns renews_at into a comparable marker', () => {
    expect(Number(markerFor(JUNE))).toBeGreaterThan(Number(markerFor(MAY)));
    expect(markerFor(null)).toBe(INIT_MARKER);
    expect(markerFor('not a date')).toBe(INIT_MARKER);
  });
});

describe('a new subscription', () => {
  it('creates a key capped at the plan credit', () => {
    const action = decide('subscription_created', sub(), null);
    expect(action).toEqual({
      do: 'create',
      name: formatKeyName({ orderId: '501', planId: 'regular', marker: markerFor(JUNE) }),
      limit: REGULAR,
    });
  });

  it('only records the period when activation got there first', () => {
    const early = key({
      name: formatKeyName({ orderId: '501', planId: 'regular', marker: INIT_MARKER }),
      usage: 0,
    });
    const action = decide('subscription_created', sub(), early);
    expect(action.do).toBe('update');
    if (action.do !== 'update') return;
    expect(action.patch.limit).toBeUndefined();
    expect(parseKeyName(action.patch.name ?? '')?.marker).toBe(markerFor(JUNE));
  });

  it('does nothing for a variant that is not one of our plans', () => {
    expect(decide('subscription_created', sub({ planId: null }), null).do).toBe('none');
  });
});

describe('a renewal', () => {
  it('grants one period of credit on top of what has been spent', () => {
    const action = decide('subscription_updated', sub(), key());
    expect(action.do).toBe('update');
    if (action.do !== 'update') return;
    // The unspent part is dropped: the new cap is what was spent plus one period.
    expect(action.patch.limit).toBe(2.5 + REGULAR);
    expect(parseKeyName(action.patch.name ?? '')?.marker).toBe(markerFor(JUNE));
  });

  it('does not grant twice when the webhook is retried', () => {
    const first = decide('subscription_updated', sub(), key());
    if (first.do !== 'update') throw new Error('expected a grant');
    const after = key({ name: first.patch.name, limit: first.patch.limit });

    expect(decide('subscription_updated', sub(), after)).toEqual({
      do: 'none',
      why: 'nothing has changed',
    });
  });

  it('does not grant on an update inside the same period', () => {
    expect(decide('subscription_updated', sub({ renewsAt: MAY }), key()).do).toBe('none');
  });

  it('does not grant while a payment is being retried', () => {
    expect(decide('subscription_updated', sub({ status: 'past_due' }), key()).do).toBe('none');
  });

  it('grants the new plan after a downgrade', () => {
    const action = decide('subscription_updated', sub({ planId: 'starter' }), key());
    if (action.do !== 'update') throw new Error('expected a grant');
    expect(action.patch.limit).toBe(2.5 + STARTER);
    expect(parseKeyName(action.patch.name ?? '')?.planId).toBe('starter');
  });
});

describe('changing plan inside a period', () => {
  it('adds the difference on an upgrade', () => {
    const action = decide('subscription_updated', sub({ planId: 'intensive', renewsAt: MAY }), key());
    if (action.do !== 'update') throw new Error('expected a top-up');
    expect(action.patch.limit).toBe(INTENSIVE); // the old cap plus the difference
    expect(parseKeyName(action.patch.name ?? '')?.planId).toBe('intensive');
  });

  it('adds it once, not on every retry', () => {
    const upgraded = sub({ planId: 'intensive', renewsAt: MAY });
    const first = decide('subscription_updated', upgraded, key());
    if (first.do !== 'update') throw new Error('expected a top-up');
    const after = key({ name: first.patch.name, limit: first.patch.limit });
    expect(decide('subscription_updated', upgraded, after).do).toBe('none');
  });

  it('takes nothing away on a downgrade until the period ends', () => {
    const action = decide('subscription_updated', sub({ planId: 'starter', renewsAt: MAY }), key());
    expect(action.do).toBe('none');
  });
});

describe('a subscription that has stopped paying', () => {
  for (const status of ['expired', 'unpaid', 'paused']) {
    it(`disables the key when the status is ${status}`, () => {
      expect(decide('subscription_updated', sub({ status }), key())).toEqual({
        do: 'update',
        hash: 'h1',
        patch: { disabled: true },
      });
    });
  }

  it('disables the key on expiry and on a refund', () => {
    for (const event of ['subscription_expired', 'order_refunded'] as const) {
      const action = decide(event, sub({ planId: null, status: 'refunded' }), key());
      expect(action).toEqual({ do: 'update', hash: 'h1', patch: { disabled: true } });
    }
  });

  it('leaves a cancelled subscription alone until it expires', () => {
    expect(decide('subscription_updated', sub({ status: 'cancelled', renewsAt: MAY }), key()).do).toBe(
      'none',
    );
  });

  it('never creates a key for one', () => {
    expect(decide('subscription_expired', sub({ status: 'expired' }), null).do).toBe('none');
    expect(decide('subscription_updated', sub({ status: 'cancelled' }), null).do).toBe('none');
  });

  it('re-enables the key if they start paying again', () => {
    const action = decide('subscription_updated', sub({ renewsAt: MAY }), key({ disabled: true }));
    expect(action).toEqual({ do: 'update', hash: 'h1', patch: { disabled: false } });
  });
});

describe('remaining credit', () => {
  it('is the cap less what was spent, and never negative', () => {
    expect(remainingOn(key())).toBe(REGULAR - 2.5);
    expect(remainingOn(key({ usage: REGULAR + 2 }))).toBe(0);
  });

  it('is nothing on an uncapped key, which is not one we issued', () => {
    expect(remainingOn(key({ limit: null }))).toBe(0);
  });
});

describe('the webhook signature', () => {
  const secret = 'signing-secret';
  const body = JSON.stringify({ meta: { event_name: 'subscription_created' } });
  const good = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the right signature', () => {
    expect(verifySignature(body, good, secret)).toBe(true);
  });

  it('rejects a wrong, missing or truncated one, and a tampered body', () => {
    const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    expect(verifySignature(body, flipped, secret)).toBe(false);
    expect(verifySignature(body, 'deadbeef', secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, good.slice(0, 20), secret)).toBe(false);
    expect(verifySignature(`${body} `, good, secret)).toBe(false);
    expect(verifySignature(body, good, 'another-secret')).toBe(false);
    expect(verifySignature(body, good, '')).toBe(false);
  });
});

describe('reading an event', () => {
  const variants = { LEMON_VARIANT_STARTER: '11', LEMON_VARIANT_REGULAR: '22' };

  it('maps a variant to a plan through configuration', () => {
    expect(planForVariant('22', variants)).toBe('regular');
    expect(planForVariant('99', variants)).toBeNull();
    expect(planForVariant('', variants)).toBeNull();
  });

  it('normalizes a subscription event', () => {
    const read = readEvent(
      {
        meta: { event_name: 'subscription_updated' },
        data: { id: '9', attributes: { order_id: 501, variant_id: 22, status: 'active', renews_at: JUNE } },
      },
      variants,
    );
    expect(read).toEqual({
      event: 'subscription_updated',
      sub: { orderId: '501', planId: 'regular', status: 'active', renewsAt: JUNE },
    });
  });

  it('takes the order id from the order itself on a refund', () => {
    const read = readEvent(
      { meta: { event_name: 'order_refunded' }, data: { id: '501', attributes: {} } },
      variants,
    );
    expect(read?.sub.orderId).toBe('501');
    expect(read?.sub.status).toBe('refunded');
  });

  it('ignores events it has no rule for', () => {
    expect(readEvent({ meta: { event_name: 'order_created' }, data: { id: '1' } }, variants)).toBeNull();
    expect(readEvent({}, variants)).toBeNull();
  });
});
