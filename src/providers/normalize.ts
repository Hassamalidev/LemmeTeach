/**
 * Message and tool normalization (§6).
 *
 * Each function here converts the internal `AgentMessage[]` into one provider's
 * wire format. They are pure and exported so they can be tested directly
 * against captured raw responses — which matters, because these conversions
 * are where a provider difference silently becomes a broken lesson.
 *
 * The differences that actually bite:
 *   - Anthropic puts tool results in a *user* message as content blocks.
 *   - OpenAI streams tool arguments as a string that must be concatenated.
 *   - Gemini calls the assistant "model", has no call id at all, and needs the
 *     system prompt in its own field.
 */
import type { AgentMessage, JsonSchema, ToolSpec } from './types';

/** `data:image/png;base64,AAAA` → its media type and its bare base64 payload. */
export function splitDataUrl(dataUrl: string): { mime: string; data: string } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(dataUrl);
  return { mime: match?.[1] || 'application/octet-stream', data: match?.[2] ?? '' };
}

/* ------------------------------------------------------------------ *
 * Anthropic
 * ------------------------------------------------------------------ */

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown[];
}

export function toAnthropicMessages(messages: AgentMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      // Pictures and documents go before the text that asks about them.
      const blocks: unknown[] = (m.attachments ?? []).map((a) => {
        const { mime, data } = splitDataUrl(a.dataUrl);
        return a.kind === 'image'
          ? { type: 'image', source: { type: 'base64', media_type: mime, data } }
          : { type: 'document', source: { type: 'base64', media_type: mime, data } };
      });
      out.push({ role: 'user', content: [...blocks, { type: 'text', text: m.content }] });
      continue;
    }

    if (m.role === 'assistant') {
      const content: unknown[] = [];
      if (m.content.trim()) content.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {} });
      }
      // An assistant turn with no content at all is rejected; this only
      // happens after a truncation, where the turn is discarded anyway.
      if (content.length === 0) content.push({ type: 'text', text: '…' });
      out.push({ role: 'assistant', content });
      continue;
    }

    // Tool results ride in a user message as content blocks.
    out.push({
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        is_error: !r.ok,
      })),
    });
  }

  return mergeAdjacent(out);
}

/** Anthropic rejects two user messages in a row; results and text can collide. */
function mergeAdjacent(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = [...last.content, ...m.content];
    } else {
      out.push({ ...m, content: [...m.content] });
    }
  }
  return out;
}

export function toAnthropicTools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/* ------------------------------------------------------------------ *
 * OpenAI (and OpenRouter, and every compatible endpoint)
 * ------------------------------------------------------------------ */

export type OpenAiPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** A string, or content parts when the learner attached a picture or file. */
  content?: string | null | OpenAiPart[];
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export function toOpenAiMessages(system: string, messages: AgentMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];

  for (const m of messages) {
    if (m.role === 'user') {
      if (m.attachments?.length) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            ...m.attachments.map(
              (a): OpenAiPart =>
                a.kind === 'image'
                  ? { type: 'image_url', image_url: { url: a.dataUrl } }
                  : { type: 'file', file: { filename: a.name, file_data: a.dataUrl } },
            ),
          ],
        });
      } else {
        out.push({ role: 'user', content: m.content });
      }
      continue;
    }

    if (m.role === 'assistant') {
      // A turn where the model said nothing and called nothing must still
      // carry some text: several services refuse an assistant message with
      // neither content nor tool calls, and the whole question dies on it.
      const msg: OpenAiMessage = {
        role: 'assistant',
        content: m.content || (m.toolCalls.length ? null : '(no reply)'),
      };
      if (m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          // Arguments travel as a JSON *string* here, not an object.
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        }));
      }
      out.push(msg);
      continue;
    }

    for (const r of m.results) {
      out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
  }

  return out;
}

export function toOpenAiTools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/* ------------------------------------------------------------------ *
 * Gemini
 * ------------------------------------------------------------------ */

export interface GeminiContent {
  role: 'user' | 'model';
  parts: unknown[];
}

/**
 * Gemini returns no call id, so ids are synthesized as
 * `${name}#${turnIndex}#${callIndex}` and matched back by name. The
 * synthesized id must never reach anything user-visible, which is why it is
 * stripped again on the way out.
 */
export function toGeminiContents(messages: AgentMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      const files = (m.attachments ?? []).map((a) => {
        const { mime, data } = splitDataUrl(a.dataUrl);
        return { inlineData: { mimeType: mime, data } };
      });
      out.push({ role: 'user', parts: [...files, { text: m.content }] });
      continue;
    }

    if (m.role === 'assistant') {
      const parts: unknown[] = [];
      if (m.content.trim()) parts.push({ text: m.content });
      for (const call of m.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.input ?? {} } });
      }
      if (parts.length === 0) parts.push({ text: '…' });
      out.push({ role: 'model', parts });
      continue;
    }

    out.push({
      role: 'user',
      parts: m.results.map((r) => ({
        functionResponse: {
          name: r.name,
          // The response must be an object, so a plain string is wrapped.
          response: { ok: r.ok, result: r.content },
        },
      })),
    });
  }

  return out;
}

export function toGeminiTools(tools: ToolSpec[], narrow: (s: JsonSchema) => JsonSchema): unknown[] {
  if (!tools.length) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: narrow(t.parameters),
      })),
    },
  ];
}

export function synthesizeGeminiId(name: string, turn: number, index: number): string {
  return `${name}#${turn}#${index}`;
}
