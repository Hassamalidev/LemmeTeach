/**
 * Session trace (§7, §22).
 *
 * Every turn boundary, tool call, tool result, phase transition, error and
 * usage record appends here. Two audiences: the Details drawer, which shows a
 * learner what the system is actually doing, and `Export trace`, which is how
 * a bug gets reported.
 *
 * The export is scrubbed (§19). Nothing in this file may hold an API key, and
 * `toExport` runs the whole serialized blob through `scrubKeys` as a second
 * line of defence.
 */
import { now, uid } from '../core/types';
import { scrubKeys } from '../storage/settings';
import type { ChalkErrorShape } from './errors';

export type TraceEntry =
  | { id: string; at: number; t: 'phase'; from: string; to: string; note?: string }
  | { id: string; at: number; t: 'turn'; agent: string; turn: number; model: string }
  | { id: string; at: number; t: 'text'; agent: string; text: string }
  | { id: string; at: number; t: 'tool_call'; name: string; callId: string; input: unknown }
  | {
      id: string;
      at: number;
      t: 'tool_result';
      name: string;
      callId: string;
      ok: boolean;
      content: string;
      ms: number;
    }
  | { id: string; at: number; t: 'usage'; inputTokens: number; outputTokens: number }
  | { id: string; at: number; t: 'error'; error: ChalkErrorShape }
  | { id: string; at: number; t: 'note'; message: string };

/**
 * Omit across a union has to distribute, or the union collapses to its common
 * fields and every call site loses its own payload.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TraceInput = DistributiveOmit<TraceEntry, 'id' | 'at'> & { at?: number };

const MAX_ENTRIES = 800;

export class Trace {
  private entries: TraceEntry[] = [];
  private listeners = new Set<(e: TraceEntry) => void>();
  readonly startedAt = now();

  push(entry: TraceInput): void {
    const full = { id: uid('tr'), at: entry.at ?? now(), ...entry } as TraceEntry;
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) {
      // Drop from the middle, not the start: the opening of a session explains
      // how it was configured and is the first thing anyone reads.
      this.entries.splice(80, this.entries.length - MAX_ENTRIES);
    }
    for (const fn of this.listeners) fn(full);
  }

  subscribe(fn: (e: TraceEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  all(): readonly TraceEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  /** A scrubbed, downloadable JSON blob. Asserted key-free by test. */
  toExport(meta: Record<string, unknown> = {}): string {
    const body = {
      app: 'chalk',
      exportedAt: now(),
      startedAt: this.startedAt,
      meta,
      entries: this.entries,
    };
    return scrubKeys(JSON.stringify(body, null, 2));
  }
}

/**
 * Plain-language status line (§15). Driven by real trace events, so it is
 * always accurate — no fake typing indicators, no "thinking…" pretending at
 * depth.
 */
export function statusFor(entry: TraceEntry): string | null {
  switch (entry.t) {
    case 'phase':
      switch (entry.to) {
        case 'PLANNING':
          return 'Planning the lesson';
        case 'TEACHING':
          return 'Teaching';
        case 'CHECKING':
          return 'Waiting for your answer';
        case 'REMEDIATING':
          return 'Backing up to fill a gap';
        case 'INTERRUPTED':
          return 'Listening to your question';
        case 'EXAMINING':
          return 'Setting a short check';
        case 'REVIEW':
          return 'Wrapping up';
        default:
          return null;
      }
    case 'tool_call':
      switch (entry.name) {
        case 'run_code': {
          const input = entry.input as { purpose?: string; language?: string } | null;
          return input?.purpose
            ? `Working that out in ${input.language === 'python' ? 'Python' : 'JavaScript'}: ${input.purpose}`
            : 'Running some code';
        }
        case 'search_materials':
          return 'Checking your notes';
        case 'wiki_lookup':
          return 'Looking that up';
        case 'compute':
          return 'Doing the arithmetic';
        case 'recall_learner':
          return 'Reading what you already know';
        case 'update_learner':
          return null; // Housekeeping; not worth a status line.
        case 'plan_lesson':
          return 'Writing the plan';
        default:
          return null;
      }
    case 'error':
      return entry.error.message;
    default:
      return null;
  }
}
