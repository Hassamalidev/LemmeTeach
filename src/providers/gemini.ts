/**
 * Google Gemini adapter (§5.3).
 *
 * Three differences the adapter absorbs so nothing above it has to care: the
 * assistant role is called "model", the system prompt lives in
 * `systemInstruction`, and results come back as `functionResponse` parts. The
 * fourth — a much narrower JSON Schema subset — is handled by
 * `narrowSchemaForGemini`.
 *
 * Gemini also returns no call id, so ids are synthesized per turn and kept in
 * a local map. A synthesized id never reaches anything user-visible.
 */
import type {
  AdapterConfig,
  AgentEvent,
  AgentRequest,
  ModelInfo,
  ProviderAdapter,
  StopReason,
} from './types';
import { synthesizeGeminiId, toGeminiContents, toGeminiTools } from './normalize';
import { narrowSchemaForGemini } from './schema-narrow';
import { readSse, parseData } from './sse';
import { errorFromFetchFailure, errorFromResponse } from '../runtime/errors';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MODELS: ModelInfo[] = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', contextWindow: 1_000_000, tools: true },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', contextWindow: 2_000_000, tools: true },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', contextWindow: 1_000_000, tools: true },
];

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; functionCall?: { name: string; args: unknown } }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; code?: number };
}

let turnCounter = 0;

export const gemini: ProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: 'gemini-2.0-flash',
  keyPlaceholder: 'AIza…',
  keyHelpUrl: 'https://aistudio.google.com/apikey',
  keyHint: 'Create a key in Google AI Studio. The free tier is generous enough for a few lessons.',
  supportsToolChoice: true,
  supportsParallelToolCalls: true,

  async models(): Promise<ModelInfo[]> {
    return MODELS;
  },

  async *run(req: AgentRequest, cfg: AdapterConfig, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const turn = turnCounter++;
    const url = `${BASE}/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`;

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toGeminiContents(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      },
    };

    if (req.tools.length) {
      body.tools = toGeminiTools(req.tools, narrowSchemaForGemini);
      body.toolConfig = {
        functionCallingConfig: { mode: req.toolChoice === 'required' ? 'ANY' : 'AUTO' },
      };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield { t: 'error', error: errorFromFetchFailure('Gemini', err) };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield { t: 'error', error: errorFromResponse('Gemini', res.status, text, res.headers) };
      return;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finish: string | undefined;
    let callIndex = 0;

    for await (const sse of readSse(res.body, signal)) {
      const chunk = parseData<GeminiChunk>(sse.data);
      if (!chunk) continue;

      if (chunk.error) {
        yield {
          t: 'error',
          error: errorFromResponse('Gemini', chunk.error.code ?? 500, chunk.error.message ?? ''),
        };
        return;
      }

      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }

      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finish = candidate.finishReason;

      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) {
          yield { t: 'text', delta: part.text };
          continue;
        }
        if (part.functionCall) {
          // A whole call arrives in one part — there is nothing to accumulate.
          const id = synthesizeGeminiId(part.functionCall.name, turn, callIndex++);
          yield { t: 'tool_start', id, name: part.functionCall.name };
          yield { t: 'tool_delta', id, json: JSON.stringify(part.functionCall.args ?? {}) };
          yield { t: 'tool_end', id, input: part.functionCall.args ?? {} };
        }
      }
    }

    yield { t: 'usage', inputTokens, outputTokens };
    yield { t: 'stop', reason: mapFinish(finish, callIndex > 0) };
  },
};

function mapFinish(reason: string | undefined, hadCalls: boolean): StopReason {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
      return 'refusal';
    default:
      return hadCalls ? 'tool_use' : 'end_turn';
  }
}
