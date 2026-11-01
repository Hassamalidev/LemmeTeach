/**
 * Narration (§14): what the voice says, and where it starts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSpeech, speak, speakable, splitSentences } from './speech';

describe('what the voice says', () => {
  it('reads units, degrees and powers as words', () => {
    expect(speakable('It leaves at 20 m/s at 35°, so it lands 38.3 m away.')).toBe(
      'It leaves at 20 metres per second at 35 degrees, so it lands 38.3 m away.',
    );
    expect(speakable('g is 9.81 m/s^2 and x^2 = 4.')).toBe(
      'g is 9.81 metres per second squared and x squared equals 4.',
    );
    expect(speakable('72 km/h is 50% faster')).toBe('72 kilometres per hour is 50 percent faster');
  });

  it('turns symbols a voice would skip into words', () => {
    expect(speakable('So x ≈ 2, and Δx = v·t with θ = 35°.')).toBe(
      'So x approximately 2, and change in x equals v times t with theta equals 35 degrees.',
    );
    expect(speakable('Double it → four.')).toBe('Double it, which gives four.');
  });

  it('drops LaTeX and markdown a model let through', () => {
    expect(speakable('Use $\\frac{1}{2} m v^2$ here, the **key** step.')).toBe(
      'Use 1 over 2 m v squared here, the key step.',
    );
  });

  it('leaves plain speech exactly as it was', () => {
    const plain = 'Now we split the speed into a part going across and a part going up.';
    expect(speakable(plain)).toBe(plain);
  });
});

describe('speaking a step', () => {
  const spoken: string[] = [];

  /** A speech engine that finishes each sentence as soon as it is given it. */
  function fakeEngine(): void {
    spoken.length = 0;
    class Utterance {
      rate = 1;
      voice: unknown = null;
      lang = '';
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onboundary: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('speechSynthesis', {
      speaking: false,
      paused: false,
      getVoices: () => [],
      cancel: () => {},
      resume: () => {},
      speak: (u: Utterance) => {
        spoken.push(u.text);
        setTimeout(() => {
          u.onstart?.();
          u.onend?.();
        }, 1);
      },
    });
    Object.assign(window, { speechSynthesis: globalThis.speechSynthesis });
  }

  afterEach(() => {
    cancelSpeech();
    vi.unstubAllGlobals();
  });

  const say = 'First we draw it. Then we split the speed. Last we add them up.';

  it('says every sentence, in order, and reports the end once', async () => {
    fakeEngine();
    const ends: number[] = [];
    await new Promise<void>((resolve) => {
      speak(say, {
        rate: 1,
        voiceName: null,
        muted: false,
        onProgress: ({ done, sentence }) => {
          if (done) {
            ends.push(sentence);
            resolve();
          }
        },
      });
    });
    expect(spoken).toEqual(splitSentences(say));
    expect(ends).toHaveLength(1);
  });

  it('carries on from a sentence after a pause, without saying the rest again', async () => {
    fakeEngine();
    await new Promise<void>((resolve) => {
      speak(say, {
        rate: 1,
        voiceName: null,
        muted: false,
        fromSentence: 1,
        onProgress: ({ done, progress }) => {
          if (!done) expect(progress).toBeGreaterThan(0);
          if (done) resolve();
        },
      });
    });
    expect(spoken).toEqual(['Then we split the speed.', 'Last we add them up.']);
  });
});
