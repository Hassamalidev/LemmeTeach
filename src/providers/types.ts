/**
 * The provider seam (§5, §6).
 *
 * One interface, six adapters. Everything above this layer sees only
 * `AgentEvent`, and nothing above this layer may contain a provider name in a
 * conditional. If you find yourself writing `if (provider === 'anthropic')`
 * outside `src/providers/`, the difference belongs in an adapter instead.
 */
import type { ProviderId } from '../core/types';
import type { ChalkError } from '../runtime/errors';

/* ------------------------------------------------------------------ *
 * Normalized message format (§6)
 * ------------------------------------------------------------------ */

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  name: string;
  ok: boolean;
  /** Always a string; JSON-stringified for structured results. Kept small. */
  content: string;
}

/**
 * Something the learner attached to their question: a screenshot, a photo of
 * a worksheet, a PDF. Sent once, to the agent that reads the question — never
 * re-sent on every turn, which is what would make it expensive.
 */
export interface Attachment {
  kind: 'image' | 'file';
  name: string;
  /** `data:<mime>;base64,…` */
  dataUrl: string;
}

export type AgentMessage =
  | { role: 'user'; content: string; attachments?: Attachment[] }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

/* ------------------------------------------------------------------ *
 * Requests and events
 * ------------------------------------------------------------------ */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema, generated from the tool's Zod schema — never hand-written. */
  parameters: JsonSchema;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  nullable?: boolean;
  [k: string]: unknown;
}

export interface AgentRequest {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  temperature: number;
  toolChoice?: 'auto' | 'required' | { name: string };
}

export type AgentEvent =
  | { t: 'text'; delta: string }
  | { t: 'tool_start'; id: string; name: string }
  | { t: 'tool_delta'; id: string; json: string }
  | { t: 'tool_end'; id: string; input: unknown }
  | {
      t: 'usage';
      inputTokens: number;
      outputTokens: number;
      /** How many of the input tokens were read from the prompt cache. */
      cachedInputTokens?: number;
      /** What the gateway says this turn cost, where it reports one. */
      costUsd?: number;
    }
  | { t: 'stop'; reason: StopReason }
  | { t: 'error'; error: ChalkError };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';

export interface ModelInfo {
  id: string;
  label: string;
  /** Context window in tokens, where the provider tells us. */
  contextWindow?: number;
  /** Whether the model advertises tool support. Used to filter OpenRouter. */
  tools?: boolean;
}

/**
 * Where an OpenAI-compatible service differs from OpenAI itself. Each of these
 * is a request some service rejects outright, so they are per service rather
 * than guessed at.
 */
export interface AdapterQuirks {
  /** The service rejects `stream_options`; it reports usage without being asked. */
  omitStreamOptions?: boolean;
  /** What the service calls "you must call a tool", where it is not `required`. */
  requiredToolChoice?: string;
  /** The service will not accept a user message directly after a tool result. */
  bridgeUserAfterTool?: boolean;
}

export interface AdapterConfig {
  apiKey: string;
  /** Only meaningful for the `compatible` adapter. */
  baseUrl?: string;
  /** Only meaningful for the `compatible` adapter. */
  quirks?: AdapterQuirks;
  /** The service's name for error messages, where one adapter serves several. */
  label?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  defaultModel: string;
  keyPlaceholder: string;
  keyHelpUrl: string;
  /** Where a key is obtained, written for a human, not a spec. */
  keyHint: string;
  /**
   * An extra explanation shown in Settings, for a provider that needs one —
   * Anthropic's browser header being the example. It lives here rather than in
   * the UI so that no screen above this layer has to test which provider it is
   * looking at (§25).
   */
  keyNote?: string;
  /** A note under the model picker, given the number of models on offer. */
  modelNote?: (count: number) => string | null;
  /**
   * True for a provider that needs no key and no network at all. Screens use
   * this to tell the demo apart, rather than naming the mock adapter.
   */
  demo?: boolean;
  /** Shown once the demo provider is chosen, explaining what it does. */
  demoNote?: string;
  /** True when the learner supplies the endpoint themselves. */
  needsBaseUrl?: boolean;
  supportsToolChoice: boolean;
  supportsParallelToolCalls: boolean;
  /** True when the adapter needs no key at all (mock, and local endpoints). */
  keyOptional?: boolean;
  models(cfg: AdapterConfig): Promise<ModelInfo[]>;
  run(req: AgentRequest, cfg: AdapterConfig, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

/** Collected result of consuming one provider turn. */
export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; costUsd?: number };
  stop: StopReason;
}
