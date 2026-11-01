/**
 * Bring your own key (§5.8).
 *
 * Someone who already has an API key can paste it and use LemmeTeach without a
 * subscription. They pay their provider directly and we charge nothing. All
 * they give us is the key: which service it belongs to is read off its shape,
 * it is checked with one harmless request, and the models are chosen for them.
 *
 * The key is stored in this browser and sent only to the service it belongs
 * to. Our own servers never see it — they are not involved in this path at
 * all.
 *
 * Two kinds of service are supported. Four have an adapter of their own. The
 * rest speak the OpenAI wire format at their own address, so they run on the
 * `compatible` adapter with that address and a note of where they differ.
 * Only services that accept requests straight from a browser are listed:
 * each one here was checked for the CORS headers that requires.
 */
import type { ProviderId } from '../core/types';
import { adapterFor } from './index';
import { managedModels, type ModelSet } from './managed';
import type { AdapterConfig, AdapterQuirks } from './types';

export interface OwnKey {
  providerId: ProviderId;
  /** Which service the key belongs to. Several share one adapter. */
  serviceId: string;
  /** The service's name, for the screens that say whose key this is. */
  label: string;
  models: ModelSet;
  /** Set for services reached through the `compatible` adapter. */
  baseUrl?: string;
  quirks?: AdapterQuirks;
}

export type OwnKeyResult =
  | { ok: true; ownKey: OwnKey }
  /** `choose` is true when picking the service by hand is the way forward. */
  | { ok: false; message: string; choose: boolean };

interface Service {
  id: string;
  label: string;
  providerId: ProviderId;
  /** A shape this service's keys have, or null when they have none to go by. */
  keyShape: RegExp | null;
  /** Base URL for the `compatible` adapter. */
  baseUrl?: string;
  /** A read-only request that fails cleanly on a bad key. */
  probe: (key: string) => { url: string; headers: Record<string, string> };
  /** Models to use, best first, matched against what the key can actually reach. */
  prefer: string[];
  quirks?: AdapterQuirks;
}

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

/** A service that speaks the OpenAI wire format at its own address. */
function compatible(
  id: string,
  label: string,
  baseUrl: string,
  keyShape: RegExp | null,
  prefer: string[],
  quirks?: AdapterQuirks,
): Service {
  return {
    id,
    label,
    providerId: 'compatible',
    keyShape,
    baseUrl,
    probe: (key) => ({ url: `${baseUrl}/models`, headers: bearer(key) }),
    prefer,
    quirks,
  };
}

/**
 * Every service a key can belong to.
 *
 * Order is the order shapes are tried in, so the unmistakable prefixes come
 * first and the shapes several services share come last. Where a shape is
 * shared, the commonest service is listed and the screen lets the learner
 * say it is a different one.
 */
