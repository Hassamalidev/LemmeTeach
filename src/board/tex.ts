/**
 * KaTeX rendering.
 *
 * `throwOnError` is off deliberately. A model will occasionally emit a macro
 * KaTeX does not know, and the right answer to that is to show the source in a
 * monospace box — the learner can still read it — rather than to take the
 * board down over one backslash.
 */
import katex from 'katex';

const cache = new Map<string, string>();
const MAX_CACHE = 400;

export function renderTex(tex: string, display = true): string {
  const key = `${display ? 'd' : 'i'}:${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html',
      // Chalk on a board is not a paper; a slightly larger base reads better
      // at a distance and matches the 24px board body size.
      minRuleThickness: 0.06,
    });
  } catch {
    html = `<code class="tex-fallback">${escapeHtml(tex)}</code>`;
  }

  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(key, html);
  return html;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Strip TeX down to something a screen reader can read out. KaTeX emits MathML
 * alongside the HTML, which handles most cases, but the transcript panel and
 * the aria-label want a plain string.
 */
export function texToWords(tex: string): string {
  return tex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 over $2')
    .replace(/\\sqrt\{([^{}]*)\}/g, 'the square root of $1')
    .replace(/\\int/g, ' the integral of ')
    .replace(/\\sum/g, ' the sum of ')
    .replace(/\\cdot/g, ' times ')
    .replace(/\\times/g, ' times ')
    .replace(/\\pi/g, ' pi ')
    .replace(/\\theta/g, ' theta ')
    .replace(/\\alpha/g, ' alpha ')
    .replace(/\\beta/g, ' beta ')
    .replace(/\\Delta/g, ' delta ')
    .replace(/\^2/g, ' squared ')
    .replace(/\^3/g, ' cubed ')
    .replace(/[{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Inline notation
 * ------------------------------------------------------------------ */

/**
 * Does this text want typesetting?
 *
 * The board's `math` and `derive` operations are display-level, so until now
 * there was no way at all to write notation *inside* a line — a table cell, a
 * bullet, a sentence. Models put LaTeX there anyway, because there is nowhere
 * else for it to go, and it rendered as raw backslashes on the board.
 *
 * Two forms are recognised: an explicit `$…$` span, and a bare TeX command,
 * which is what a model reaches for unprompted. Deliberately conservative —
 * "3 + 4 = 7" and "du = dx" are ordinary text and must stay that way.
 */
const TEX_COMMAND = /\\[a-zA-Z]{2,}|\\[,;!]|[_^]\{|\^\d/;
const DOLLAR_SPAN = /\$[^$]+\$/;

export function looksLikeTex(text: string): boolean {
  return DOLLAR_SPAN.test(text) || TEX_COMMAND.test(text);
}

/**
 * Render a line that may mix words and notation, as HTML.
 *
 * A `$…$` span is typeset and everything around it is left as text. A line
 * with no dollars but a bare TeX command is typeset whole, which is what the
 * model meant by writing it.
 */
export function renderInline(text: string): string {
  if (!looksLikeTex(text)) return escapeHtml(text);

  if (DOLLAR_SPAN.test(text)) {
    return text
      .split(/(\$[^$]+\$)/)
      .map((part) =>
        part.startsWith('$') && part.endsWith('$') && part.length > 2
          ? renderTex(part.slice(1, -1), false)
          : escapeHtml(part),
      )
      .join('');
  }

  return renderTex(text, false);
}
