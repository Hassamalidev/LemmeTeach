/**
 * The phase state machine (§3).
 *
 * The orchestrator is a finite state machine, not another model. Model
 * autonomy lives *inside* a phase; the transitions between phases are code.
 *
 * That split is the whole design. Whether the question has been read, whether
 * the learner has interrupted, whether the solution is finished — each is a
 * decision with real cost, and here each is a function with a truth table
 * rather than something a model is asked to judge.
 */

export const PHASES = [
  'IDLE',
  /** The reader is reading the question and planning the solution. */
  'PLANNING',
  /** The solver is working it through on the board. */
  'TEACHING',
  /** Waiting on the learner to clarify a question that could not be read. */
  'CHECKING',
  /** The learner raised a hand. */
  'INTERRUPTED',
  /** Finished: the summary and the worked solution. No model calls. */
  'REVIEW',
  'ABORTED',
] as const;

export type Phase = (typeof PHASES)[number];

export type PhaseEvent =
  | { t: 'start' }
  | { t: 'planned' }
  | { t: 'ask_started' }
  | { t: 'ask_finished' }
  | { t: 'raise_hand' }
  | { t: 'resume' }
  | { t: 'solved' }
  | { t: 'abort' }
  | { t: 'reset' };

const LEGAL: Record<Phase, Phase[]> = {
  IDLE: ['PLANNING', 'ABORTED'],
  PLANNING: ['TEACHING', 'CHECKING', 'ABORTED'],
  TEACHING: ['INTERRUPTED', 'REVIEW', 'ABORTED'],
  CHECKING: ['PLANNING', 'ABORTED'],
  INTERRUPTED: ['TEACHING', 'ABORTED'],
  REVIEW: ['IDLE', 'INTERRUPTED', 'ABORTED'],
  ABORTED: ['IDLE'],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return from === to || (LEGAL[from]?.includes(to) ?? false);
}

/**
 * The transition function. `previous` is where CHECKING returns to. Today
 * that is always PLANNING, because only the reader may ask; it is a parameter
 * so the answer goes back where the question came from if that ever changes.
 */
export function nextPhase(
  phase: Phase,
  event: PhaseEvent,
  previous: Phase = 'PLANNING',
): Phase {
  // Abort is always reachable, from anywhere, at any time (§3).
  if (event.t === 'abort') return 'ABORTED';

  // Reset means "back to the start". From a finished session that is a
  // straight return to IDLE; from a session still running it has to go through
  // ABORTED first, so the abort teardown — speech, worker, partial save —
  // actually happens instead of being skipped by a user pressing Home.
  if (event.t === 'reset') {
    return canTransition(phase, 'IDLE') ? 'IDLE' : 'ABORTED';
  }

  switch (phase) {
    case 'IDLE':
      return event.t === 'start' ? 'PLANNING' : phase;

    case 'PLANNING':
      // A question too unclear to solve is clarified here, before any of the
      // learner's credit is spent solving the wrong thing.
      if (event.t === 'ask_started') return 'CHECKING';
      return event.t === 'planned' ? 'TEACHING' : phase;

    case 'TEACHING':
      if (event.t === 'raise_hand') return 'INTERRUPTED';
      if (event.t === 'solved') return 'REVIEW';
      return phase;

    case 'CHECKING':
      if (event.t !== 'ask_finished') return phase;
      return canTransition('CHECKING', previous) ? previous : 'PLANNING';

    case 'INTERRUPTED':
      return event.t === 'resume' ? 'TEACHING' : phase;

    case 'REVIEW':
      // The solution is finished, but the learner can still ask about it.
      return event.t === 'raise_hand' ? 'INTERRUPTED' : phase;

    case 'ABORTED':
      return phase;
  }
}

/** What the learner is told is happening. Plain language, always accurate. */
export const PHASE_LABELS: Record<Phase, string> = {
  IDLE: 'Ready',
  PLANNING: 'Reading your question',
  TEACHING: 'Solving it on the board',
  CHECKING: 'Waiting for you: part of the question was unclear',
  INTERRUPTED: 'Listening to your question',
  REVIEW: 'Done',
  ABORTED: 'Stopped',
};

/** True while a model call may be in flight — used to gate the transport UI. */
export function isRunning(phase: Phase): boolean {
  return phase === 'PLANNING' || phase === 'TEACHING';
}
