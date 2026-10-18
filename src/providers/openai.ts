/**
 * OpenAI-shaped adapters (§5.2, §5.4, §5.5).
 *
 * OpenAI, OpenRouter, and every compatible endpoint — Groq, Together,
 * DeepSeek, vLLM, Ollama, LM Studio — speak the same wire format, so one
 * implementation serves all three with a different base URL and headers.
 *
 * The fiddly part is the streamed tool call: `index` identifies the call, `id`
 * and `function.name` arrive only on the first fragment, and
 * `function.arguments` streams as a string that has to be concatenated before
 * it can be parsed.
 */
import type {
  AdapterConfig,
  AgentEvent,
  ModelInfo,
  ProviderAdapter,
  StopReason,
} from './types';
import { toOpenAiMessages, toOpenAiTools, type OpenAiMessage } from './normalize';
import { readSse, parseData } from './sse';
import { errorFromFetchFailure, errorFromResponse } from '../runtime/errors';

interface ChunkDelta {
  content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface Chunk {
  choices?: { delta?: ChunkDelta; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    /** OpenRouter reports what the turn cost, in USD. */
    cost?: number;
  };
  error?: { message?: string };
}

export interface OpenAiLikeOptions {
  id: ProviderAdapter['id'];
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
  keyHelpUrl: string;
  keyHint: string;
  keyNote?: string;
  needsBaseUrl?: boolean;
  modelNote?: (count: number) => string | null;
  keyOptional?: boolean;
  extraHeaders?: Record<string, string>;
  /** Gateway-specific request fields: caching, fallbacks, usage accounting. */
  extraBody?: (model: string) => Record<string, unknown>;
  models: (cfg: AdapterConfig) => Promise<ModelInfo[]>;
}

export function createOpenAiLike(opts: OpenAiLikeOptions): ProviderAdapter {
  return {
    id: opts.id,
    label: opts.label,
    defaultModel: opts.defaultModel,
    keyPlaceholder: opts.keyPlaceholder,
    keyHelpUrl: opts.keyHelpUrl,
    keyHint: opts.keyHint,
    keyNote: opts.keyNote,
    needsBaseUrl: opts.needsBaseUrl,
    modelNote: opts.modelNote,
    keyOptional: opts.keyOptional,
    supportsToolChoice: true,
    supportsParallelToolCalls: true,
    models: opts.models,

    async *run(req, cfg, signal): AsyncIterable<AgentEvent> {
      const base = (cfg.baseUrl || opts.baseUrl).replace(/\/+$/, '');
      const url = `${base}/chat/completions`;

      const quirks = cfg.quirks ?? {};
      const label = cfg.label ?? opts.label;
      const messages = toOpenAiMessages(req.system, req.messages);
      const body: Record<string, unknown> = {
        model: req.model,
        messages: quirks.bridgeUserAfterTool ? bridgeUserAfterTool(messages) : messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        stream: true,
        ...(quirks.omitStreamOptions ? {} : { stream_options: { include_usage: true } }),
        ...opts.extraBody?.(req.model),
      };
      if (req.tools.length) {
        body.tools = toOpenAiTools(req.tools);
        body.tool_choice =
          req.toolChoice === 'required' ? (quirks.requiredToolChoice ?? 'required') : 'auto';
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...opts.extraHeaders,
      };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
      } catch (err) {
        yield { t: 'error', error: errorFromFetchFailure(label, err) };
        return;
      }

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        yield { t: 'error', error: errorFromResponse(label, res.status, text, res.headers) };
        return;
      }

      const calls = new Map<number, { id: string; name: string; json: string }>();
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens: number | undefined;
      let costUsd: number | undefined;
      let finish: string | null = null;

      for await (const sse of readSse(res.body, signal)) {
        const chunk = parseData<Chunk>(sse.data);
        if (!chunk) continue;

        if (chunk.error) {
          const message = chunk.error.message ?? '';
          const status = /tool_use_failed|tool call validation failed|failed to call a function/i.test(message) ? 400 : 500;
          yield { t: 'error', error: errorFromResponse(label, status, message) };
          return;
        }

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
          cachedInputTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? cachedInputTokens;
          if (typeof chunk.usage.cost === 'number') costUsd = chunk.usage.cost;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) yield { t: 'text', delta: delta.content };

        for (const tc of delta?.tool_calls ?? []) {
          // `index` identifies the call on OpenAI. Some compatible services
          // leave it out and send each call whole, so fall back to the id,
          // and failing that to the call already in progress.
          const slot = slotFor(calls, tc);
          const existing = calls.get(slot);
          if (!existing) {
            const id = tc.id ?? `call_${slot}`;
            const name = tc.function?.name ?? '';
            calls.set(slot, { id, name, json: tc.function?.arguments ?? '' });
            if (name) yield { t: 'tool_start', id, name };
            if (tc.function?.arguments) {
              yield { t: 'tool_delta', id, json: tc.function.arguments };
            }
            continue;
          }

          // Some endpoints send the name on a later fragment than the id.
          if (!existing.name && tc.function?.name) {
            existing.name = tc.function.name;
            yield { t: 'tool_start', id: existing.id, name: existing.name };
          }
          const args = tc.function?.arguments;
          if (args) {
            existing.json += args;
            yield { t: 'tool_delta', id: existing.id, json: args };
          }
        }
      }

      for (const call of calls.values()) {
        if (!call.name) continue;
        try {
          yield { t: 'tool_end', id: call.id, input: JSON.parse(call.json || '{}') };
        } catch {
          // Unresolved: the loop reads this as a truncation, which it is.
        }
      }

      yield { t: 'usage', inputTokens, outputTokens, cachedInputTokens, costUsd };
      yield { t: 'stop', reason: mapFinish(finish) };
    },
  };
}

/**
 * Some services refuse a user message that comes straight after a tool
 * result. The runtime puts one there whenever it has something to tell the
 * solver — a raised hand, a wrap-up warning — so for those services a short
 * assistant turn is slipped in between. It says nothing the model would not
 * have said, and it keeps the conversation legal.
 */
export function bridgeUserAfterTool(messages: OpenAiMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user' && out[out.length - 1]?.role === 'tool') {
      out.push({ role: 'assistant', content: 'Understood.' });
    }
    out.push(m);
  }
  return out;
}

/** Which accumulating call a streamed fragment belongs to. */
function slotFor(
  calls: Map<number, { id: string; name: string; json: string }>,
  tc: { index?: number; id?: string },
): number {
  if (typeof tc.index === 'number') return tc.index;
  if (tc.id) {
    for (const [slot, call] of calls) if (call.id === tc.id) return slot;
    return calls.size;
  }
  return Math.max(0, calls.size - 1);
}

function mapFinish(reason: string | null): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

/* ------------------------------------------------------------------ *
 * OpenAI proper
 * ------------------------------------------------------------------ */

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4.1', label: 'GPT-4.1', contextWindow: 1_000_000, tools: true },
  { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128_000, tools: true },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini — cheap and quick', contextWindow: 1_000_000, tools: true },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128_000, tools: true },
];

export const openai = createOpenAiLike({
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4.1',
  keyPlaceholder: 'sk-…',
  keyHelpUrl: 'https://platform.openai.com/api-keys',
  keyHint: 'Create a key on the OpenAI platform, under API keys.',
  models: async () => OPENAI_MODELS,
});
