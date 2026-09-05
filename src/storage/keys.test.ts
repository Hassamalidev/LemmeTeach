/**
 * The key never leaks (§5.7, §19, §25).
 *
 * "The key appears in no trace export, no saved lesson, no log line, and no
 * URL — asserted by test." This is that test. It is deliberately paranoid:
 * the failure it guards against is silent, irreversible, and someone else's
 * money.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetAllKeys, getKey, loadSettings, saveSettings, scrubKeys, setKey } from './settings';
import { Trace } from '../runtime/trace';
import { errorFromResponse, errorFromFetchFailure } from '../runtime/errors';
import { toAnthropicMessages, toOpenAiMessages, toGeminiContents } from '../providers/normalize';

const SECRET = 'sk-ant-api03-THISISTHESECRETKEYVALUE-0123456789';

beforeEach(() => {
  localStorage.clear();
  forgetAllKeys();
  setKey('anthropic', SECRET, true);
});

afterEach(() => {
  forgetAllKeys();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('storage', () => {
  it('keeps the key out of the settings blob', () => {
    saveSettings({ ...loadSettings(), provider: 'anthropic' });
    const raw = localStorage.getItem('chalk.settings') ?? '';
    expect(raw).not.toContain(SECRET);
  });

  it('stores it under its own key, and forgets it on request', () => {
    expect(getKey('anthropic')).toBe(SECRET);
    forgetAllKeys();
    expect(getKey('anthropic')).toBe('');
    expect(JSON.stringify(localStorage)).not.toContain(SECRET);
  });

  it('never remembers a memory-only key on disk', () => {
    forgetAllKeys();
    setKey('openai', 'sk-memory-only-secret-value-here', false);
    expect(getKey('openai')).toBe('sk-memory-only-secret-value-here');
    expect(JSON.stringify(localStorage)).not.toContain('sk-memory-only-secret-value-here');
  });
});

describe('the trace export', () => {
  it('contains no key, even when one was somehow written into it', () => {
    const trace = new Trace();
    // Simulate the worst case: something careless put the key in a payload.
    trace.push({ t: 'tool_call', name: 'compute', callId: 'c1', input: { key: SECRET } });
    trace.push({ t: 'note', message: `authorization: Bearer ${SECRET}` });
    trace.push({
      t: 'error',
      error: {
        kind: 'AuthError',
        message: 'rejected',
        detail: `x-api-key: ${SECRET}`,
        retryable: false,
      },
    });

    const exported = trace.toExport({ provider: 'anthropic' });
    expect(exported).not.toContain(SECRET);
    expect(exported).toContain('[key removed]');
  });
});

describe('error messages', () => {
  it('do not echo a key back from a provider response body', () => {
    const err = errorFromResponse(
      'Anthropic',
      401,
      JSON.stringify({ error: { message: `invalid key ${SECRET}` } }),
    );
    const serialized = scrubKeys(JSON.stringify(err.toJSON()));
    expect(serialized).not.toContain(SECRET);
  });

  it('say what to do, in language written for a person', () => {
    const auth = errorFromResponse('Anthropic', 401, '{}');
    expect(auth.message).toBe('Anthropic rejected that key. Check it in Settings.');
    expect(auth.retryable).toBe(false);

    const offline = errorFromFetchFailure('OpenAI', new TypeError('Failed to fetch'));
    expect(offline.message).toMatch(/could not reach|offline/i);
  });
});

describe('scrubKeys', () => {
  it('removes the configured key wherever it appears', () => {
    expect(scrubKeys(`prefix ${SECRET} suffix`)).toBe('prefix [key removed] suffix');
  });

  it('removes keys shaped like the providers issue, even unconfigured ones', () => {
    expect(scrubKeys('sk-proj-abcdefghijklmnopqrstuvwx')).toContain('[key removed]');
    expect(scrubKeys('AIzaSyD-1234567890abcdefghijklmnopqrstuv')).toContain('[key removed]');
    expect(scrubKeys('or-v1-0123456789abcdef0123')).toContain('[key removed]');
  });

  it('leaves ordinary lesson text alone', () => {
    const text = 'The derivative of x squared is 2x, and sin(x) is periodic.';
    expect(scrubKeys(text)).toBe(text);
  });
});

describe('the message conversions', () => {
  const messages = [
    { role: 'user' as const, content: 'Teach me integration by parts.' },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'c1', name: 'teach_step', input: { say: 'Here we go.', board: [] } }],
    },
  ];

  it('put no key into any provider payload — the key travels in headers only', () => {
    const payloads = [
      JSON.stringify(toAnthropicMessages(messages)),
      JSON.stringify(toOpenAiMessages('system prompt', messages)),
      JSON.stringify(toGeminiContents(messages)),
    ];
    for (const payload of payloads) {
      expect(payload).not.toContain(SECRET);
      expect(payload).not.toContain('sk-');
    }
  });
});

describe('the URL', () => {
  it('never carries the key', () => {
    expect(window.location.href).not.toContain(SECRET);
    expect(window.location.search).toBe('');
  });
});
