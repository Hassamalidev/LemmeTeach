/**
 * Syntax highlighting for `code` ops.
 *
 * Shiki's default entry point pulls in every grammar it ships — around three
 * hundred lazy chunks, most of which nothing in a lesson will ever ask for.
 * This builds a fine-grained highlighter from an explicit language list
 * instead, and uses the JavaScript regex engine so there is no Oniguruma WASM
 * download either.
 *
 * The whole thing is loaded on first use. The first snippet of a session
 * renders as plain text for a beat and then upgrades, which is the right trade:
 * waiting on a highlighter would stall the board mid-lesson, and unhighlighted
 * code is perfectly readable.
 */
import type { BoardTheme } from '../storage/settings';
import { shikiTheme } from './themes';
import { escapeHtml } from './tex';

type Highlighter = {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
};

/**
 * The languages a lesson plausibly needs. Adding one is a one-line import;
 * shipping all three hundred to save that line is not a trade worth making.
 */
const LANGS = [
  'python',
  'javascript',
  'typescript',
  'c',
  'cpp',
  'java',
  'rust',
  'go',
  'sql',
  'haskell',
  'r',
  'matlab',
  'bash',
  'json',
] as const;

const ALIASES: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  'c++': 'cpp',
  cxx: 'cpp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  golang: 'go',
  rs: 'rust',
  octave: 'matlab',
  plaintext: 'text',
  pseudocode: 'text',
  pseudo: 'text',
  txt: 'text',
};

let loading: Promise<Highlighter | null> | null = null;
let highlighter: Highlighter | null = null;

/** 'text' is not a grammar — it is the signal to render unhighlighted. */
export function normalizeLang(lang: string): string {
  const l = lang.toLowerCase().trim();
  const aliased = ALIASES[l] ?? l;
  return (LANGS as readonly string[]).includes(aliased) ? aliased : 'text';
}

export async function getHighlighter(): Promise<Highlighter | null> {
  if (highlighter) return highlighter;
  if (!loading) {
    loading = buildHighlighter().catch(() => null);
  }
  return loading;
}

async function buildHighlighter(): Promise<Highlighter | null> {
  const [core, engine, dark, light, ...langs] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/themes/github-dark.mjs'),
    import('shiki/themes/github-light.mjs'),
    import('shiki/langs/python.mjs'),
    import('shiki/langs/javascript.mjs'),
    import('shiki/langs/typescript.mjs'),
    import('shiki/langs/c.mjs'),
    import('shiki/langs/cpp.mjs'),
    import('shiki/langs/java.mjs'),
    import('shiki/langs/rust.mjs'),
    import('shiki/langs/go.mjs'),
    import('shiki/langs/sql.mjs'),
    import('shiki/langs/haskell.mjs'),
    import('shiki/langs/r.mjs'),
    import('shiki/langs/matlab.mjs'),
    import('shiki/langs/bash.mjs'),
    import('shiki/langs/json.mjs'),
  ]);

  const hl = await core.createHighlighterCore({
    themes: [dark, light],
    langs,
    // Forgiving keeps a grammar the JS engine cannot fully express from
    // throwing; the worst case is slightly imperfect highlighting.
    engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
  });

  highlighter = hl as unknown as Highlighter;
  return highlighter;
}

export function plainCodeHtml(src: string): string {
  return `<pre class="shiki-plain"><code>${escapeHtml(src)}</code></pre>`;
}

export async function highlight(src: string, lang: string, theme: BoardTheme): Promise<string> {
  const normalized = normalizeLang(lang);
  if (normalized === 'text') return plainCodeHtml(src);

  const hl = await getHighlighter();
  if (!hl) return plainCodeHtml(src); // No highlighting is a degradation, not a failure.

  try {
    return hl.codeToHtml(src, { lang: normalized, theme: shikiTheme(theme) });
  } catch {
    return plainCodeHtml(src);
  }
}
