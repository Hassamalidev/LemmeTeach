/**
 * OpenRouter (§5.4) and any OpenAI-compatible endpoint (§5.5).
 *
 * OpenRouter is the adapter that lets a learner use nearly any model without a
 * code change, which is worth having — but showing all three hundred models,
 * most of which fail on turn one because they cannot call tools, would make it
 * useless. The list is filtered to models that advertise tool support and that
 * filter is surfaced in the UI rather than applied silently.
 */
import type { AdapterConfig, ModelInfo, ProviderAdapter } from './types';
import { createOpenAiLike } from './openai';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { instruct_type?: string };
}

async function openRouterModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${OPENROUTER_BASE}/models`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return OPENROUTER_FALLBACK;
    const json = (await res.json()) as { data?: OpenRouterModel[] };
    const list = (json.data ?? [])
      .filter((m) => m.supported_parameters?.includes('tools'))
      .map((m) => ({
        id: m.id,
        label: m.name ?? m.id,
        contextWindow: m.context_length,
        tools: true,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return list.length ? list : OPENROUTER_FALLBACK;
  } catch {
    // Offline, or the list endpoint is down: a short static list still lets
    // someone start a lesson, which is the point of the fallback.
    return OPENROUTER_FALLBACK;
  }
}

const OPENROUTER_FALLBACK: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', tools: true },
  { id: 'openai/gpt-4.1', label: 'GPT-4.1', tools: true },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', tools: true },
];

export const openrouter: ProviderAdapter = createOpenAiLike({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: OPENROUTER_BASE,
  defaultModel: 'anthropic/claude-sonnet-5',
  keyPlaceholder: 'sk-or-v1-…',
  keyHelpUrl: 'https://openrouter.ai/keys',
  keyHint: 'Create a key at openrouter.ai under Keys. One key reaches most models.',
  modelNote: (count) =>
    `${count} models that support tool calls. The rest are hidden because they cannot run a lesson.`,
  extraHeaders: {
    // OpenRouter asks apps to identify themselves. Neither header carries
    // anything about the learner.
    'HTTP-Referer': 'https://github.com/chalk-tutor/chalk',
    'X-Title': 'Chalk',
  },
  models: openRouterModels,
});

/* ------------------------------------------------------------------ *
 * Compatible — a user-supplied base URL
 * ------------------------------------------------------------------ */

async function compatibleModels(cfg: AdapterConfig): Promise<ModelInfo[]> {
  const base = (cfg.baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    const res = await fetch(`${base}/models`, { headers });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => ({ id: m.id, label: m.id, tools: true }));
  } catch {
    return [];
  }
}

export const compatible: ProviderAdapter = createOpenAiLike({
  id: 'compatible',
  label: 'Your own endpoint',
  baseUrl: 'http://localhost:11434/v1',
  defaultModel: 'llama3.1',
  keyPlaceholder: 'leave blank for a local server',
  keyHelpUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  keyHint:
    'Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, Groq, Together, DeepSeek. Local servers usually need no key.',
  keyOptional: true,
  needsBaseUrl: true,
  models: compatibleModels,
});

/** True for an insecure origin that is not localhost — worth a warning (§5.5). */
export function isInsecureRemote(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:') return false;
    return !['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname);
  } catch {
    return false;
  }
}
