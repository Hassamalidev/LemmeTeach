/**
 * Chunking (§13).
 *
 * Roughly 800 characters with 100 of overlap, split on headings and paragraph
 * boundaries, keeping the page number so a citation can say "page 42".
 *
 * The overlap matters more than the size does: a definition that straddles a
 * chunk boundary is invisible to BM25 in both halves, and definitions are
 * exactly what gets searched for.
 */

export const TARGET_CHARS = 800;
export const OVERLAP_CHARS = 100;

export interface RawPage {
  page: number;
  text: string;
}

export interface Chunk {
  id: number;
  page: number;
  text: string;
}

/** A line that reads as a heading — worth starting a new chunk at. */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(t) && t.length < 70) return true;
  if (/^[A-Z][A-Za-z0-9 ,'’-]{2,60}$/.test(t) && !t.endsWith('.')) return true;
  return false;
}

export function chunkPages(pages: RawPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let id = 0;

  for (const page of pages) {
    const blocks = splitBlocks(page.text);
    let buffer = '';

    const flush = (): void => {
      const text = buffer.trim();
      if (text.length >= 40) chunks.push({ id: id++, page: page.page, text });
      // Carry the tail forward so a boundary never hides a definition.
      buffer = text.length > OVERLAP_CHARS ? `${tailOf(text, OVERLAP_CHARS)} ` : '';
    };

    for (const block of blocks) {
      const startsSection = isHeading(block) && buffer.trim().length > TARGET_CHARS / 2;
      if (startsSection) flush();

      if (buffer.length + block.length > TARGET_CHARS && buffer.trim().length >= 200) {
        flush();
      }

      // A single block longer than a chunk gets cut on sentence boundaries.
      if (block.length > TARGET_CHARS * 1.5) {
        for (const sentence of splitSentences(block)) {
          if (buffer.length + sentence.length > TARGET_CHARS && buffer.trim().length >= 200) {
            flush();
          }
          buffer += `${sentence} `;
        }
      } else {
        buffer += `${block}\n`;
      }
    }

    const rest = buffer.trim();
    if (rest.length >= 40) chunks.push({ id: id++, page: page.page, text: rest });
  }

  return chunks;
}

function splitBlocks(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

/** The last `n` characters, cut back to a word boundary. */
function tailOf(text: string, n: number): string {
  const slice = text.slice(-n);
  const space = slice.indexOf(' ');
  return space === -1 ? slice : slice.slice(space + 1);
}
