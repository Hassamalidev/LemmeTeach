/**
 * Bring your own key (§5.8).
 *
 * The learner gives one thing, a key. Everything else — whose it is, whether
 * it works, which model to use — has to be worked out without asking them and
 * without the key going anywhere but its own service.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseModels,
  connectOwnKey,
  detectProvider,
  detectService,
  OWN_KEY_ORIGINS,
  OWN_KEY_SERVICES,
} from './own-key';
import { bridgeUserAfterTool } from './openai';
import { compatible } from './openrouter';
import { splitDataUrl, toAnthropicMessages, toGeminiContents } from './normalize';
import type { Attachment } from './types';

// Made-up keys with the right shapes. The ones a secret scanner would take for
// real are assembled here rather than written out.
const HEX = '0123456789abcdef';
const KEYS: Record<string, string> = {
  openrouter: 'sk-or-v1-0123456789abcdef0123456789abcdef',
  anthropic: 'sk-ant-api03-0123456789abcdef0123456789abcdef',
  openai: 'sk-proj-0123456789abcdef0123456789abcdef',
  gemini: 'AIzaSyD-0123456789abcdefghijklmnopqrstuv',
  mistral: 'Xy7Q'.repeat(8),
  cohere: 'Xy7Q'.repeat(10),
  groq: 'gsk_0123456789abcdef0123456789abcdef',
  xai: 'xai-0123456789abcdef0123456789abcdef',
  deepseek: `sk-${HEX}${HEX}`,
  together: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  fireworks: 'fw_0123456789abcdef0123456789',
  cerebras: 'csk-0123456789abcdef0123456789',
};

const HOSTS: Record<string, string> = {
  openrouter: 'openrouter.ai',
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  gemini: 'generativelanguage.googleapis.com',
  mistral: 'api.mistral.ai',
  cohere: 'api.cohere.ai',
  groq: 'api.groq.com',
  xai: 'api.x.ai',
  deepseek: 'api.deepseek.com',
  together: 'api.together.xyz',
  fireworks: 'api.fireworks.ai',
  cerebras: 'api.cerebras.ai',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Stub fetch and record where each request went and what it carried. */
function stubFetch(status: number, body: string | object): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ''),
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': typeof body === 'string' ? 'text/event-stream' : 'application/json' },
    });
  });
  return calls;
}

