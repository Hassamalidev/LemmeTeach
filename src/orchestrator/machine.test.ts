/**
 * The phase machine is code, so it gets tested like code. These assertions are
 * the ones that separate a tutor from a video player: that a bad check forces
 * remediation whatever the model would have preferred, and that abort is
 * reachable from everywhere.
 */
import { describe, expect, it } from 'vitest';
import { canTransition, nextPhase, PHASES, type Phase, type PhaseEvent } from './machine';

describe('phase machine', () => {
  it('plans before it teaches', () => {
    expect(nextPhase('IDLE', { t: 'start' })).toBe('PLANNING');
    expect(nextPhase('PLANNING', { t: 'planned' })).toBe('TEACHING');
  });

  it('suspends into CHECKING when the tutor asks something', () => {
    expect(nextPhase('TEACHING', { t: 'ask_started' })).toBe('CHECKING');
  });

  it('forces remediation on a score under 80%, whatever the model wanted', () => {
    expect(nextPhase('CHECKING', { t: 'ask_finished', score: 0.5 })).toBe('REMEDIATING');
    expect(nextPhase('CHECKING', { t: 'ask_finished', score: 0.2 })).toBe('REMEDIATING');
    expect(nextPhase('CHECKING', { t: 'ask_finished', score: 0.79 })).toBe('REMEDIATING');
  });

  it('carries on at 80% or better', () => {
    expect(nextPhase('CHECKING', { t: 'ask_finished', score: 0.8 })).toBe('TEACHING');
    expect(nextPhase('CHECKING', { t: 'ask_finished', score: 1 })).toBe('TEACHING');
  });

  it('treats a free-text answer with no score as no reason to remediate', () => {
    expect(nextPhase('CHECKING', { t: 'ask_finished' })).toBe('TEACHING');
  });

  it('returns a check raised during the exam to the exam, not to teaching', () => {
    expect(nextPhase('CHECKING', { t: 'ask_finished', score: 0.3 }, 'EXAMINING')).toBe('EXAMINING');
  });

  it('interrupts and resumes without restarting the lesson', () => {
    expect(nextPhase('TEACHING', { t: 'raise_hand' })).toBe('INTERRUPTED');
    expect(nextPhase('INTERRUPTED', { t: 'resume' })).toBe('TEACHING');
  });

  it('goes to the exam or straight to review, as the tutor asked', () => {
    expect(nextPhase('TEACHING', { t: 'lesson_ended', runExam: true })).toBe('EXAMINING');
    expect(nextPhase('TEACHING', { t: 'lesson_ended', runExam: false })).toBe('REVIEW');
    expect(nextPhase('EXAMINING', { t: 'exam_finished' })).toBe('REVIEW');
  });

  it('can be aborted from every phase', () => {
    for (const phase of PHASES) {
      expect(nextPhase(phase, { t: 'abort' }), phase).toBe('ABORTED');
    }
  });

  it('ignores events that make no sense in the current phase', () => {
    expect(nextPhase('PLANNING', { t: 'raise_hand' })).toBe('PLANNING');
    expect(nextPhase('REVIEW', { t: 'ask_started' })).toBe('REVIEW');
  });

  it('lets a lesson end while it is remediating', () => {
    // A check that goes badly near the end of a lesson is the ordinary case.
    // Without this the session has nowhere to go and the learner never
    // reaches their review screen — which is what actually happened.
    expect(nextPhase('REMEDIATING', { t: 'lesson_ended', runExam: true })).toBe('EXAMINING');
    expect(nextPhase('REMEDIATING', { t: 'lesson_ended', runExam: false })).toBe('REVIEW');
  });

  it('can reach an ending from every phase a lesson passes through', () => {
    // Legal transitions are not enough: a phase can be perfectly well-formed
    // and still be a dead end. Every phase has to be able to *finish*.
    const events: PhaseEvent[] = [
      { t: 'start' },
      { t: 'planned' },
      { t: 'ask_started' },
      { t: 'ask_finished', score: 0.9 },
      { t: 'ask_finished', score: 0.1 },
      { t: 'raise_hand' },
      { t: 'resume' },
      { t: 'lesson_ended', runExam: true },
      { t: 'lesson_ended', runExam: false },
      { t: 'exam_finished' },
    ];

    const ENDINGS: Phase[] = ['REVIEW', 'ABORTED'];

    for (const start of PHASES) {
      if (ENDINGS.includes(start)) continue;

      // Breadth-first search over the transition function, ignoring abort —
      // "you can always press stop" must not be the only way out of a phase.
      const seen = new Set<Phase>([start]);
      const queue: Phase[] = [start];
      let reached = false;

      while (queue.length && !reached) {
        const phase = queue.shift();
        if (!phase) break;
        for (const event of events) {
          for (const previous of ['TEACHING', 'EXAMINING'] as Phase[]) {
            const to = nextPhase(phase, event, previous);
            if (ENDINGS.includes(to)) {
              reached = true;
              break;
            }
            if (!seen.has(to)) {
              seen.add(to);
              queue.push(to);
            }
          }
        }
      }

      expect(reached, `${start} cannot finish without aborting`).toBe(true);
    }
  });

  it('never produces an illegal transition for any event', () => {
    const events = [
      { t: 'start' },
      { t: 'planned' },
      { t: 'ask_started' },
      { t: 'ask_finished', score: 0.9 },
      { t: 'ask_finished', score: 0.1 },
      { t: 'raise_hand' },
      { t: 'resume' },
      { t: 'lesson_ended', runExam: true },
      { t: 'lesson_ended', runExam: false },
      { t: 'exam_finished' },
      { t: 'abort' },
      { t: 'reset' },
    ] as const;

    for (const from of PHASES) {
      for (const event of events) {
        for (const previous of ['TEACHING', 'EXAMINING'] as Phase[]) {
          const to = nextPhase(from, event, previous);
          expect(canTransition(from, to), `${from} -> ${to} on ${event.t}`).toBe(true);
        }
      }
    }
  });
});
