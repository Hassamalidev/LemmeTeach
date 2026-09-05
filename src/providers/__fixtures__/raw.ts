/**
 * Captured raw response bodies, one per provider.
 *
 * These are the exact SSE framings the adapters have to survive, including the
 * awkward parts each provider actually does: Anthropic splitting a JSON
 * argument across `partial_json` fragments, OpenAI sending the tool name on
 * the first fragment only, and Gemini delivering a whole call in one part with
 * no id at all.
 */

export const ANTHROPIC_STREAM = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":1204,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me show you."}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"teach_step","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"say\\": \\"Watch"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" this.\\", \\"board\\": []}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":312}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

export const OPENAI_STREAM = [
  'data: {"choices":[{"delta":{"role":"assistant","content":"Right, "}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"here we go."}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"teach_step","arguments":""}}]}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"say\\":\\"Watch"}}]}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" this.\\",\\"board\\":[]}"}}]}}]}',
  '',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  '',
  'data: {"choices":[],"usage":{"prompt_tokens":1180,"completion_tokens":290}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

export const GEMINI_STREAM = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Right, here we go."}],"role":"model"}}]}',
  '',
  'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"teach_step","args":{"say":"Watch this.","board":[]}}}],"role":"model"}}]}',
  '',
  'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1100,"candidatesTokenCount":240}}',
  '',
].join('\n');

/** A rate-limit body, used to check the error taxonomy maps it correctly. */
export const RATE_LIMIT_BODY = JSON.stringify({
  type: 'error',
  error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' },
});

export const AUTH_ERROR_BODY = JSON.stringify({
  type: 'error',
  error: { type: 'authentication_error', message: 'invalid x-api-key' },
});