describe('recognising a key', () => {
  it('tells every service with a key shape of its own apart', () => {
    for (const [service, key] of Object.entries(KEYS)) {
      expect(detectService(key), key).toBe(service);
    }
  });

  it('runs the four with their own adapter on it, and the rest on the compatible one', () => {
    expect(detectProvider(KEYS.anthropic ?? '')).toBe('anthropic');
    expect(detectProvider(KEYS.openai ?? '')).toBe('openai');
    expect(detectProvider(KEYS.gemini ?? '')).toBe('gemini');
    expect(detectProvider(KEYS.openrouter ?? '')).toBe('openrouter');
    expect(detectProvider(KEYS.mistral ?? '')).toBe('compatible');
    expect(detectProvider(KEYS.groq ?? '')).toBe('compatible');
  });

  it('ignores surrounding whitespace from a careless paste', () => {
    expect(detectService(`  ${KEYS.mistral}\n`)).toBe('mistral');
  });

  it('does not guess at something that is not a key', () => {
    expect(detectService('')).toBeNull();
    expect(detectService('my password')).toBeNull();
    expect(detectService('sk-short')).toBeNull();
    expect(detectService('38B1460A-5104-4067-A91D-77B872934D51')).toBeNull();
  });

  it('offers every service by name, in alphabetical order', () => {
    const labels = OWN_KEY_SERVICES.map((s) => s.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(labels).toEqual(expect.arrayContaining(['Mistral', 'Groq', 'DeepSeek', 'Anthropic']));
    expect(new Set(OWN_KEY_SERVICES.map((s) => s.id)).size).toBe(OWN_KEY_SERVICES.length);
  });
});

describe('connecting a key', () => {
  it('checks it with its own service and nobody else', async () => {
    for (const [service, key] of Object.entries(KEYS)) {
      const calls = stubFetch(200, { data: [], models: [] });
      const result = await connectOwnKey(key);
      expect(result.ok, service).toBe(true);
      expect(calls, service).toHaveLength(1);
      expect(new URL(calls[0]?.url ?? '').host, service).toBe(HOSTS[service]);
      // The key travels in a header. It is never put in a URL.
      expect(calls[0]?.url).not.toContain(key);
      expect(JSON.stringify(calls[0]?.headers)).toContain(key);
    }
  });

  it('goes where the learner said when they named the service', async () => {
    const calls = stubFetch(200, { data: [{ id: 'qwen-plus' }] });
    const result = await connectOwnKey(KEYS.mistral ?? '', 'dashscope');
    expect(result.ok).toBe(true);
    expect(new URL(calls[0]?.url ?? '').host).toBe('dashscope-intl.aliyuncs.com');
    if (result.ok) {
      expect(result.ownKey.label).toBe('Alibaba (Qwen)');
      expect(result.ownKey.models.tutor).toBe('qwen-plus');
    }
  });

  it('carries what the compatible adapter needs to reach the service', async () => {
    stubFetch(200, { data: [{ id: 'mistral-small-latest' }] });
    const result = await connectOwnKey(KEYS.mistral ?? '');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownKey.providerId).toBe('compatible');
    expect(result.ownKey.serviceId).toBe('mistral');
    expect(result.ownKey.baseUrl).toBe('https://api.mistral.ai/v1');
    expect(result.ownKey.quirks?.bridgeUserAfterTool).toBe(true);
    expect(result.ownKey.models.tutor).toBe('mistral-small-latest');
  });

  it('asks the learner to choose when the shape is not recognised, without trying anyone', async () => {
    const calls = stubFetch(200, {});
    const result = await connectOwnKey('abc-0123456789-xyz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.choose).toBe(true);
      expect(result.message).toMatch(/choose it from the list/i);
    }
    expect(calls).toHaveLength(0);
  });

  it('says so plainly when the service refuses a key it was told about', async () => {
    stubFetch(401, { message: `invalid key ${KEYS.mistral}` });
    const result = await connectOwnKey(KEYS.mistral ?? '', 'mistral');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('Mistral did not accept that key. Check it and paste it again.');
    expect(result.message).not.toContain(KEYS.mistral);
  });

  it('suggests another service when a guessed one refuses the key', async () => {
    stubFetch(401, {});
    // Looks like a DeepSeek key; could be Alibaba's.
    const result = await connectOwnKey(KEYS.deepseek ?? '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.choose).toBe(true);
      expect(result.message).toMatch(/looked like a DeepSeek key/);
      expect(result.message).toMatch(/different service/);
    }
  });

  it('tells a network failure apart from a bad key', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await connectOwnKey(KEYS.openai ?? '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Could not reach/);
  });

  it('chooses the model for them, from what the key can actually use', async () => {
    stubFetch(200, { data: [{ id: 'gpt-4o-mini' }, { id: 'whisper-1' }] });
    const result = await connectOwnKey(KEYS.openai ?? '');
    expect(result.ok && result.ownKey.models.tutor).toBe('gpt-4o-mini');
    expect(result.ok && result.ownKey.label).toBe('OpenAI');
  });
});

describe('choosing models', () => {
  it('takes the first preferred model the service lists', () => {
    expect(chooseModels('gemini', ['gemini-2.0-flash', 'gemini-2.5-flash']).tutor).toBe('gemini-2.5-flash');
    expect(chooseModels('mistral', ['mistral-large-latest', 'mistral-small-latest']).tutor).toBe(
      'mistral-small-latest',
    );
  });

  it('settles for a small chat model from the list when none of the preferred ones is there', () => {
    expect(chooseModels('mistral', ['mistral-embed', 'ministral-3b-2512', 'pixtral-ocr']).tutor).toBe(
      'ministral-3b-2512',
    );
    expect(chooseModels('groq', ['whisper-large-v3', 'llama-guard-4', 'something-70b']).tutor).toBe(
      'something-70b',
    );
  });

  it('falls back to a known model when the list is no help', () => {
    expect(chooseModels('anthropic', []).tutor).toBe('claude-haiku-4-5');
    expect(chooseModels('openai', ['something-new']).tutor).toBe('gpt-4.1-mini');
    expect(chooseModels('mistral', []).tutor).toBe('mistral-small-latest');
  });

  it('uses the same model for reading, solving and repairing', () => {
    const models = chooseModels('anthropic', []);
    expect(new Set(Object.values(models)).size).toBe(1);
  });
});