const SERVICES: Service[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    providerId: 'openrouter',
    keyShape: /^sk-or-/,
    probe: (key) => ({ url: 'https://openrouter.ai/api/v1/key', headers: bearer(key) }),
    prefer: [],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    providerId: 'anthropic',
    keyShape: /^sk-ant-/,
    probe: (key) => ({
      url: 'https://api.anthropic.com/v1/models',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // The key is the visitor's own and stays in their browser, which is
        // the case this header exists for.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }),
    prefer: ['claude-haiku-4-5'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    providerId: 'gemini',
    keyShape: /^AIza[0-9A-Za-z_-]{20,}$/,
    // In a header, not the query string: a key must never be in a URL.
    probe: (key) => ({
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      headers: { 'x-goog-api-key': key },
    }),
    prefer: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
  compatible('groq', 'Groq', 'https://api.groq.com/openai/v1', /^gsk_/, [
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'moonshotai/kimi-k2-instruct',
  ]),
  compatible('xai', 'xAI', 'https://api.x.ai/v1', /^xai-/, ['grok-4-fast', 'grok-3-mini', 'grok-4']),
  compatible('fireworks', 'Fireworks', 'https://api.fireworks.ai/inference/v1', /^fw_/, [
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
  ]),
  compatible('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', /^csk-/, ['llama-3.3-70b', 'gpt-oss-120b']),
  compatible('together', 'Together AI', 'https://api.together.xyz/v1', /^(tgp_|[0-9a-f]{64}$)/, [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  ]),
  // `sk-` and exactly 32 hex digits. Alibaba's keys look the same, which is
  // why the screen offers a choice.
  compatible('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', /^sk-[0-9a-f]{32}$/, ['deepseek-chat']),
  {
    id: 'openai',
    label: 'OpenAI',
    providerId: 'openai',
    keyShape: /^sk-[A-Za-z0-9_-]{16,}$/,
    probe: (key) => ({ url: 'https://api.openai.com/v1/models', headers: bearer(key) }),
    // The adapter sends `max_tokens` and a temperature. These models accept
    // both; the newer reasoning models do not, so they are not offered yet.
    prefer: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1'],
  },
  // Mistral's keys carry no prefix at all: 32 letters and digits.
  compatible(
    'mistral',
    'Mistral',
    'https://api.mistral.ai/v1',
    /^[A-Za-z0-9]{32}$/,
    ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
    // Mistral rejects request fields it does not know, calls a forced tool
    // choice "any", and will not take a user message straight after a tool
    // result.
    { omitStreamOptions: true, requiredToolChoice: 'any', bridgeUserAfterTool: true },
  ),
  compatible(
    'cohere',
    'Cohere',
    'https://api.cohere.ai/compatibility/v1',
    /^[A-Za-z0-9]{40}$/,
    ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024'],
    { omitStreamOptions: true },
  ),
  // No shape of their own: reached only by choosing them.
  compatible('dashscope', 'Alibaba (Qwen)', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', null, [
    'qwen-plus',
    'qwen-turbo',
  ]),
  compatible('moonshot', 'Moonshot (Kimi)', 'https://api.moonshot.ai/v1', null, [
    'kimi-k2-0711-preview',
    'moonshot-v1-32k',
  ]),
  compatible('hyperbolic', 'Hyperbolic', 'https://api.hyperbolic.xyz/v1', null, [
    'meta-llama/Llama-3.3-70B-Instruct',
  ]),
  // Development only: a local Ollama, for trying the product without a paid
  // key. It is not in a production build, whatever else changes. Ollama
  // ignores the key, so any text of twelve characters or more will do.
  ...(import.meta.env.DEV
    ? [compatible('ollama', 'Ollama (local testing)', 'http://localhost:11434/v1', null, ['gemma4:31b-cloud'])]
    : []),
];

/** The services, for the "which one is it?" list on the own-key screen. */
export const OWN_KEY_SERVICES: { id: string; label: string }[] = SERVICES.map((s) => ({
  id: s.id,
  label: s.label,
})).sort((a, b) => a.label.localeCompare(b.label));

/** Whose keys are accepted, as the screens say it. Kept here so no screen names a provider. */
export const OWN_KEY_PROVIDERS =
  'Anthropic, OpenAI, Google, Mistral, Groq, DeepSeek, xAI, OpenRouter or several others';

/** Which service a key most likely belongs to, from its shape alone. */
export function detectService(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  return SERVICES.find((s) => s.keyShape?.test(k))?.id ?? null;
}

/** The adapter a key would run on, or null when its shape is not recognised. */
export function detectProvider(key: string): ProviderId | null {
  const id = detectService(key);
  return SERVICES.find((s) => s.id === id)?.providerId ?? null;
}

/** The model ids a service's list response names, whatever shape it uses. */
function idsFrom(body: unknown): string[] {
  const out: string[] = [];
  const b = body as { data?: { id?: unknown }[]; models?: { name?: unknown }[] } | { id?: unknown }[] | null;
  const rows = Array.isArray(b) ? b : (b?.data ?? []);
  for (const m of rows) if (typeof m?.id === 'string') out.push(m.id);
  if (b && !Array.isArray(b)) {
    for (const m of b.models ?? []) {
      if (typeof m?.name === 'string') out.push(m.name.replace(/^models\//, ''));
    }
  }
  return out;
}

/** Models that are not for holding a conversation, whatever their name suggests. */
const NOT_CHAT = /embed|whisper|tts|audio|speech|moderation|guard|rerank|image|ocr|transcri/i;
/** What a small, capable chat model tends to be called. */
const LOOKS_SMALL = /small|mini|flash|turbo|lite|chat|instant|70b|\d+b\b/i;

const all = (model: string): ModelSet => ({ planner: model, tutor: model, repairer: model });

/**
 * Pick the model for a key. A preferred one if the key can reach it;
 * otherwise, on the compatible services, something from the service's own
 * list that looks like a small chat model, so a renamed model does not break
 * a working key; and only then a fixed guess.
 */
export function chooseModels(serviceId: string, available: string[]): ModelSet {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) return all(adapterFor(serviceId as ProviderId).defaultModel);
  if (service.providerId === 'openrouter') return managedModels('standard');

  const preferred = service.prefer.find((id) => available.includes(id));
  if (preferred) return all(preferred);

  // Only the compatible services fall back to "whatever is listed": their
  // model names change often. The others keep a known-good default.
  if (service.providerId === 'compatible') {
    const chat = available.filter((id) => !NOT_CHAT.test(id));
    const listed = chat.find((id) => LOOKS_SMALL.test(id)) ?? chat[0];
    if (listed) return all(listed);
  }

  return all(service.prefer[0] ?? adapterFor(service.providerId).defaultModel);
}

/** What the adapter needs to call the service a key belongs to. */
export function adapterConfigFor(own: OwnKey, apiKey: string): AdapterConfig {
  return { apiKey, baseUrl: own.baseUrl, quirks: own.quirks, label: own.label };
}

/**
 * Check a pasted key and work out how to use it. Never throws: every way this
 * can go wrong is a sentence for the person who pasted the key.
 *
 * `serviceId` is set when the learner said which service the key is from.
 * Otherwise it is read off the key. The key is only ever sent to that one
 * service — it is not tried against others to see which accepts it, because
 * that would hand a secret to companies that did not issue it.
 */
export async function connectOwnKey(rawKey: string, serviceId?: string): Promise<OwnKeyResult> {
  const key = rawKey.trim();
  if (key.length < 12 || /\s/.test(key)) {
    return {
      ok: false,
      choose: false,
      message:
        'That does not look like an API key. Copy the whole key, with nothing around it, and try again.',
    };
  }

  const id = serviceId || detectService(key);
  const service = SERVICES.find((s) => s.id === id);
  if (!service) {
    return {
      ok: false,
      choose: true,
      message:
        'We could not tell which service that key is from. Choose it from the list and try again.',
    };
  }

  const guessed = !serviceId;
  const probe = service.probe(key);

  let res: Response;
  try {
    res = await fetch(probe.url, { headers: { accept: 'application/json', ...probe.headers } });
  } catch {
    return {
      ok: false,
      choose: false,
      message: `Could not reach ${service.label} to check that key. Check your connection and try again.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      choose: true,
      message: guessed
        ? `That looked like a ${service.label} key, but ${service.label} did not accept it. If it is from a different service, choose it from the list; otherwise check the key and paste it again.`
        : `${service.label} did not accept that key. Check it and paste it again.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      choose: false,
      message: `${service.label} could not check that key just now (it answered ${res.status}). Try again in a minute.`,
    };
  }

  const body: unknown = await res.json().catch(() => null);
  return {
    ok: true,
    ownKey: {
      providerId: service.providerId,
      serviceId: service.id,
      label: service.label,
      models: chooseModels(service.id, idsFrom(body)),
      baseUrl: service.baseUrl,
      quirks: service.quirks,
    },
  };
}

/** Every origin a key can be sent to. public/csp.js must allow each of these. */
export const OWN_KEY_ORIGINS: string[] = [
  ...new Set(SERVICES.map((s) => new URL(s.probe('x').url).origin)),
].sort();
