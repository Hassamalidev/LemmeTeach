/**
 * Every error class in §17.1 has a test and a user-visible message written for
 * a human (§25).
 *
 * The assertions on wording are not pedantry. "An error occurred" in front of
 * a learner who has just paid for a lesson is a failure of the product, not a
 * cosmetic issue, and the only way that stays true is if it is checked.
 */
import { describe, expect, it } from 'vitest';
import {
  asChalkError,
  authError,
  backoffDelay,
  budgetError,
  ChalkError,
  contextError,
  errorFromFetchFailure,
  errorFromResponse,
  loopError,
  refusalError,
  sandboxError,
  schemaError,
  toolError,
  truncate,
} from './errors';

/** Every message a learner might see has to read like a sentence to a person. */
function readsLikeEnglish(message: string): void {
  expect(message.length, message).toBeGreaterThan(15);
  expect(message[0], message).toBe(message[0]?.toUpperCase());
  expect(message, message).toMatch(/[.!?]$/);
  expect(message, message).not.toMatch(/undefined|null|\[object|Error:|stack/i);
}

describe('the taxonomy', () => {
  const cases: [string, ChalkError][] = [
    ['AuthError', errorFromResponse('Anthropic', 401, '{}')],
    ['RateLimitError', errorFromResponse('OpenAI', 429, '{}')],
    ['OverloadedError', errorFromResponse('Anthropic', 529, '{}')],
    ['NetworkError', errorFromFetchFailure('Gemini', new TypeError('Failed to fetch'))],
    ['ContextError', contextError('The conversation outgrew the model context window.')],
    ['SchemaError', schemaError('That tool call did not match its schema.')],
    ['ToolError', toolError('The tool could not finish.')],
    ['SandboxError', sandboxError('Python could not be loaded in this browser.')],
    ['RefusalError', refusalError('The model declined to answer that.')],
    ['BudgetError', budgetError('This lesson has used its whole token budget.')],
    ['LoopError', loopError('The lesson stopped making progress.')],
  ];

  for (const [kind, error] of cases) {
    it(`${kind} carries a message written for a person`, () => {
      expect(error.kind).toBe(kind);
      readsLikeEnglish(error.message);
    });
  }

  it('marks only the transport failures as retryable', () => {
    expect(errorFromResponse('OpenAI', 429, '{}').retryable).toBe(true);
    expect(errorFromResponse('OpenAI', 529, '{}').retryable).toBe(true);
    expect(errorFromResponse('OpenAI', 503, '{}').retryable).toBe(true);

    // Retrying a bad key just spends three requests failing the same way.
    expect(errorFromResponse('OpenAI', 401, '{}').retryable).toBe(false);
    expect(errorFromResponse('OpenAI', 403, '{}').retryable).toBe(false);
    expect(refusalError('x').retryable).toBe(false);
    expect(budgetError('x').retryable).toBe(false);
  });
});

describe('mapping an HTTP failure', () => {
  it('names the provider, so it is clear which one refused', () => {
    expect(errorFromResponse('OpenRouter', 401, '{}').message).toContain('OpenRouter');
    expect(errorFromResponse('Gemini', 529, '{}').message).toContain('Gemini');
  });

  it('honours retry-after', () => {
    const headers = new Headers({ 'retry-after': '7' });
    expect(errorFromResponse('OpenAI', 429, '{}', headers).retryAfter).toBe(7);
  });

  it('reads a context-window rejection as a ContextError, not a bad request', () => {
    const err = errorFromResponse(
      'OpenAI',
      400,
      'This model’s maximum context length is 128000 tokens',
    );
    expect(err.kind).toBe('ContextError');
  });

  it('treats an unknown model as something to fix in Settings', () => {
    const err = errorFromResponse('Anthropic', 404, '{}');
    expect(err.kind).toBe('AuthError');
    expect(err.message).toContain('Settings');
  });
});

describe('telling offline apart from blocked', () => {
  it('says "offline" only when the browser says so', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'onLine');

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(errorFromFetchFailure('Anthropic', new TypeError('x')).message).toMatch(/offline/i);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const blocked = errorFromFetchFailure('Anthropic', new TypeError('x'));
    expect(blocked.message).not.toMatch(/offline/i);
    // A CORS failure on Anthropic almost always means a missing header, so the
    // message must not send someone hunting through their router settings.
    expect(blocked.message).toMatch(/browser blocking|network problem/i);

    if (original) Object.defineProperty(navigator, 'onLine', original);
  });
});

describe('abort', () => {
  it('is recognised however it arrives', () => {
    const dom = asChalkError(new DOMException('Aborted', 'AbortError'));
    expect(dom.kind).toBe('AbortError');
    expect(asChalkError(authError('x')).kind).toBe('AuthError');
  });

  it('is never presented as a failure', () => {
    expect(asChalkError(new DOMException('Aborted', 'AbortError')).message).toBe(
      'The lesson was stopped.',
    );
  });
});

describe('backoff', () => {
  it('grows, and honours the provider first', () => {
    expect(backoffDelay(0, 4)).toBe(4000);
    expect(backoffDelay(0)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelay(2)).toBeGreaterThan(backoffDelay(0));
  });

  it('is capped, so a lesson never sits waiting for a minute', () => {
    expect(backoffDelay(20)).toBeLessThanOrEqual(17_000);
    expect(backoffDelay(0, 9999)).toBeLessThanOrEqual(30_000);
  });

  it('is jittered, so retries do not arrive in lockstep', () => {
    const samples = new Set(Array.from({ length: 20 }, () => backoffDelay(1)));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('truncate', () => {
  it('says how much was dropped rather than trailing off', () => {
    const out = truncate('x'.repeat(500), 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('400 more characters');
  });

  it('leaves short text untouched', () => {
    expect(truncate('short', 100)).toBe('short');
  });
});
