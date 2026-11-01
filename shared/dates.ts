/**
 * Day and week stamps, used by the usage counts on both sides (§30). UTC, so
 * a count does not depend on where the server or the visitor happens to be.
 */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The ISO week a moment falls in, like `2026-W45`. */
export function weekOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday is 0.
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
