/**
 * Inline notation on the board.
 *
 * The board's `math` and `derive` operations are display-level, so a model
 * with notation to put inside a table cell or a bullet had nowhere to put it
 * and wrote raw LaTeX. Running the app is what surfaced that: a table cell
 * reading a literal backslash-c-o-s on the finished board.
 */
import { describe, expect, it } from 'vitest';
import { looksLikeTex, renderInline, texToWords } from './tex';

describe('looksLikeTex', () => {
  it('recognises a bare TeX command', () => {
    expect(looksLikeTex('\\cos x\\,dx')).toBe(true);
    expect(looksLikeTex('\\frac{d}{dx}')).toBe(true);
    expect(looksLikeTex('x^{2}')).toBe(true);
    expect(looksLikeTex('x^2')).toBe(true);
  });

  it('recognises a dollar span', () => {
    expect(looksLikeTex('the derivative $2x$ here')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    // These are the cells that must NOT be typeset — over-eager detection
    // turns a readable table into a wall of italics.
    expect(looksLikeTex('du = dx')).toBe(false);
    expect(looksLikeTex('3 + 4 = 7')).toBe(false);
    expect(looksLikeTex('too small, go right')).toBe(false);
    expect(looksLikeTex('cytoplasm')).toBe(false);
    expect(looksLikeTex('1 000 000')).toBe(false);
    expect(looksLikeTex('mitochondrial matrix')).toBe(false);
  });
});

describe('renderInline', () => {
  it('typesets a bare TeX line', () => {
    const html = renderInline('\\cos x\\,dx');
    expect(html).toContain('katex');
    expect(html).not.toContain('\\cos');
  });

  it('typesets only the dollar spans, keeping the words around them', () => {
    const html = renderInline('the derivative $2x$ is linear');
    expect(html).toContain('katex');
    expect(html).toContain('the derivative ');
    expect(html).toContain(' is linear');
  });

  it('escapes ordinary text rather than trusting it as HTML', () => {
    const html = renderInline('a < b and <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
  });

  it('does not typeset something that only looks numeric', () => {
    expect(renderInline('du = dx')).toBe('du = dx');
  });

  it('survives a malformed expression instead of throwing', () => {
    expect(() => renderInline('\\frac{a}{')).not.toThrow();
  });
});

describe('texToWords', () => {
  it('turns notation into something a screen reader can say', () => {
    expect(texToWords('\\frac{d}{dx}')).toContain('over');
    expect(texToWords('x^2')).toContain('squared');
    expect(texToWords('\\int')).toContain('integral');
  });
});
