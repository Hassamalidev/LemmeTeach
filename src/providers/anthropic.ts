/**
 * Anthropic adapter (§5.1).
 *
 * The browser-access header is not optional: without it the request fails
 * CORS. "Dangerous" there refers to shipping *your own* key in client code —
 * here the key belongs to the user and never leaves their browser, which is
 * precisely the case the header exists for. There is a test asserting the
 * header is sent, because its absence looks like a network error and would
 * send someone debugging in entirely the wrong place.
 *
 * The system prompt and tool definitions are marked for caching: they are
 * byte-identical on every turn of a lesson, and that is where most of the
 * token spend would otherwise go.
 */
import type {
  AdapterConfig,
  AgentEvent,
  AgentRequest,
  ModelInfo,
  ProviderAdapter,
  StopReason,
} from './types';
import { toAnthropicMessages, toAnthropicTools } from './normalize';
import { readSse, parseData } from './sse';
import { errorFromFetchFailure, errorFromResponse } from '../runtime/errors';

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export const ANTHROPIC_HEADER = 'anthropic-dangerous-direct-browser-access';

const MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — the default', contextWindow: 200_000, tools: true },
  { id: 'claude-opus-5', label: 'Claude Opus 5 — for hard derivations', contextWindow: 200_000, tools: true },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 — cheap and quick',
    contextWindow: 200_000,
    tools: true,
  },
];

interface StreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string; text?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: { usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

export const anthropic: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-sonnet-5',
  keyPlaceholder: 'sk-ant-…',
  keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  keyHint: 'Create a key in the Anthropic Console, under Settings then API keys.',
  keyNote:
    'Anthropic requires a header named anthropic-dangerous-direct-browser-access for requests made from a browser. The word “dangerous” refers to a site shipping its own key in client code, where every visitor would be spending the owner’s money. Here the key is yours and stays on your machine, which is the case that header exists for.',
  supportsToolChoice: true,
  supportsParallelToolCalls: true,

  async models(): Promise<ModelInfo[]> {
    return MODELS;
  },

  async *run(req: AgentRequest, cfg: AdapterConfig, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
      system: [
        {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: withCacheBreakpoint(toAnthropicTools(req.tools)),
      tool_choice: toolChoice(req),
      messages: toAnthropicMessages(req.messages),
    };

    let res: Response;
    try {
      res = await fetch(API, {
        method: 'POST',
        signal,
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': VERSION,
          [ANTHROPIC_HEADER]: 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { t: 'error', error: errorFromFetchFailure('Anthropic', err) };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield { t: 'error', error: errorFromResponse('Anthropic', res.status, text, res.headers) };
      return;
    }

    // Accumulate partial_json per block index and parse at content_block_stop.
    const blocks = new Map<number, { id: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'end_turn';

    for await (const sse of readSse(res.body, signal)) {
      const e = parseData<StreamEvent>(sse.data);
      if (!e) continue;

      switch (e.type) {
        case 'message_start':
          inputTokens = e.message?.usage?.input_tokens ?? 0;
          break;

        case 'content_block_start': {
          const block = e.content_block;
          if (block?.type === 'tool_use' && block.id && block.name && e.index !== undefined) {
            blocks.set(e.index, { id: block.id, json: '' });
            yield { t: 'tool_start', id: block.id, name: block.name };
          }
          break;
        }

        case 'content_block_delta': {
          if (e.delta?.type === 'text_delta' && e.delta.text) {
            yield { t: 'text', delta: e.delta.text };
          } else if (e.delta?.type === 'input_json_delta' && e.index !== undefined) {
            const block = blocks.get(e.index);
            const chunk = e.delta.partial_json ?? '';
            if (block) {
              block.json += chunk;
              yield { t: 'tool_delta', id: block.id, json: chunk };
            }
          }
          break;
        }

        case 'content_block_stop': {
          if (e.index === undefined) break;
          const block = blocks.get(e.index);
          if (!block) break;
          try {
            yield { t: 'tool_end', id: block.id, input: JSON.parse(block.json || '{}') };
          } catch {
            // Leave it unresolved: the loop treats an unparseable call as a
            // truncation and asks for a smaller step rather than guessing.
          }
          break;
        }

        case 'message_delta':
          stopReason = e.delta?.stop_reason ?? stopReason;
          outputTokens = e.usage?.output_tokens ?? outputTokens;
          break;

        case 'error':
          yield {
            t: 'error',
            error: errorFromResponse('Anthropic', 500, e.error?.message ?? 'stream error'),
          };
          return;

        default:
          break;
      }
    }

    yield { t: 'usage', inputTokens, outputTokens };
    yield { t: 'stop', reason: mapStop(stopReason) };
  },
};

function toolChoice(req: AgentRequest): unknown {
  if (req.toolChoice === 'required') return { type: 'any' };
  if (typeof req.toolChoice === 'object') return { type: 'tool', name: req.toolChoice.name };
  return { type: 'auto' };
}

/**
 * Anthropic caches everything up to the last breakpoint, so marking the final
 * tool caches the whole definition block along with it.
 */
function withCacheBreakpoint(tools: unknown[]): unknown[] {
  if (!tools.length) return tools;
  const out = [...tools];
  const last = out[out.length - 1];
  out[out.length - 1] = { ...(last as object), cache_control: { type: 'ephemeral' } };
  return out;
}

function mapStop(reason: string): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'end_turn';
  }
}
