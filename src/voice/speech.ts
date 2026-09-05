/**
 * Speech synthesis and narration progress (§14).
 *
 * Two jobs: say the narration, and report how far through it we are so the
 * board can reveal in step. Both have to work when there is no speech engine
 * at all, because muted mode must be *fully* usable — anyone in a library, or
 * on a browser without synthesis, gets the entire lesson.
 *
 * The single most common bug in this design is queued utterances talking over
 * each other, so there is exactly one place that starts speech and exactly one
 * that stops it, and `cancel()` is called on every teardown path: pause, step
 * change, interruption, abort, unmount.
 */

export interface SpeechProgress {
  /** 0..1 through the current narration. */
  progress: number;
  done: boolean;
}

export interface SpeakOptions {
  rate: number;
  voiceName: string | null;
  muted: boolean;
  onProgress: (p: SpeechProgress) => void;
}

/** Words per minute at rate 1, used to size the fallback timer. */
const BASE_WPM = 165;

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Chrome's getVoices() is empty until `voiceschanged` fires, and some browsers
 * never fire it at all — so this resolves on whichever comes first, a
 * populated list or a short timeout.
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechAvailable()) return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, 1200);
  });
}

export function pickVoice(
  voices: SpeechSynthesisVoice[],
  preferredName: string | null,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  // A local voice avoids a network round trip per utterance and keeps working
  // offline, which matters for replay mode.
  const localMatch = voices.find((v) => v.localService && v.lang === lang);
  if (localMatch) return localMatch;
  const langMatch = voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
  return langMatch ?? voices[0] ?? null;
}

/**
 * Split narration into sentences. Chrome cuts an utterance off after roughly
 * fifteen seconds when the tab is backgrounded, and short utterances also give
 * finer reveal sync — so this is both a workaround and an improvement.
 */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z“"'(])/);
  const out: string[] = [];
  for (const part of parts) {
    if (part.length <= 240) {
      out.push(part);
      continue;
    }
    // A very long sentence still has to be broken up, so fall back to commas.
    let buf = '';
    for (const chunk of part.split(/,\s*/)) {
      if ((buf + chunk).length > 200 && buf) {
        out.push(buf.trim());
        buf = '';
      }
      buf += (buf ? ', ' : '') + chunk;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter(Boolean);
}

export function estimateDurationMs(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(900, (words / (BASE_WPM * rate)) * 60_000);
}

type Cleanup = () => void;

/**
 * One narration in progress. Created by `speak`, and the only thing that can
 * be cancelled — there is never more than one alive.
 */
export class Narration {
  private cancelled = false;
  private cleanups: Cleanup[] = [];
  private raf = 0;
  private timer = 0;

  constructor(private onProgress: (p: SpeechProgress) => void) {}

  private report(progress: number, done: boolean): void {
    if (this.cancelled) return;
    this.onProgress({ progress: Math.max(0, Math.min(1, progress)), done });
  }

  /** Drives progress from a clock. Used when muted, and as the boundary fallback. */
  runTimer(durationMs: number, from = 0): void {
    const started = performance.now();
    const tick = (): void => {
      if (this.cancelled) return;
      const elapsed = performance.now() - started;
      const p = from + (1 - from) * Math.min(1, elapsed / durationMs);
      if (p >= 1) {
        this.report(1, true);
        return;
      }
      this.report(p, false);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.cleanups.push(() => cancelAnimationFrame(this.raf));
  }

  track(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  setTimeout(fn: () => void, ms: number): void {
    this.timer = window.setTimeout(fn, ms);
    this.cleanups.push(() => window.clearTimeout(this.timer));
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  reportProgress(progress: number, done: boolean): void {
    this.report(progress, done);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    if (speechAvailable()) window.speechSynthesis.cancel();
  }
}

let active: Narration | null = null;

/** Stops whatever is speaking. Safe to call at any time, from any path. */
export function cancelSpeech(): void {
  active?.cancel();
  active = null;
  if (speechAvailable()) window.speechSynthesis.cancel();
}

/**
 * Speak `text`, reporting progress as it goes. Returns the narration so the
 * caller can cancel it; starting a new one always cancels the previous.
 */
export function speak(text: string, opts: SpeakOptions): Narration {
  cancelSpeech();

  const narration = new Narration(opts.onProgress);
  active = narration;

  const totalMs = estimateDurationMs(text, opts.rate);

  // Muted, or no engine at all: the board still advances on a timer sized to
  // the narration, and the transcript panel carries the words (§14).
  if (opts.muted || !speechAvailable()) {
    narration.runTimer(totalMs);
    return narration;
  }

  const sentences = splitSentences(text);
  const totalChars = Math.max(1, sentences.reduce((n, s) => n + s.length, 0));
  const voices = window.speechSynthesis.getVoices();
  const voice = pickVoice(voices, opts.voiceName);

  let charsDone = 0;
  let index = 0;
  let sawBoundary = false;

  const speakNext = (): void => {
    if (narration.isCancelled) return;
    const sentence = sentences[index];
    if (sentence === undefined) {
      narration.reportProgress(1, true);
      active = null;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = opts.rate;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    const base = charsDone / totalChars;
    const span = sentence.length / totalChars;

    utterance.onboundary = (e: SpeechSynthesisEvent) => {
      sawBoundary = true;
      const within = sentence.length ? e.charIndex / sentence.length : 0;
      narration.reportProgress(base + span * within, false);
    };

    utterance.onend = () => {
      charsDone += sentence.length;
      index += 1;
      narration.reportProgress(charsDone / totalChars, false);
      speakNext();
    };

    utterance.onerror = () => {
      // A refused or interrupted utterance must not strand the lesson: fall
      // through to the timer so the board keeps moving.
      if (narration.isCancelled) return;
      narration.runTimer(totalMs * (1 - base), base);
    };

    window.speechSynthesis.speak(utterance);
  };

  speakNext();

  // Safari is unreliable about `boundary`, and some Android voices fire it
  // once. If nothing has arrived shortly after starting, drive the reveal from
  // the clock instead and let speech run alongside.
  narration.setTimeout(() => {
    if (!sawBoundary && !narration.isCancelled) narration.runTimer(totalMs);
  }, 900);

  narration.track(() => {
    if (speechAvailable()) window.speechSynthesis.cancel();
  });

  return narration;
}
