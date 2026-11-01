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
  /** The sentence being spoken, so a pause can pick up from it. */
  sentence: number;
}

export interface SpeakOptions {
  rate: number;
  voiceName: string | null;
  muted: boolean;
  onProgress: (p: SpeechProgress) => void;
  /**
   * Start from this sentence rather than the first. Used to carry on after a
   * pause, or a change of speed or voice, without saying it all again.
   */
  fromSentence?: number;
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

/* ------------------------------------------------------------------ *
 * Choosing a voice
 *
 * The same browser can offer a clean neural voice and a twenty-year-old
 * robotic one side by side, and the default is often the robot. So voices are
 * ranked, and the best one for the learner's language is used unless they
 * picked another.
 * ------------------------------------------------------------------ */

function learnerLanguage(): string {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
}

/** Higher is clearer. Built from how the engines name their voices. */
export function voiceQuality(voice: SpeechSynthesisVoice, lang = learnerLanguage()): number {
  const name = voice.name;
  let score = 0;

  // The neural voices: Edge's "Online (Natural)", Chrome's "Google", Apple's
  // premium and enhanced downloads.
  if (/natural|neural/i.test(name)) score += 60;
  if (/\b(premium|enhanced|siri)\b/i.test(name)) score += 50;
  if (/^google\b/i.test(name)) score += 40;
  if (/online/i.test(name)) score += 10;

  // The old formant and concatenative engines, which are what "robotic" means.
  if (/espeak|festival|pico|compact|flite/i.test(name)) score -= 60;
  if (/^microsoft (david|zira|mark|hazel|george|susan)\b/i.test(name) && !/natural/i.test(name)) {
    score -= 15;
  }
  // Apple's novelty voices are not for teaching.
  if (/\b(albert|bad news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|good news)\b/i.test(name)) {
    score -= 100;
  }

  if (voice.lang === lang) score += 30;
  else if (voice.lang.slice(0, 2) === lang.slice(0, 2)) score += 20;
  else score -= 200; // Another language entirely reads English badly.

  return score;
}

/** The few voices worth offering: the learner's language, clearest first. */
export function bestVoices(
  voices: SpeechSynthesisVoice[],
  max = 8,
  lang = learnerLanguage(),
): SpeechSynthesisVoice[] {
  const same = voices.filter((v) => v.lang.slice(0, 2) === lang.slice(0, 2));
  const pool = same.length ? same : voices;
  return [...pool]
    .sort((x, y) => voiceQuality(y, lang) - voiceQuality(x, lang))
    .slice(0, max);
}

/** "Microsoft Aria Online (Natural) - English (United States)" → "Aria · en-US". */
export function voiceLabel(voice: SpeechSynthesisVoice): string {
  const name = voice.name
    .replace(/^(microsoft|google|apple)\s+/i, '')
    .replace(/\s*online\s*/i, ' ')
    .replace(/\s*\((natural|enhanced|premium)\)\s*/i, ' ')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name || voice.name} · ${voice.lang}`;
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
  return bestVoices(voices, 1)[0] ?? voices[0] ?? null;
}

/** Say one sentence in a voice, so it can be judged before a lesson. */
export function previewVoice(voice: SpeechSynthesisVoice | null, rate: number): void {
  if (!speechAvailable()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    'This is how I will sound. I will explain each step as I write it on the board.',
  );
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
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
    if (part.length <= 170) {
      out.push(part);
      continue;
    }
    // A long sentence is broken at its commas. Engines drop or truncate long
    // utterances, and a break at a comma is where a speaker would breathe.
    let buf = '';
    for (const chunk of part.split(/[,;:]\s+/)) {
      if ((buf + chunk).length > 150 && buf) {
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

  /** The sentence being spoken, reported with every progress update. */
  sentence = 0;

  private report(progress: number, done: boolean): void {
    if (this.cancelled) return;
    this.onProgress({ progress: Math.max(0, Math.min(1, progress)), done, sentence: this.sentence });
  }

  /**
   * Drives progress from a clock. Used when muted, and as the boundary
   * fallback.
   *
   * `finishes` says whether the clock is allowed to end the step. When the
   * voice is muted or has failed, it is: the clock is all there is. When the
   * clock is only standing in for missing word-boundary events while the
   * voice is still speaking, it must not be — the estimate is often shorter
   * than the real speech, and ending the step on the estimate starts the next
   * one, which cuts the voice off mid-sentence. Then it stops just short and
   * waits for the voice to say it has finished.
   */
  runTimer(durationMs: number, from = 0, finishes = true): void {
    const started = performance.now();
    const tick = (): void => {
      if (this.cancelled) return;
      const elapsed = performance.now() - started;
      const p = from + (1 - from) * Math.min(1, elapsed / durationMs);
      if (p >= 1) {
        if (finishes) this.report(1, true);
        else this.report(0.97, false);
        return;
      }
      this.report(finishes ? p : Math.min(p, 0.97), false);
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

/**
 * Utterances being spoken. Chrome can garbage-collect an utterance that
 * nothing in the page refers to while it is still speaking, and then its
 * `end` event never fires: the step waits on a sentence that will never
 * finish. Holding them here until they settle prevents that.
 */
const speaking = new Set<SpeechSynthesisUtterance>();

/**
 * Narration is written for the ear, but a model sometimes lets notation
 * through. A speech engine reads "m/s" as "m slash s" and drops "°" entirely,
 * so the common cases are turned into words before they are spoken. The
 * board is not touched: this is only what the voice says.
 */
export function speakable(text: string): string {
  return (
    text
      // Markdown and LaTeX wrappers carry no sound.
      .replace(/\\[()[\]]|\$+/g, ' ')
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 over $2')
      .replace(/\\sqrt\{([^{}]*)\}/g, 'the square root of $1')
      .replace(/\\(cdot|times)\b/g, ' times ')
      .replace(/\\(pi|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|phi)\b/g, ' $1 ')
      .replace(/\\[a-zA-Z]+/g, ' ')
      .replace(/[{}]/g, ' ')
      .replace(/\*\*|__|`|#+\s/g, '')
      // Units, after a number or on their own.
      .replace(/\bm\/s(\^2|²)/g, 'metres per second squared')
      .replace(/\bm\/s\b/g, 'metres per second')
      .replace(/\bkm\/h\b/g, 'kilometres per hour')
      .replace(/\bkg\/m(\^3|³)/g, 'kilograms per cubic metre')
      .replace(/(\d)\s*°\s*C\b/g, '$1 degrees Celsius')
      .replace(/(\d)\s*°/g, '$1 degrees')
      .replace(/(\d)\s*%/g, '$1 percent')
      // Powers and roots.
      .replace(/\^2(?!\d)|²/g, ' squared')
      .replace(/\^3(?!\d)|³/g, ' cubed')
      .replace(/\^\(?(-?\w+)\)?/g, ' to the power $1')
      .replace(/√\s*/g, 'the square root of ')
      // Symbols a voice would skip or misread.
      .replace(/\s*≈\s*/g, ' approximately ')
      .replace(/\s*≠\s*/g, ' is not equal to ')
      .replace(/\s*≤\s*/g, ' is at most ')
      .replace(/\s*≥\s*/g, ' is at least ')
      .replace(/\s*(→|=>)\s*/g, ', which gives ')
      .replace(/\s*[×·]\s*/g, ' times ')
      .replace(/\s*÷\s*/g, ' divided by ')
      .replace(/\s+=\s+/g, ' equals ')
      .replace(/π/g, ' pi ')
      .replace(/θ/g, ' theta ')
      .replace(/Δ/g, ' change in ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

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
    const all = splitSentences(text);
    const from = Math.max(0, Math.min(opts.fromSentence ?? 0, all.length));
    const before = all.slice(0, from).join(' ').length;
    const share = all.length ? before / Math.max(1, all.join(' ').length) : 0;
    narration.runTimer(totalMs * (1 - share), share);
    return narration;
  }

