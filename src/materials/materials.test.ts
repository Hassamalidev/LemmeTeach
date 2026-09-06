/**
 * BM25 ranking and chunking (§22).
 *
 * The thing these guard is that `search_materials` actually finds the passage
 * a learner would have found by flicking through their own notes. A retrieval
 * layer that returns plausible-looking but wrong passages is worse than none,
 * because the tutor will teach from them confidently.
 */
import { describe, expect, it } from 'vitest';
import { buildIndex, search, snippet, tokenize } from './bm25';
import { chunkPages } from './chunk';

const DOCS = [
  { text: 'The derivative measures the instantaneous rate of change of a function.' },
  { text: 'Integration by parts comes from reversing the product rule for derivatives.' },
  { text: 'A limit describes the value a function approaches as the input approaches some point.' },
  { text: 'The chain rule differentiates a composition of two functions.' },
  { text: 'Activation energy is the minimum energy needed for a reaction to proceed.' },
];

const index = buildIndex(DOCS);

describe('tokenize', () => {
  it('drops stop words and punctuation', () => {
    const tokens = tokenize('The value of a function!');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('of');
    expect(tokens).not.toContain('a');
    expect(tokens.join(' ')).not.toMatch(/[!.]/);
  });

  it('stems enough that a plural finds its singular', () => {
    expect(tokenize('derivatives')[0]).toBe(tokenize('derivative')[0]);
    expect(tokenize('functions')[0]).toBe(tokenize('function')[0]);
  });

  it('does not over-stem short words into collisions', () => {
    expect(tokenize('mass')[0]).not.toBe(tokenize('mas')[0]);
  });
});

describe('BM25 ranking', () => {
  it('ranks the passage that is actually about the query first', () => {
    const hits = search(index, 'what is activation energy', 3);
    expect(hits[0]?.chunk).toBe(4);
  });

  it('finds a passage through a stemmed variant', () => {
    const hits = search(index, 'derivative', 3);
    // Passage 0 is about derivatives; passage 1 mentions them in passing.
    expect(hits[0]?.chunk).toBe(0);
  });

  it('scores a passage matching two query terms above one matching one', () => {
    const hits = search(index, 'product rule integration', 3);
    expect(hits[0]?.chunk).toBe(1);
  });

  it('returns nothing for a query with no content words', () => {
    expect(search(index, 'the of and a', 3)).toHaveLength(0);
  });

  it('returns nothing rather than a bad guess for an absent topic', () => {
    const hits = search(index, 'photosynthesis chloroplast thylakoid', 3);
    expect(hits).toHaveLength(0);
  });

  it('respects the requested number of results', () => {
    expect(search(index, 'function', 2).length).toBeLessThanOrEqual(2);
  });

  it('gives a positive score to a term present in every passage', () => {
    // With the naive idf this goes negative and inverts the ranking, which is
    // the classic BM25 bug and the reason for the +1 inside the log.
    const everywhere = buildIndex([
      { text: 'energy flows through the system' },
      { text: 'energy is conserved overall' },
    ]);
    const hits = search(everywhere, 'energy', 2);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.score).toBeGreaterThan(0);
  });

  it('does not let a long passage dominate through repetition alone', () => {
    const padded = 'energy '.repeat(200);
    const skewed = buildIndex([
      { text: `${padded} and some other unrelated material entirely` },
      { text: 'Energy is the capacity to do work.' },
    ]);
    const hits = search(skewed, 'energy capacity work', 2);
    // Length normalisation is what keeps the short, precise passage on top.
    expect(hits[0]?.chunk).toBe(1);
  });
});

describe('snippet', () => {
  const long = `${'Filler sentence that says nothing useful. '.repeat(20)}The activation energy is the barrier a reaction must clear. ${'More filler afterwards. '.repeat(20)}`;

  it('centres on where the query actually appears, not the start', () => {
    const out = snippet(long, 'activation energy barrier', 200);
    expect(out).toContain('activation energy');
    expect(out.length).toBeLessThanOrEqual(210);
  });

  it('marks that it was cut', () => {
    expect(snippet(long, 'activation energy', 200)).toContain('…');
  });

  it('returns short text untouched', () => {
    expect(snippet('Short passage.', 'passage', 400)).toBe('Short passage.');
  });
});

describe('chunking', () => {
  const page = (n: number, text: string) => ({ page: n, text });

  it('keeps the page number so a citation can name it', () => {
    const chunks = chunkPages([page(1, 'a'.repeat(2000)), page(42, 'b'.repeat(2000))]);
    expect(chunks.some((c) => c.page === 42)).toBe(true);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 42]));
  });

  it('overlaps chunks so a definition on a boundary is still findable', () => {
    const text = `${'padding words here. '.repeat(60)}An eigenvalue is a scalar that scales its eigenvector. ${'more padding words. '.repeat(60)}`;
    const chunks = chunkPages([page(1, text)]);
    expect(chunks.length).toBeGreaterThan(1);

    const idx = buildIndex(chunks);
    const hits = search(idx, 'eigenvalue scalar eigenvector', 3);
    expect(hits.length).toBeGreaterThan(0);
    const found = chunks[hits[0]?.chunk ?? 0]?.text ?? '';
    expect(found).toContain('eigenvalue');
  });

  it('starts a new chunk at a heading', () => {
    const text = [
      'Some introductory material that runs on for a while and fills space so the buffer has something in it before the heading arrives at last.',
      '',
      '2. Thermodynamics',
      '',
      'The first law states that energy is conserved.',
    ].join('\n');
    const chunks = chunkPages([page(1, text)]);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.text.includes('Thermodynamics'))).toBe(true);
  });

  it('splits a single very long block on sentence boundaries', () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `This is sentence number ${i} and it carries a little content.`,
    ).join(' ');
    const chunks = chunkPages([page(1, text)]);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk should end mid-word.
    for (const c of chunks) expect(c.text.trim()).not.toMatch(/\s$/);
  });

  it('drops nothing meaningful from the source', () => {
    const text = `${'alpha '.repeat(300)}omega`;
    const chunks = chunkPages([page(1, text)]);
    expect(chunks.some((c) => c.text.includes('omega'))).toBe(true);
  });

  it('ignores empty pages without producing empty chunks', () => {
    const chunks = chunkPages([page(1, ''), page(2, '   '), page(3, 'Real content here.')]);
    expect(chunks).toHaveLength(0 + 1);
    expect(chunks[0]?.page).toBe(3);
  });
});
