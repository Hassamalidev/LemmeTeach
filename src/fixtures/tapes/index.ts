/**
 * Recorded session tapes.
 *
 * A tape is the raw `AgentEvent` sequence captured from a real session by
 * `npm run record -- --subject=physics --topic="…"`. Tapes are committed, and
 * re-recorded whenever the prompts change materially — a stale tape that no
 * longer resembles model output is worse than no tape, because it quietly
 * turns the integration suite into a test of last month's behaviour.
 *
 * This directory ships empty. Recording needs a real key and a real session,
 * so tapes cannot be generated as part of a build; until they exist the mock
 * adapter falls back to the authored fixture lessons and says so.
 */
import type { AgentEvent } from '../../providers/types';

// Vite inlines every tape it finds at build time. An empty directory yields an
// empty map, which is the honest state before anyone has recorded one.
const modules = import.meta.glob<{ default: AgentEvent[] }>('./*.json', { eager: true });

const TAPES = new Map<string, AgentEvent[]>();
for (const [path, mod] of Object.entries(modules)) {
  const id = path.replace(/^\.\//, '').replace(/\.json$/, '');
  const events = (mod as { default?: AgentEvent[] }).default;
  if (Array.isArray(events)) TAPES.set(id, events);
}

export function listTapes(): string[] {
  return [...TAPES.keys()].sort();
}

export function hasTapes(): boolean {
  return TAPES.size > 0;
}

export async function loadTapeEvents(id: string): Promise<AgentEvent[] | null> {
  return TAPES.get(id) ?? null;
}
