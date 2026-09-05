/**
 * BM25 over the learner's own documents (§13).
 *
 * Deliberately not embeddings. Embeddings need either an API call per chunk —
 * cost, latency, and a second key — or a 25 MB model download before the
 * learner can ask their first question. Over a personal forty-page document
 * BM25 is good enough and instant, which is the right trade for a feature
 * that exists to ground a lesson in someone's own notation.
 *
 * The optional embedding upgrade in §13 sits behind a settings toggle and is
 * additive to this, not a replacement.
 */

export const K1 = 1.5;
export const B = 0.75;

/** English stop words. A short list beats a long one for short documents. */
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'was', 'were', 'will', 'with', 'we', 'you', 'they', 'their',
  'there', 'these', 'those', 'can', 'if', 'not', 'so', 'than', 'then', 'when',
  'which', 'while', 'would', 'could', 'should', 'been', 'into', 'also',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t.length > 1 && t.length < 40 && !STOP.has(t))
    .map(stem);
}

/**
 * A crude suffix stripper, not a full Porter stemmer. It only has to make
 * "derivatives" find "derivative"; over-stemming hurts precision more than it
 * helps recall on a document this small.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ['ations', 'ation', 'ingly', 'edly', 'ies', 'ing', 'ers', 'er', 'ed', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      const base = word.slice(0, -suffix.length);
      return suffix === 'ies' ? `${base}y` : base;
    }
  }
  return word;
}

export interface Bm25Index {
  /** term → [chunkIndex, termFrequency, chunkIndex, termFrequency, …] */
  postings: Record<string, number[]>;
  docLengths: number[];
  avgLength: number;
}

export function buildIndex(chunks: { text: string }[]): Bm25Index {
  const postings: Record<string, number[]> = {};
  const docLengths: number[] = [];

  chunks.forEach((chunk, i) => {
    const terms = tokenize(chunk.text);
    docLengths.push(terms.length);

    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);

    for (const [term, tf] of counts) {
      const list = postings[term] ?? (postings[term] = []);
      list.push(i, tf);
    }
  });

  const total = docLengths.reduce((a, b) => a + b, 0);
  return {
    postings,
    docLengths,
    avgLength: docLengths.length ? total / docLengths.length : 1,
  };
}

export interface Scored {
  chunk: number;
  score: number;
}

export function search(index: Bm25Index, query: string, k: number): Scored[] {
  const terms = tokenize(query);
  if (!terms.length) return [];

  const n = index.docLengths.length;
  const scores = new Map<number, number>();

  for (const term of new Set(terms)) {
    const postings = index.postings[term];
    if (!postings) continue;

    const df = postings.length / 2;
    // The +1 inside the log keeps the idf positive for a term that appears in
    // every chunk, which otherwise scores negatively and inverts the ranking.
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));

    for (let i = 0; i < postings.length; i += 2) {
      const doc = postings[i];
      const tf = postings[i + 1];
      if (doc === undefined || tf === undefined) continue;
      const len = index.docLengths[doc] ?? index.avgLength;
      const norm = tf * (K1 + 1);
      const denom = tf + K1 * (1 - B + (B * len) / (index.avgLength || 1));
      scores.set(doc, (scores.get(doc) ?? 0) + idf * (norm / denom));
    }
  }

  return [...scores.entries()]
    .map(([chunk, score]) => ({ chunk, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * A snippet centred on wherever the query terms actually appear, rather than
 * the first 400 characters — which are usually a heading.
 */
export function snippet(text: string, query: string, max = 400): string {
  if (text.length <= max) return text;
  const terms = tokenize(query);
  const lower = text.toLowerCase();

  let best = 0;
  let bestHits = -1;
  const window = max;
  const step = Math.max(40, Math.floor(max / 4));

  for (let start = 0; start < text.length - 1; start += step) {
    const slice = lower.slice(start, start + window);
    let hits = 0;
    for (const term of terms) {
      if (slice.includes(term)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = start;
    }
  }

  const from = best === 0 ? 0 : Math.max(0, text.lastIndexOf(' ', best) + 1);
  const raw = text.slice(from, from + max);
  const prefix = from > 0 ? '…' : '';
  const suffix = from + max < text.length ? '…' : '';
  return `${prefix}${raw.trim()}${suffix}`;
}
