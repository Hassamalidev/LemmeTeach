/**
 * Provider normalization, both directions, for all five real adapters (§22).
 *
 * The adapters are where a provider difference silently becomes a broken
 * lesson, so these run against captured raw bodies rather than mocks of our
 * own shape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropic, ANTHROPIC_HEADER } from './anthropic';
import { openai } from './openai';
import { gemini } from './gemini';
import { isInsecureRemote } from './openrouter';
import {
  toAnthropicMessages,
  toGeminiContents,
  toOpenAiMessages,
  toOpenAiTools,
} from './normalize';
import { narrowSchemaForGemini } from './schema-narrow';
import { toJsonSchema } from '../tools/json-schema';
import { TeachStepInput } from '../tools/schemas';
import type { AgentEvent, AgentMessage, AgentRequest } from './types';
import {
  ANTHROPIC_STREAM,
  AUTH_ERROR_BODY,
  GEMINI_STREAM,
  OPENAI_STREAM,
  RATE_LIMIT_BODY,
} from './__fixtures__/raw';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function streamResponse(body: string, init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Deliberately split mid-event: a chunk boundary can land anywhere.
      const bytes = new TextEncoder().encode(body);
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

/** A fetch stub that records what it was called with, typed rather than cast. */
interface FetchStub {
  requests: { url: string; init: RequestInit }[];
}

function stubFetch(respond: () => Response): FetchStub {
  const stub: FetchStub = { requests: [] };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    stub.requests.push({ url, init });
    return respond();
  });
  return stub;
}

