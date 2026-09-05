/**
 * The sandbox host (§11).
 *
 * Creates the isolated frame, hands it the worker source, and relays runs over
 * postMessage. Everything here degrades: if the frame will not load, or
 * Pyodide is blocked by a network policy, `available()` goes false, the tutor
 * is told so in its system prompt, and the lesson carries on without code.
 * Teaching must never depend on the sandbox.
 */
import { uid } from '../core/types';
import type { SandboxPort, SandboxResult } from '../tools/context';

const FRAME_URL = new URL('sandbox.html', document.baseURI).toString();
const WORKER_URL = new URL('sandbox-worker.js', document.baseURI).toString();
const TIMEOUT_MS = 10_000;

interface Pending {
  resolve: (r: SandboxResult) => void;
  timer: number;
}

export class SandboxHost implements SandboxPort {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<boolean> | null = null;
  private pending = new Map<string, Pending>();
  private failed: string | null = null;
  private onProgress?: (message: string) => void;
  /** Seeded per lesson so a replayed tape produces identical figures (§11). */
  private seed = 1;

  constructor(private pyodideBaseUrl: string) {}

  setProgressHandler(fn: (message: string) => void): void {
    this.onProgress = fn;
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0 || 1;
  }

  available(): boolean {
    return this.failed === null;
  }

  unavailableReason(): string {
    return this.failed ?? '';
  }

  /**
   * Boots the frame on first use rather than at startup: a learner who never
   * triggers `run_code` should never pay for the frame at all.
   */
  private boot(): Promise<boolean> {
    if (this.ready) return this.ready;

    this.ready = new Promise<boolean>((resolve) => {
      if (typeof document === 'undefined') {
        this.failed = 'there is no document to host the sandbox in.';
        resolve(false);
        return;
      }

      const frame = document.createElement('iframe');
      // No allow-same-origin: the frame runs on an opaque origin and cannot
      // reach the app's storage, its DOM, or the learner's key.
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Code sandbox');
      frame.style.cssText =
        'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
      frame.src = FRAME_URL;

      const timeout = window.setTimeout(() => {
        this.failed = 'the sandbox frame did not load.';
        resolve(false);
      }, 8000);

      const onMessage = (e: MessageEvent): void => {
        if (e.source !== frame.contentWindow) return;
        const data = e.data as { type?: string; id?: string; result?: SandboxResult; message?: string };

        if (data.type === 'chalk-sandbox-frame-loaded') {
          // The frame cannot fetch across its opaque origin, so the worker
          // source is fetched here and handed over.
          void fetch(WORKER_URL)
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
            .then((source) => {
              frame.contentWindow?.postMessage({ type: 'chalk-sandbox-init', source }, '*');
            })
            .catch(() => {
              window.clearTimeout(timeout);
              this.failed = 'the sandbox worker could not be loaded.';
              resolve(false);
            });
          return;
        }

        if (data.type === 'chalk-sandbox-ready') {
          window.clearTimeout(timeout);
          resolve(true);
          return;
        }

        if (data.type === 'chalk-sandbox-progress' && data.message) {
          this.onProgress?.(data.message);
          return;
        }

        if (data.type === 'chalk-sandbox-result' && data.id) {
          const p = this.pending.get(data.id);
          if (!p) return;
          this.pending.delete(data.id);
          window.clearTimeout(p.timer);
          p.resolve(normalize(data.result));
        }
      };

      window.addEventListener('message', onMessage);
      document.body.appendChild(frame);
      this.frame = frame;
    });

    return this.ready;
  }

  async run(
    language: 'python' | 'javascript',
    source: string,
    signal: AbortSignal,
  ): Promise<SandboxResult> {
    const ok = await this.boot();
    if (!ok || !this.frame?.contentWindow) {
      return {
        ok: false,
        stdout: '',
        result: '',
        figures: [],
        timedOut: false,
        error: this.failed ?? 'the sandbox is unavailable.',
      };
    }

    const id = uid('run');

    return new Promise<SandboxResult>((resolve) => {
      // Belt and braces on top of the frame's own timer: if the frame itself
      // has wedged, the promise still settles rather than hanging the lesson.
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false,
          stdout: '',
          result: '',
          figures: [],
          timedOut: true,
        });
      }, TIMEOUT_MS + 4000);

      this.pending.set(id, { resolve, timer });

      const onAbort = (): void => {
        this.frame?.contentWindow?.postMessage({ type: 'chalk-sandbox-halt' }, '*');
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this.frame?.contentWindow?.postMessage(
        {
          type: 'chalk-sandbox-run',
          id,
          language,
          source,
          seed: this.seed,
          timeoutMs: TIMEOUT_MS,
          pyodideBaseUrl: this.pyodideBaseUrl,
        },
        '*',
      );
    });
  }

  /** Tear the frame down: on abort, on unmount, and when a lesson ends. */
  dispose(): void {
    for (const [, p] of this.pending) {
      window.clearTimeout(p.timer);
      p.resolve({ ok: false, stdout: '', result: '', figures: [], timedOut: false, error: 'Stopped.' });
    }
    this.pending.clear();
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
  }
}

function normalize(result: SandboxResult | undefined): SandboxResult {
  return {
    ok: Boolean(result?.ok),
    stdout: result?.stdout ?? '',
    result: result?.result ?? '',
    figures: Array.isArray(result?.figures) ? result.figures : [],
    timedOut: Boolean(result?.timedOut),
    error: result?.error,
  };
}

/** Used when the sandbox is switched off, so the port always exists. */
export class DisabledSandbox implements SandboxPort {
  constructor(private reason = 'code execution is switched off for this session.') {}
  available(): boolean {
    return false;
  }
  unavailableReason(): string {
    return this.reason;
  }
  async run(): Promise<SandboxResult> {
    return { ok: false, stdout: '', result: '', figures: [], timedOut: false, error: this.reason };
  }
}
