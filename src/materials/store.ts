/**
 * The materials store: ingest, search, evict (§13, §20).
 *
 * Uploaded material never leaves the browser except as the retrieved snippets
 * that go into prompts the learner's own key is paying for. That is stated on
 * the upload screen, and it is true because there is nowhere else for it to go.
 */
import { uid } from '../core/types';
import type { MaterialDoc } from '../memory/types';
import { allMaterials, deleteMaterial, saveMaterial } from '../storage/db';
import { search as bm25Search, snippet } from './bm25';
import type { IngestRequest, IngestResponse } from './ingest.worker';
import type { MaterialsPort } from '../tools/context';

export const LIMITS = { totalBytes: 20 * 1024 * 1024, documents: 10 };

export interface IngestProgress {
  message: string;
  fraction: number;
}

export class MaterialsStore implements MaterialsPort {
  private cache: MaterialDoc[] | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.cache = null;
    for (const fn of this.listeners) fn();
  }

  async list(): Promise<MaterialDoc[]> {
    if (!this.cache) this.cache = await allMaterials();
    return this.cache;
  }

  async remove(id: string): Promise<void> {
    await deleteMaterial(id);
    this.changed();
  }

  /**
   * Parse, chunk and index a file. Returns the stored document, or throws with
   * a message written for the person who dropped the file in.
   */
  async ingest(
    file: File | { name: string; text: string },
    onProgress?: (p: IngestProgress) => void,
  ): Promise<MaterialDoc> {
    const existing = await this.list();
    await this.evictIfNeeded(existing);

    const id = uid('doc');
    const isFile = file instanceof File;
    const name = file.name;

    const kind: 'text' | 'pdf' =
      isFile && (file.type === 'application/pdf' || /\.pdf$/i.test(name)) ? 'pdf' : 'text';

    const request: IngestRequest = { id, name, kind };
    if (kind === 'pdf' && isFile) {
      request.bytes = await file.arrayBuffer();
    } else {
      request.text = isFile ? await file.text() : file.text;
    }

    const bytes = request.bytes?.byteLength ?? (request.text?.length ?? 0);
    if (bytes > LIMITS.totalBytes) {
      throw new Error(
        `That file is ${(bytes / 1024 / 1024).toFixed(1)} MB, and the limit is ${LIMITS.totalBytes / 1024 / 1024} MB. Try a single chapter rather than a whole book.`,
      );
    }

    const result = await this.runWorker(request, onProgress);

    const doc: MaterialDoc = {
      id,
      title: result.title,
      addedAt: Date.now(),
      bytes,
      pageCount: result.pageCount,
      chunks: result.chunks,
      postings: result.postings,
      docLengths: result.docLengths,
      avgLength: result.avgLength,
    };

    await saveMaterial(doc);
    this.changed();
    return doc;
  }

  private runWorker(
    request: IngestRequest,
    onProgress?: (p: IngestProgress) => void,
  ): Promise<Extract<IngestResponse, { t: 'done' }>> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./ingest.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (e: MessageEvent<IngestResponse>) => {
        const msg = e.data;
        if (msg.t === 'progress') {
          onProgress?.({ message: msg.message, fraction: msg.fraction });
          return;
        }
        worker.terminate();
        if (msg.t === 'error') reject(new Error(msg.message));
        else resolve(msg);
      };

      worker.onerror = () => {
        worker.terminate();
        reject(new Error('That file could not be read in this browser.'));
      };

      // Transfer the buffer rather than copying it: a 20 MB PDF copied across
      // the worker boundary is a visible pause on a slow machine.
      const transfer = request.bytes ? [request.bytes] : [];
      worker.postMessage(request, transfer);
    });
  }

  /** Oldest out first, and never silently (§20). */
  private async evictIfNeeded(docs: MaterialDoc[]): Promise<void> {
    const sorted = [...docs].sort((a, b) => a.addedAt - b.addedAt);
    let total = sorted.reduce((n, d) => n + d.bytes, 0);

    while (sorted.length >= LIMITS.documents || total > LIMITS.totalBytes) {
      const oldest = sorted.shift();
      if (!oldest) break;
      await deleteMaterial(oldest.id);
      total -= oldest.bytes;
      this.notify(`Removed "${oldest.title}" to make room — Chalk keeps ${LIMITS.documents} documents.`);
    }
  }

  async search(
    query: string,
    k: number,
    docId?: string,
  ): Promise<{ docId: string; title: string; page: number; snippet: string; score: number }[]> {
    const docs = (await this.list()).filter((d) => !docId || d.id === docId);
    const hits: { docId: string; title: string; page: number; snippet: string; score: number }[] = [];

    for (const doc of docs) {
      const scored = bm25Search(
        { postings: doc.postings, docLengths: doc.docLengths, avgLength: doc.avgLength },
        query,
        k,
      );
      for (const s of scored) {
        const chunk = doc.chunks[s.chunk];
        if (!chunk) continue;
        hits.push({
          docId: doc.id,
          title: doc.title,
          page: chunk.page,
          snippet: snippet(chunk.text, query),
          score: s.score,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  private notify(message: string): void {
    for (const fn of this.noticeListeners) fn(message);
  }

  private noticeListeners = new Set<(m: string) => void>();

  onNotice(fn: (m: string) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }
}

export const materialsStore = new MaterialsStore();
