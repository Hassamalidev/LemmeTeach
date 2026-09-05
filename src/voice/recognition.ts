/**
 * Voice input for Raise hand (§15).
 *
 * Present where the browser supports it, silently absent where it does not.
 * This is a convenience on top of a text box that always works, so nothing in
 * the app may depend on it existing.
 */

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } }; resultIndex: number }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionAvailable(): boolean {
  return ctor() !== null;
}

export interface Listening {
  stop: () => void;
}

/**
 * Listen once and hand back what was heard. Errors resolve to nothing rather
 * than rejecting: a microphone permission the learner declined is a normal
 * outcome, not a failure to report.
 */
export function listenOnce(
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
): Listening | null {
  const Ctor = ctor();
  if (!Ctor) return null;

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    return null;
  }

  recognition.lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (e) => {
    const result = e.results[0];
    const alt = result?.[0];
    if (alt) onText(alt.transcript, false);
  };
  recognition.onerror = () => onEnd();
  recognition.onend = () => onEnd();

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
