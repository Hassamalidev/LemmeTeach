/**
 * Board surfaces (§16).
 *
 * Two themes, both grounded in a real classroom surface rather than generic
 * app chrome. The board never sits inside a rounded card with a drop shadow —
 * it is the product, and it should read as the thing being written on.
 *
 * Colours are emitted as CSS custom properties so switching theme is a
 * variable swap, not a re-render of every op.
 */
import type { SubjectId } from '../core/types';
import { SUBJECT_ACCENTS } from '../core/types';
import type { BoardTheme } from '../storage/settings';

export interface ThemeTokens {
  bg: string;
  /** Primary writing colour. */
  ink: string;
  /** Secondary text: notes, captions, axis labels. */
  inkDim: string;
  /** Faint structural lines — rules, axes, table borders. */
  rule: string;
  /** Background of the boxed `key` takeaway. */
  keyBg: string;
  warn: string;
  /** Panel behind code blocks. */
  codeBg: string;
  /** Shiki theme name for `code` ops. */
  shiki: string;
  /** How much stroke roughness to apply; 0 on paper, higher on slate. */
  dust: number;
  /** A faint ruled grid, or none. */
  grid: string | null;
}

export const THEMES: Record<BoardTheme, ThemeTokens> = {
  slate: {
    bg: '#122019',
    ink: '#F2EFE6',
    inkDim: '#A9B5AC',
    rule: 'rgba(242, 239, 230, 0.22)',
    keyBg: 'rgba(242, 239, 230, 0.07)',
    warn: '#FFB55C',
    codeBg: 'rgba(0, 0, 0, 0.28)',
    shiki: 'github-dark',
    dust: 1,
    grid: null,
  },
  paper: {
    bg: '#FBFAF7',
    ink: '#1A2233',
    inkDim: '#5C6679',
    rule: 'rgba(26, 34, 51, 0.18)',
    keyBg: 'rgba(26, 34, 51, 0.05)',
    warn: '#B54708',
    codeBg: 'rgba(26, 34, 51, 0.04)',
    shiki: 'github-light',
    dust: 0,
    grid: 'rgba(26, 34, 51, 0.055)',
  },
};

export function themeVars(theme: BoardTheme, subject: SubjectId): Record<string, string> {
  const t = THEMES[theme];
  const accent = SUBJECT_ACCENTS[subject];
  return {
    '--board-bg': t.bg,
    '--board-ink': t.ink,
    '--board-ink-dim': t.inkDim,
    '--board-rule': t.rule,
    '--board-key-bg': t.keyBg,
    '--board-warn': t.warn,
    '--board-code-bg': t.codeBg,
    '--board-accent': accent,
    // On slate the raw accent is too saturated against a dark green; lifting it
    // toward the chalk keeps it legible without losing the subject identity.
    '--board-accent-soft': theme === 'slate' ? mix(accent, t.ink, 0.35) : mix(accent, t.bg, 0.12),
    '--board-dust': String(t.dust),
  };
}

export function shikiTheme(theme: BoardTheme): string {
  return THEMES[theme].shiki;
}

export function gridFor(theme: BoardTheme): string | null {
  return THEMES[theme].grid;
}

/** Blend two hex colours. Small enough not to justify a colour library. */
function mix(a: string, b: string, amount: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hex(s: string): number[] {
  const h = s.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
