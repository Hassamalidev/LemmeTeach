/**
 * Static price table for the cost meter (§18).
 *
 * Clearly labelled as an estimate everywhere it surfaces, and — importantly —
 * the meter shows *nothing* rather than a wrong number when a model is not in
 * this table. A confidently wrong cost figure is worse than no figure, because
 * someone will budget against it.
 *
 * Prices are USD per million tokens. They go stale; that is why the UI says
 * "estimate" and links to the provider's own page.
 */

export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
}

const ANTHROPIC: Record<string, Price> = {
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
};

const OPENAI: Record<string, Price> = {
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4.1': { inputPerMTok: 2, outputPerMTok: 8 },
  'gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
};

const GEMINI: Record<string, Price> = {
  'gemini-2.0-flash': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-1.5-pro': { inputPerMTok: 1.25, outputPerMTok: 5 },
  'gemini-1.5-flash': { inputPerMTok: 0.075, outputPerMTok: 0.3 },
};

const TABLES: Record<string, Record<string, Price>> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  gemini: GEMINI,
};

export function priceFor(providerId: string, model: string): Price | null {
  const table = TABLES[providerId];
  if (!table) return null; // OpenRouter, a local endpoint, the mock: unknown by design.
  const exact = table[model];
  if (exact) return exact;
  // Dated model ids ("gpt-4o-2024-11-20") should match their base entry, but
  // only on a real prefix — never guess across families.
  for (const [id, price] of Object.entries(table)) {
    if (model.startsWith(id)) return price;
  }
  return null;
}

/** "about $0.04" / "under a cent" — cost written the way a person reads it. */
export function formatCost(usd: number | null): string | null {
  if (usd === null || !Number.isFinite(usd)) return null;
  if (usd < 0.01) return 'under a cent';
  if (usd < 1) return `about ${(usd * 100).toFixed(0)} cents`;
  return `about $${usd.toFixed(2)}`;
}

/**
 * What a typical 12-minute lesson costs, shown once before the first lesson so
 * nobody discovers the cost from their provider dashboard (§18).
 */
export function typicalLessonCost(providerId: string, model: string): string | null {
  const price = priceFor(providerId, model);
  if (!price) return null;
  // Measured against the recorded tapes: a 12-minute lesson lands near 90k
  // input tokens (mostly re-sent context) and 12k output.
  const usd = (90_000 / 1e6) * price.inputPerMTok + (12_000 / 1e6) * price.outputPerMTok;
  return formatCost(usd);
}
