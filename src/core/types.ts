/**
 * Cross-cutting identifiers and small shared types.
 *
 * Nothing in here knows about a provider, an agent, or the DOM. If a type
 * needs one of those, it belongs in that layer's own file instead — the seams
 * described in §3 are what let the board be driven from a fixture and the
 * runtime be tested without a key.
 */

export const SUBJECT_IDS = [
  'math',
  'physics',
  'chemistry',
  'cs',
  'biology',
  'finance',
  'psychology',
  // Everything else. The board's general operations — text, tables, diagrams,
  // plots — carry a lesson in any field that can be explained on a whiteboard.
  'general',
] as const;
export type SubjectId = (typeof SUBJECT_IDS)[number];

export const LEVELS = ['intro', 'school', 'undergrad', 'deep'] as const;
export type Level = (typeof LEVELS)[number];

export const PACES = ['slow', 'normal', 'quick'] as const;
export type Pace = (typeof PACES)[number];

/**
 * `planner` is the reader, which restates the question and plans the
 * solution; `tutor` is the solver, at the board. The ids predate those names
 * and are kept because traces and tool allowlists are keyed on them.
 */
export const AGENT_IDS = ['planner', 'tutor', 'repairer'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'compatible',
  'mock',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const SUBJECT_LABELS: Record<SubjectId, string> = {
  math: 'Math',
  physics: 'Physics',
  chemistry: 'Chemistry',
  cs: 'Computer science',
  biology: 'Biology',
  finance: 'Finance',
  psychology: 'Psychology',
  general: 'Any other subject',
};

/** §16 — one accent per subject, used for headings, active rail item, key boxes. */
export const SUBJECT_ACCENTS: Record<SubjectId, string> = {
  math: '#4C6EF5',
  physics: '#E8590C',
  chemistry: '#0CA678',
  cs: '#7048E8',
  biology: '#C2255C',
  finance: '#F08C00',
  psychology: '#1098AD',
  general: '#74B816',
};

export const LEVEL_LABELS: Record<Level, string> = {
  intro: 'From scratch',
  school: 'School',
  undergrad: 'Undergraduate',
  deep: 'Deep dive',
};

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Monotonic-ish clock used everywhere a timestamp is persisted. */
export const now = (): number => Date.now();

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Stable, dependency-free id. Not security-sensitive; readability wins. */
export function uid(prefix = ''): string {
  const s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${s}` : s;
}

/** Slugify a concept name so 'Chain Rule' and 'chain rule' are one record. */
export function conceptSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