describe('a service that differs from OpenAI', () => {
  it('slips an assistant turn between a tool result and a user message', () => {
    const out = bridgeUserAfterTool([
      { role: 'system', content: 's' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'tool', tool_call_id: 'abc123xyz', content: 'ok' },
      { role: 'user', content: 'The learner raised their hand.' },
    ]);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    // Nothing else is touched.
    expect(bridgeUserAfterTool([{ role: 'user', content: 'q' }])).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('sends only what the service accepts', async () => {
    const calls = stubFetch(200, 'data: [DONE]\n\n');
    const events = compatible.run(
      {
        model: 'mistral-small-latest',
        system: 'sys',
        messages: [{ role: 'user', content: 'Solve this.' }],
        tools: [{ name: 'teach_step', description: 'd', parameters: { type: 'object' } }],
        maxTokens: 1000,
        temperature: 0.5,
        toolChoice: 'required',
      },
      {
        apiKey: KEYS.mistral ?? '',
        baseUrl: 'https://api.mistral.ai/v1',
        quirks: { omitStreamOptions: true, requiredToolChoice: 'any', bridgeUserAfterTool: true },
      },
      new AbortController().signal,
    );
    for await (const _ of events) {
      /* drain */
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body.stream_options).toBeUndefined();
    expect(body.tool_choice).toBe('any');
    expect(body.model).toBe('mistral-small-latest');
  });

  it('is left alone when there are no quirks', async () => {
    const calls = stubFetch(200, 'data: [DONE]\n\n');
    const events = compatible.run(
      {
        model: 'llama-3.3-70b-versatile',
        system: 'sys',
        messages: [{ role: 'user', content: 'Solve this.' }],
        tools: [{ name: 'teach_step', description: 'd', parameters: { type: 'object' } }],
        maxTokens: 1000,
        temperature: 0.5,
        toolChoice: 'required',
      },
      { apiKey: KEYS.groq ?? '', baseUrl: 'https://api.groq.com/openai/v1' },
      new AbortController().signal,
    );
    for await (const _ of events) {
      /* drain */
    }
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.tool_choice).toBe('required');
  });
});

describe('the content security policy', () => {
  it('allows every service a key can be sent to, and the two lists cannot drift', () => {
    const csp = readFileSync('public/csp.js', 'utf8');
    const listed = [...csp.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
    for (const origin of OWN_KEY_ORIGINS) {
      expect(listed, origin).toContain(origin);
    }
  });
});

describe('an attachment on the other providers’ wires', () => {
  const picture: Attachment = { kind: 'image', name: 'q.png', dataUrl: 'data:image/png;base64,AAAA' };
  const sheet: Attachment = { kind: 'file', name: 's.pdf', dataUrl: 'data:application/pdf;base64,BBBB' };
  const message = [{ role: 'user' as const, content: 'Solve question 4.', attachments: [picture, sheet] }];

  it('splits a data URL into its type and its payload', () => {
    expect(splitDataUrl(picture.dataUrl)).toEqual({ mime: 'image/png', data: 'AAAA' });
    expect(splitDataUrl('nonsense').data).toBe('');
  });

  it('goes to Anthropic as image and document blocks, before the text', () => {
    expect(toAnthropicMessages(message)[0]?.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' } },
      { type: 'text', text: 'Solve question 4.' },
    ]);
  });

  it('goes to Gemini as inline data parts', () => {
    expect(toGeminiContents(message)[0]?.parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
      { text: 'Solve question 4.' },
    ]);
  });

  it('leaves a message with nothing attached as plain text', () => {
    const plain = [{ role: 'user' as const, content: 'Solve this.' }];
    expect(toAnthropicMessages(plain)[0]?.content).toEqual([{ type: 'text', text: 'Solve this.' }]);
    expect(toGeminiContents(plain)[0]?.parts).toEqual([{ text: 'Solve this.' }]);
  });
});
