/**
 * localStorage-backed settings and the key vault (§5.7, §20).
 *
 * Small, synchronous, and needed at boot — which is exactly what
 * localStorage is for, and exactly why the API key lives here too rather than
 * in IndexedDB: it has to be readable before the first render.
 *
 * The key rules are absolute and there is a test asserting them: never logged,
 * never in a URL, never in an exception message, never in a trace export,
 * never in a saved lesson.
 */
import { PROVIDER_IDS, type ProviderId, type Pace } from '../core/types';

export type BoardTheme = 'slate' | 'paper';

export interface Settings {
  provider: ProviderId;
  model: Record<string, string>;
  /** Per-role overrides; empty means "use the provider default for that role". */
  roleModels: { planner?: string; tutor?: string; repairer?: string };
  /** Which tutor tier a subscriber's lessons use (§18). */
  quality: 'standard' | 'deep';
  /**
   * Set when the learner is using their own API key instead of a plan (§5.8):
   * whose key it is and which models were chosen for it. The key itself is in
   * the key vault, never in here.
   */
  ownKey: {
    providerId: ProviderId;
    /** Which service the key belongs to; several share one adapter. */
    serviceId: string;
    label: string;
    models: { planner: string; tutor: string; repairer: string };
    /** Where to send requests, for a service on the compatible adapter. */
    baseUrl?: string;
    quirks?: {
      omitStreamOptions?: boolean;
      requiredToolChoice?: string;
      bridgeUserAfterTool?: boolean;
    };
  } | null;
  compatibleBaseUrl: string;
  pyodideBaseUrl: string;
  theme: BoardTheme;
  rate: number;
  voiceName: string | null;
  muted: boolean;
  wikiEnabled: boolean;
  sandboxEnabled: boolean;
  pace: Pace;
  budget: { inputTokens: number; outputTokens: number };
  rememberKey: boolean;
  reducedMotion: 'system' | 'always';
  seenFirstRunEstimate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  // The demo, until a license is activated on this device (§15).
  provider: 'mock',
  model: {},
  roleModels: {},
  quality: 'standard',
  ownKey: null,
  compatibleBaseUrl: 'http://localhost:11434/v1',
  pyodideBaseUrl: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
  theme: 'slate',
  rate: 1,
  voiceName: null,
  muted: false,
  // Off by default: some learners are on metered or restricted networks (§9.7).
  wikiEnabled: false,
  sandboxEnabled: true,
  pace: 'normal',
  // Billable tokens: cache reads count for a tenth (runtime/budget.ts).
  budget: { inputTokens: 200_000, outputTokens: 30_000 },
  rememberKey: true,
  reducedMotion: 'system',
  seenFirstRunEstimate: false,
};

const SETTINGS_KEY = 'chalk.settings';
const SCHEMA_KEY = 'chalk.schema';
const LICENSE_KEY = 'chalk.license';
const keyKey = (p: ProviderId): string => `chalk.key.${p}`;

function safeLocal(): Storage | null {
  try {
    const t = '__chalk_probe__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return null; // Private mode, or storage blocked. Session-only from here.
  }
}

export function loadSettings(): Settings {
  const ls = safeLocal();
  if (!ls) return { ...DEFAULT_SETTINGS };
  try {
    const raw = ls.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      model: { ...parsed.model },
      roleModels: { ...parsed.roleModels },
      budget: { ...DEFAULT_SETTINGS.budget, ...parsed.budget },
      provider: PROVIDER_IDS.includes(parsed.provider as ProviderId)
        ? (parsed.provider as ProviderId)
        : DEFAULT_SETTINGS.provider,
      quality: parsed.quality === 'deep' ? 'deep' : 'standard',
      ownKey:
        parsed.ownKey && PROVIDER_IDS.includes(parsed.ownKey.providerId)
          ? { ...parsed.ownKey, serviceId: parsed.ownKey.serviceId ?? parsed.ownKey.providerId }
          : null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  const ls = safeLocal();
  if (!ls) return;
  try {
    ls.setItem(SETTINGS_KEY, JSON.stringify(s));
    ls.setItem(SCHEMA_KEY, String(1));
  } catch {
    /* Quota or blocked storage: the session keeps its settings in memory. */
  }
}

/* --------------------------------- keys ---------------------------------- */

/**
 * Memory-only keys for "Don't remember on this device". Held in a module
 * variable so they die with the tab.
 */
const memoryKeys = new Map<ProviderId, string>();

export function getKey(provider: ProviderId): string {
  const inMemory = memoryKeys.get(provider);
  if (inMemory) return inMemory;
  const ls = safeLocal();
  if (!ls) return '';
  try {
    return ls.getItem(keyKey(provider)) ?? '';
  } catch {
    return '';
  }
}

export function setKey(provider: ProviderId, key: string, remember: boolean): void {
  memoryKeys.set(provider, key);
  if (!remember) {
    forgetStoredKey(provider);
    return;
  }
  const ls = safeLocal();
  if (!ls) return;
  try {
    ls.setItem(keyKey(provider), key);
  } catch {
    /* Falls back to memory-only, which is a degradation, not a failure. */
  }
}

export function forgetStoredKey(provider: ProviderId): void {
  const ls = safeLocal();
  try {
    ls?.removeItem(keyKey(provider));
  } catch {
    /* nothing to do */
  }
}

export function forgetAllKeys(): void {
  memoryKeys.clear();
  for (const p of PROVIDER_IDS) forgetStoredKey(p);
}

export function hasKey(provider: ProviderId): boolean {
  return getKey(provider).length > 0;
}

/* -------------------------------- license -------------------------------- */

/**
 * The learner's proof of purchase (§5.7). Held to the same rules as the model
 * key: it goes to our own activation endpoint and nowhere else.
 */
export interface StoredLicense {
  licenseKey: string;
  planId: string;
  activatedAt: number;
}

export function getLicense(): StoredLicense | null {
  const ls = safeLocal();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LICENSE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLicense>;
    if (typeof parsed.licenseKey !== 'string' || typeof parsed.planId !== 'string') return null;
    return {
      licenseKey: parsed.licenseKey,
      planId: parsed.planId,
      activatedAt: typeof parsed.activatedAt === 'number' ? parsed.activatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function setLicense(license: StoredLicense): void {
  const ls = safeLocal();
  try {
    ls?.setItem(LICENSE_KEY, JSON.stringify(license));
  } catch {
    /* Blocked storage: the learner activates again next visit. */
  }
}

export function forgetLicense(): void {
  const ls = safeLocal();
  try {
    ls?.removeItem(LICENSE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Every string that leaves the app — a trace export, a saved lesson, a log
 * line — passes through here. Belt and braces on top of "never put the key in
 * the object in the first place".
 */
export function scrubKeys(text: string): string {
  let out = text;
  const candidates = new Set<string>();
  for (const p of PROVIDER_IDS) {
    const k = getKey(p);
    if (k && k.length >= 8) candidates.add(k);
  }
  const license = getLicense()?.licenseKey;
  if (license && license.length >= 8) candidates.add(license);
  for (const k of candidates) {
    out = out.split(k).join('[key removed]');
  }
  // Catch keys that were never ours to begin with (pasted into a topic box,
  // echoed by a provider error) using the shapes the providers actually issue.
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[key removed]');
  out = out.replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, '[key removed]');
  out = out.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[key removed]');
  out = out.replace(/\bor-v1-[A-Za-z0-9]{16,}\b/g, '[key removed]');
  return out;
}
