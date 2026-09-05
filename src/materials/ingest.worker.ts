/**
 * Material ingestion, in a worker (§13).
 *
 * A 300-page PDF must not freeze the UI, so parsing, chunking and index
 * building all happen off the main thread. The worker reports progress, so
 * the upload screen can say what is happening rather than showing a spinner.
 */
import { chunkPages, type Chunk, type RawPage } from './chunk';
import { buildIndex } from './bm25';

export interface IngestRequest {
  id: string;
  name: string;
  kind: 'text' | 'pdf';
  /** Text content, or the PDF bytes. */
  text?: string;
  bytes?: ArrayBuffer;
}

export type IngestResponse =
  | { t: 'progress'; id: string; message: string; fraction: number }
  | {
      t: 'done';
      id: string;
      title: string;
      pageCount: number;
      chunks: Chunk[];
      postings: Record<string, number[]>;
      docLengths: number[];
      avgLength: number;
    }
  | { t: 'error'; id: string; message: string };

function post(message: IngestResponse): void {
  self.postMessage(message);
}

self.onmessage = async (e: MessageEvent<IngestRequest>) => {
  const req = e.data;
  try {
    const pages =
      req.kind === 'pdf' && req.bytes
        ? await readPdf(req.id, req.bytes)
        : [{ page: 1, text: req.text ?? '' }];

    post({ t: 'progress', id: req.id, message: 'Splitting into passages', fraction: 0.7 });
    const chunks = chunkPages(pages);

    if (chunks.length === 0) {
      post({
        t: 'error',
        id: req.id,
        message: 'No readable text was found. A scanned PDF needs to be run through OCR first.',
      });
      return;
    }

    post({ t: 'progress', id: req.id, message: 'Building the search index', fraction: 0.9 });
    const index = buildIndex(chunks);

    post({
      t: 'done',
      id: req.id,
      title: cleanTitle(req.name),
      pageCount: pages.length,
      chunks,
      postings: index.postings,
      docLengths: index.docLengths,
      avgLength: index.avgLength,
    });
  } catch (err) {
    post({
      t: 'error',
      id: req.id,
      message: err instanceof Error ? err.message : 'That file could not be read.',
    });
  }
};

async function readPdf(id: string, bytes: ArrayBuffer): Promise<RawPage[]> {
  // Imported lazily: someone who only ever pastes text should not download a
  // PDF engine.
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc.default;

  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: RawPage[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push({ page: n, text });

    if (n % 5 === 0 || n === doc.numPages) {
      post({
        t: 'progress',
        id,
        message: `Reading page ${n} of ${doc.numPages}`,
        fraction: (n / doc.numPages) * 0.7,
      });
    }
    page.cleanup();
  }

  await doc.destroy();
  return pages;
}

function cleanTitle(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
}