function initOf(stub: FetchStub, i = 0): RequestInit {
  const req = stub.requests[i];
  if (!req) throw new Error('fetch was not called');
  return req.init;
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const REQUEST: AgentRequest = {
  model: 'test-model',
  system: 'You are a tutor.',
  messages: [{ role: 'user', content: 'Teach me integration by parts.' }],
  tools: [{ name: 'teach_step', description: 'Write on the board.', parameters: { type: 'object' } }],
  maxTokens: 4096,
  temperature: 0.6,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * Messages, both directions
 * ------------------------------------------------------------------ */

const CONVERSATION: AgentMessage[] = [
  { role: 'user', content: 'Teach me the product rule.' },
  {
    role: 'assistant',
    content: 'Starting now.',
    toolCalls: [{ id: 'call_1', name: 'teach_step', input: { say: 'Here we go.', board: [] } }],
  },
  { role: 'tool', results: [{ id: 'call_1', name: 'teach_step', ok: true, content: '{"page":0}' }] },
];

describe('normalize → Anthropic', () => {
  it('puts tool results in a user message as content blocks', () => {
    const out = toAnthropicMessages(CONVERSATION);
    expect(out).toHaveLength(3);
    expect(out[2]?.role).toBe('user');
    const block = out[2]?.content[0] as { type: string; tool_use_id: string };
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('call_1');
  });

  it('sends tool calls as tool_use blocks with the input as an object', () => {
    const out = toAnthropicMessages(CONVERSATION);
    const blocks = out[1]?.content as { type: string; input?: unknown }[];
    const toolUse = blocks.find((b) => b.type === 'tool_use');
    expect(toolUse?.input).toEqual({ say: 'Here we go.', board: [] });
  });

  it('merges adjacent same-role messages, which Anthropic rejects', () => {
    const out = toAnthropicMessages([
      { role: 'tool', results: [{ id: 'a', name: 'compute', ok: true, content: '1' }] },
      { role: 'user', content: 'and another thing' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toHaveLength(2);
  });
});

describe('normalize → OpenAI', () => {
  it('puts the system prompt in a system message', () => {
    const out = toOpenAiMessages('be nice', CONVERSATION);
    expect(out[0]).toEqual({ role: 'system', content: 'be nice' });
  });

  it('serialises tool arguments as a string, not an object', () => {
    const out = toOpenAiMessages('s', CONVERSATION);
    const assistant = out.find((m) => m.role === 'assistant');
    expect(typeof assistant?.tool_calls?.[0]?.function.arguments).toBe('string');
    expect(JSON.parse(assistant?.tool_calls?.[0]?.function.arguments ?? '{}')).toEqual({
      say: 'Here we go.',
      board: [],
    });
  });

  it('emits one tool message per result, keyed by tool_call_id', () => {
    const out = toOpenAiMessages('s', CONVERSATION);
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('call_1');
  });

  it('wraps tools in the function envelope', () => {
    const out = toOpenAiTools([
      { name: 'compute', description: 'do maths', parameters: { type: 'object' } },
    ]) as { type: string; function: { name: string } }[];
    expect(out[0]?.type).toBe('function');
    expect(out[0]?.function.name).toBe('compute');
  });
});

describe('normalize → Gemini', () => {
  it('renames the assistant role to model', () => {
    const out = toGeminiContents(CONVERSATION);
    expect(out[1]?.role).toBe('model');
  });

  it('returns results as functionResponse parts, matched by name', () => {
    const out = toGeminiContents(CONVERSATION);
    const part = out[2]?.parts[0] as { functionResponse: { name: string; response: unknown } };
    expect(part.functionResponse.name).toBe('teach_step');
    expect(part.functionResponse.response).toEqual({ ok: true, result: '{"page":0}' });
  });

  it('sends the call arguments as an object under args', () => {
    const out = toGeminiContents(CONVERSATION);
    const part = out[1]?.parts[1] as { functionCall: { name: string; args: unknown } };
    expect(part.functionCall.name).toBe('teach_step');
    expect(part.functionCall.args).toEqual({ say: 'Here we go.', board: [] });
  });
});

/* ------------------------------------------------------------------ *
 * Schema narrowing
 * ------------------------------------------------------------------ */

describe('narrowSchemaForGemini', () => {
  const narrowed = narrowSchemaForGemini(toJsonSchema(TeachStepInput));

  it('keeps the top-level shape', () => {
    expect(narrowed.type).toBe('object');
    expect(narrowed.properties?.say?.type).toBe('string');
    expect(narrowed.required).toContain('say');
  });

  it('strips additionalProperties everywhere', () => {
    const json = JSON.stringify(narrowed);
    expect(json).not.toContain('additionalProperties');
  });

  it('strips anyOf and oneOf everywhere', () => {
    const json = JSON.stringify(narrowed);
    expect(json).not.toContain('anyOf');
    expect(json).not.toContain('oneOf');
  });

  it('collapses the board op union but keeps op as a full enum', () => {
    const items = narrowed.properties?.board?.items as { properties?: Record<string, { enum?: unknown[] }> };
    const opEnum = items?.properties?.op?.enum;
    expect(opEnum).toContain('heading');
    expect(opEnum).toContain('diagram');
    expect(opEnum).toContain('annotate');
    expect(opEnum).toHaveLength(13);
  });

  it('turns tuples into plain arrays and says the length in prose', () => {
    const plot = narrowSchemaForGemini({
      type: 'object',
      properties: {
        domain: { type: 'array', items: [{ type: 'number' }, { type: 'number' }] },
      },
    });
    const domain = plot.properties?.domain;
    expect(Array.isArray(domain?.items)).toBe(false);
    expect(domain?.description).toContain('Exactly 2');
  });
});

/* ------------------------------------------------------------------ *
 * Streaming, against captured bodies
 * ------------------------------------------------------------------ */

describe('anthropic adapter', () => {
  it('sends the browser-access header — without it every request fails CORS', async () => {
    const fetchMock = stubFetch(() => streamResponse(ANTHROPIC_STREAM));

    await collect(anthropic.run(REQUEST, { apiKey: 'sk-ant-test' }, new AbortController().signal));

    const headers = initOf(fetchMock).headers as Record<string, string>;
    expect(headers[ANTHROPIC_HEADER]).toBe('true');
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('marks the system prompt and tools for caching', async () => {
    const fetchMock = stubFetch(() => streamResponse(ANTHROPIC_STREAM));

    await collect(anthropic.run(REQUEST, { apiKey: 'k' }, new AbortController().signal));

    const body = JSON.parse(initOf(fetchMock).body as string);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('reassembles a tool call split across partial_json fragments', async () => {
    vi.stubGlobal('fetch', async () => streamResponse(ANTHROPIC_STREAM));
    const events = await collect(
      anthropic.run(REQUEST, { apiKey: 'k' }, new AbortController().signal),
    );

    const start = events.find((e) => e.t === 'tool_start');
    expect(start).toMatchObject({ id: 'toolu_01', name: 'teach_step' });

    const end = events.find((e) => e.t === 'tool_end');
    expect(end && 'input' in end && end.input).toEqual({ say: 'Watch this.', board: [] });

    expect(events.find((e) => e.t === 'stop')).toMatchObject({ reason: 'tool_use' });
    expect(events.find((e) => e.t === 'usage')).toMatchObject({
      inputTokens: 1204,
      outputTokens: 312,
    });
  });

  it('reports a bad key as an AuthError with a message for a human', async () => {
    vi.stubGlobal('fetch', async () => new Response(AUTH_ERROR_BODY, { status: 401 }));
    const events = await collect(
      anthropic.run(REQUEST, { apiKey: 'bad' }, new AbortController().signal),
    );
    const err = events.find((e) => e.t === 'error');
    expect(err && 'error' in err && err.error.kind).toBe('AuthError');
    expect(err && 'error' in err && err.error.message).toContain('Settings');
  });

  it('reports a 429 as retryable', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(RATE_LIMIT_BODY, { status: 429, headers: { 'retry-after': '4' } }),
    );
    const events = await collect(anthropic.run(REQUEST, { apiKey: 'k' }, new AbortController().signal));
    const err = events.find((e) => e.t === 'error');
    expect(err && 'error' in err && err.error.kind).toBe('RateLimitError');
    expect(err && 'error' in err && err.error.retryable).toBe(true);
    expect(err && 'error' in err && err.error.retryAfter).toBe(4);
  });
});

describe('openai adapter', () => {
  it('concatenates streamed argument fragments into one object', async () => {
    vi.stubGlobal('fetch', async () => streamResponse(OPENAI_STREAM));
    const events = await collect(openai.run(REQUEST, { apiKey: 'k' }, new AbortController().signal));

    expect(events.find((e) => e.t === 'tool_start')).toMatchObject({
      id: 'call_abc',
      name: 'teach_step',
    });
    const end = events.find((e) => e.t === 'tool_end');
    expect(end && 'input' in end && end.input).toEqual({ say: 'Watch this.', board: [] });
    expect(events.find((e) => e.t === 'stop')).toMatchObject({ reason: 'tool_use' });
  });

  it('collects text deltas and usage', async () => {
    vi.stubGlobal('fetch', async () => streamResponse(OPENAI_STREAM));
    const events = await collect(openai.run(REQUEST, { apiKey: 'k' }, new AbortController().signal));
    const text = events
      .filter((e): e is Extract<AgentEvent, { t: 'text' }> => e.t === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Right, here we go.');
    expect(events.find((e) => e.t === 'usage')).toMatchObject({
      inputTokens: 1180,
      outputTokens: 290,
    });
  });
});

describe('gemini adapter', () => {
  it('synthesizes an id for a call that arrives without one', async () => {
    vi.stubGlobal('fetch', async () => streamResponse(GEMINI_STREAM));
    const events = await collect(gemini.run(REQUEST, { apiKey: 'k' }, new AbortController().signal));

    const start = events.find((e) => e.t === 'tool_start');
    expect(start && 'id' in start && start.id).toMatch(/^teach_step#\d+#0$/);

    const end = events.find((e) => e.t === 'tool_end');
    expect(end && 'input' in end && end.input).toEqual({ say: 'Watch this.', board: [] });
  });

  it('puts the system prompt in systemInstruction, not in the messages', async () => {
    const fetchMock = stubFetch(() => streamResponse(GEMINI_STREAM));
    await collect(gemini.run(REQUEST, { apiKey: 'k' }, new AbortController().signal));

    const body = JSON.parse(initOf(fetchMock).body as string);
    expect(body.systemInstruction.parts[0].text).toBe('You are a tutor.');
    expect(JSON.stringify(body.contents)).not.toContain('You are a tutor.');
  });

  it('keeps the key in the query string out of the request body', async () => {
    const fetchMock = stubFetch(() => streamResponse(GEMINI_STREAM));
    await collect(gemini.run(REQUEST, { apiKey: 'AIzaSECRET' }, new AbortController().signal));
    const body = initOf(fetchMock).body as string;
    expect(body).not.toContain('AIzaSECRET');
  });
});

describe('compatible endpoint warnings', () => {
  it('flags a plaintext remote host but not localhost', () => {
    expect(isInsecureRemote('http://192.168.1.50:8000/v1')).toBe(true);
    expect(isInsecureRemote('http://localhost:11434/v1')).toBe(false);
    expect(isInsecureRemote('http://127.0.0.1:1234/v1')).toBe(false);
    expect(isInsecureRemote('https://api.groq.com/openai/v1')).toBe(false);
  });
});
