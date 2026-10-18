/**
 * The phase machine is code, so it gets tested like code: that a question is
 * read before it is solved, that the only wait is a clarifying one, and that
 * abort is reachable from everywhere.
 */
import { describe, expect, it } from 'vitest';
import { canTransition, isRunning, nextPhase, PHASES, type Phase, type PhaseEvent } from './machine';

const EVENTS: PhaseEvent[] = [
  { t: 'start' },
  { t: 'planned' },
  { t: 'ask_started' },
  { t: 'ask_finished' },
  { t: 'raise_hand' },
  { t: 'resume' },
  { t: 'solved' },
];

describe('phase machine', () => {
  it('reads the question before it solves it', () => {
    expect(nextPhase('IDLE', { t: 'start' })).toBe('PLANNING');
    expect(nextPhase('PLANNING', { t: 'planned' })).toBe('TEACHING');
  });

  it('waits on the learner only while reading, and goes back to reading', () => {
    expect(nextPhase('PLANNING', { t: 'ask_started' })).toBe('CHECKING');
    expect(nextPhase('CHECKING', { t: 'ask_finished' }, 'PLANNING')).toBe('PLANNING');
  });

  it('has no way to stop and quiz once it is solving', () => {
    expect(nextPhase('TEACHING', { t: 'ask_started' })).toBe('TEACHING');
    expect(PHASES).not.toContain('EXAMINING');
    expect(PHASES).not.toContain('REMEDIATING');
  });

  it('interrupts and resumes without starting again', () => {
    expect(nextPhase('TEACHING', { t: 'raise_hand' })).toBe('INTERRUPTED');
    expect(nextPhase('INTERRUPTED', { t: 'resume' })).toBe('TEACHING');
  });

  it('ends at the answer, with nothing after it', () => {
    expect(nextPhase('TEACHING', { t: 'solved' })).toBe('REVIEW');
    for (const event of EVENTS) {
      if (event.t === 'raise_hand') continue;
      expect(nextPhase('REVIEW', event)).toBe('REVIEW');
    }
  });

  it('still takes a question once the solution is finished', () => {
    expect(nextPhase('REVIEW', { t: 'raise_hand' })).toBe('INTERRUPTED');
    expect(nextPhase('INTERRUPTED', { t: 'resume' })).toBe('TEACHING');
    expect(nextPhase('TEACHING', { t: 'solved' })).toBe('REVIEW');
  });

  it('can be aborted from every phase', () => {
    for (const phase of PHASES) {
      expect(nextPhase(phase, { t: 'abort' }), phase).toBe('ABORTED');
    }
  });

  it('ignores events that make no sense in the current phase', () => {
    expect(nextPhase('PLANNING', { t: 'raise_hand' })).toBe('PLANNING');
    expect(nextPhase('PLANNING', { t: 'solved' })).toBe('PLANNING');
    expect(nextPhase('IDLE', { t: 'planned' })).toBe('IDLE');
  });

  it('can reach an ending from every phase a session passes through', () => {
    // Legal transitions are not enough: a phase can be perfectly well-formed
    // and still be a dead end. Every phase has to be able to *finish*.
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
        for (const event of EVENTS) {
          const to = nextPhase(phase, event);
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

      expect(reached, `${start} cannot finish without aborting`).toBe(true);
    }
  });

  it('never produces an illegal transition for any event', () => {
    const all: PhaseEvent[] = [...EVENTS, { t: 'abort' }, { t: 'reset' }];
    for (const from of PHASES) {
      for (const event of all) {
        for (const previous of PHASES) {
          const to = nextPhase(from, event, previous);
          expect(canTransition(from, to), `${from} -> ${to} on ${event.t}`).toBe(true);
        }
      }
    }
  });

  it('counts only reading and solving as running', () => {
    expect(PHASES.filter(isRunning)).toEqual(['PLANNING', 'TEACHING']);
  });
});
