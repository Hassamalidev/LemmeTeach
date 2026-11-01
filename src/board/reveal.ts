/**
 * The reveal engine (§14).
 *
 * Board operations for a step reveal across the duration of that step's
 * narration, so the thing being talked about is the thing being written. The
 * engine is deliberately dumb: it maps narration progress onto a count of
 * reveal units, and the ops decide for themselves what a unit means.
 *
 * `prefers-reduced-motion` is honoured here as well as in CSS — with motion
 * reduced, everything is written immediately and only the narration paces the
 * lesson.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardStep } from './page';
import { totalRevealUnits } from './page';
import { cancelSpeech, speak, estimateDurationMs } from '../voice/speech';

export interface RevealState {
  /** stepId → units revealed. A step absent from the map is fully written. */
  reveal: Map<string, number>;
  speakingStepId: string | null;
  /** 0..1 through the current step's narration. */
  progress: number;
}

export interface UseRevealOptions {
  rate: number;
  voiceName: string | null;
  muted: boolean;
  paused: boolean;
  reducedMotion: boolean;
  /** Changes when the learner asks for the step to be explained again from the start. */
  nonce?: number;
  onStepDone?: (stepId: string) => void;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Narrates one step at a time and reports how much of it is written.
 *
 * The caller hands it the step to narrate; passing null stops speech. Every
 * exit path — a new step, pause, unmount — cancels the previous narration
 * before starting anything else.
 */
export function useReveal(step: BoardStep | null, opts: UseRevealOptions): RevealState {
  const [reveal, setReveal] = useState<Map<string, number>>(() => new Map());
  const [progress, setProgress] = useState(0);
  const [speakingStepId, setSpeakingStepId] = useState<string | null>(null);
  const doneRef = useRef(opts.onStepDone);
  doneRef.current = opts.onStepDone;
  /**
   * Where the step being narrated had got to. A pause, or a change of speed
   * or voice, picks up from that sentence rather than saying the whole step
   * again and rubbing out what was already written.
   */
  const resumeRef = useRef<{ id: string; sentence: number; progress: number } | null>(null);
  const nonceRef = useRef(opts.nonce ?? 0);

  const { rate, voiceName, muted, paused, reducedMotion, nonce = 0 } = opts;

  useEffect(() => {
    if (!step) {
      cancelSpeech();
      setSpeakingStepId(null);
      return;
    }

    if (paused) {
      // Pausing stops the voice; the board keeps whatever is already written.
      cancelSpeech();
      return;
    }

    // Explaining it again from the start was asked for: forget where it was.
    if (nonceRef.current !== nonce) {
      nonceRef.current = nonce;
      resumeRef.current = null;
    }
    const resume = resumeRef.current?.id === step.id ? resumeRef.current : null;

    const units = totalRevealUnits(step.ops);
    setSpeakingStepId(step.id);
    setProgress(resume?.progress ?? 0);

    if (reducedMotion) {
      // Everything is written at once, but the step still takes its narration
      // time — the lesson is paced the same, it simply does not animate.
      setReveal((m) => new Map(m).set(step.id, units));
    } else if (resume) {
      // Carrying on: what is written stays written.
      setReveal((m) => new Map(m).set(step.id, Math.max(m.get(step.id) ?? 0, Math.ceil(resume.progress * units))));
    } else {
      setReveal((m) => new Map(m).set(step.id, 0));
    }

    const narration = speak(step.say, {
      rate,
      voiceName,
      muted,
      fromSentence: resume?.sentence,
      onProgress: ({ progress: p, done, sentence }) => {
        setProgress(p);
        resumeRef.current = done ? null : { id: step.id, sentence, progress: p };
        if (!reducedMotion) {
          // Reveal slightly ahead of the words so the learner is looking at
          // the thing as it is described, not just after.
          const lead = Math.min(1, p * 1.08);
          setReveal((m) => new Map(m).set(step.id, Math.ceil(lead * units)));
        }
        if (done) {
          setReveal((m) => new Map(m).set(step.id, units));
          setSpeakingStepId(null);
          doneRef.current?.(step.id);
        }
      },
    });

    return () => narration.cancel();
  }, [step, paused, rate, voiceName, muted, reducedMotion, nonce]);

  // Speech must never outlive the component (§14).
  useEffect(() => cancelSpeech, []);

  return { reveal, speakingStepId, progress };
}

/** How long a step will take to narrate, for the transport's progress bar. */
export function stepDurationMs(step: BoardStep, rate: number): number {
  return estimateDurationMs(step.say, rate);
}

/** Marks every step written — used when jumping to a step or replaying back. */
export function useRevealControls(): {
  completeAll: (steps: BoardStep[]) => Map<string, number>;
} {
  const completeAll = useCallback((steps: BoardStep[]) => {
    const m = new Map<string, number>();
    for (const s of steps) m.set(s.id, totalRevealUnits(s.ops));
    return m;
  }, []);
  return { completeAll };
}