  const sentences = splitSentences(speakable(text));
  const totalChars = Math.max(1, sentences.reduce((n, s) => n + s.length, 0));
  const voices = window.speechSynthesis.getVoices();
  const voice = pickVoice(voices, opts.voiceName);

  let index = Math.max(0, Math.min(opts.fromSentence ?? 0, sentences.length));
  let charsDone = sentences.slice(0, index).reduce((n, s) => n + s.length, 0);
  let sawBoundary = false;

  const speakNext = (): void => {
    if (narration.isCancelled) return;
    const sentence = sentences[index];
    if (sentence === undefined) {
      narration.reportProgress(1, true);
      active = null;
      return;
    }

    narration.sentence = index;
    const utterance = new SpeechSynthesisUtterance(sentence);
    speaking.add(utterance);
    narration.track(() => speaking.delete(utterance));
    utterance.rate = opts.rate;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    const base = charsDone / totalChars;
    const span = sentence.length / totalChars;

    utterance.onstart = () => {
      lastHeard = performance.now();
    };

    utterance.onboundary = (e: SpeechSynthesisEvent) => {
      sawBoundary = true;
      lastHeard = performance.now();
      const within = sentence.length ? e.charIndex / sentence.length : 0;
      narration.reportProgress(base + span * within, false);
    };

    // Exactly one of end, error or the watchdog settles a sentence.
    let settled = false;
    // When the voice was last known to be alive: it started, or said a word.
    let lastHeard = performance.now();
    const toClock = (): void => {
      if (settled || narration.isCancelled) return;
      settled = true;
      speaking.delete(utterance);
      window.clearTimeout(watchdog);
      narration.runTimer(totalMs * (1 - base), base);
    };

    utterance.onend = () => {
      if (settled) return;
      settled = true;
      speaking.delete(utterance);
      window.clearTimeout(watchdog);
      charsDone += sentence.length;
      index += 1;
      narration.reportProgress(charsDone / totalChars, false);
      speakNext();
    };

    // A refused or interrupted utterance must not strand the solution: fall
    // through to the clock so the board keeps moving.
    utterance.onerror = toClock;

    // Some engines accept an utterance and then never speak it or end it — no
    // audio device, a voice that failed to load, Chrome's stuck queue. Every
    // step waits for its narration now, so a sentence that has gone twice its
    // expected length without ending is given up on rather than waited for.
    // A voice that is still producing word boundaries is alive however long
    // the sentence runs, so the limit is on silence, not on total length.
    const limit = estimateDurationMs(sentence, opts.rate) * 2.5 + 5000;
    const check = (): void => {
      if (settled || narration.isCancelled) return;
      const quietFor = performance.now() - lastHeard;
      if (quietFor >= limit) {
        window.speechSynthesis.cancel();
        toClock();
        return;
      }
      watchdog = window.setTimeout(check, Math.max(500, limit - quietFor));
    };
    let watchdog = window.setTimeout(check, limit);
    narration.track(() => window.clearTimeout(watchdog));

    window.speechSynthesis.speak(utterance);
  };

  // Chrome drops the first utterance spoken straight after a cancel(), which
  // is exactly what starting a new step is. A short gap avoids that.
  narration.setTimeout(speakNext, 70);

  // Chrome also silently pauses speech that has run for a while. Nudging it
  // costs nothing when it is not stuck and unsticks it when it is.
  const keepAlive = window.setInterval(() => {
    if (narration.isCancelled) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 5000);
  narration.track(() => window.clearInterval(keepAlive));

  // Safari is unreliable about `boundary`, and some Android voices fire it
  // once. If nothing has arrived shortly after starting, drive the *reveal*
  // from the clock and let speech run alongside. The clock does not end the
  // step: only the voice finishing does.
  const fallback = window.setTimeout(() => {
    if (!sawBoundary && !narration.isCancelled) narration.runTimer(totalMs, 0, false);
  }, 1200);
  narration.track(() => window.clearTimeout(fallback));

  narration.track(() => {
    if (speechAvailable()) window.speechSynthesis.cancel();
  });

  return narration;
}
