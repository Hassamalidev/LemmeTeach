/**
 * The phase state machine (§3).
 *
 * The orchestrator is a finite state machine, not another model. Model
 * autonomy lives *inside* a phase; the transitions between phases are code.
 *
 * That split is the whole design. Asking a model to decide when it should stop
 * teaching and start examining, or whether a 35% score means "back up", puts a
 * decision with real cost and real pedagogical consequence somewhere it cannot
 * be tested. Here, it is a function with a truth table.
 */

export const PHASES = [
  'IDLE',
  'PLANNING',
  'TEACHING',
  'CHECKING',
  'REMEDIATING',
  'INTERRUPTED',
  'EXAMINING',
  'REVIEW',
  'ABORTED',
] as const;

export type Phase = (typeof PHASES)[number];

/** Score below which the runtime forces remediation, from §8.3. */
export const REMEDIATION_THRESHOLD = 0.8;
/** Below this, back up to the prerequisite rather than re-explaining. */
export const PREREQUISITE_THRESHOLD = 0.4;

export type PhaseEvent =
  | { t: 'start' }
  | { t: 'planned' }
  | { t: 'ask_started' }
  | { t: 'ask_finished'; score?: number }
  | { t: 'raise_hand' }
  | { t: 'resume' }
  | { t: 'lesson_ended'; runExam: boolean }
  | { t: 'exam_finished' }
  | { t: 'abort' }
  | { t: 'reset' };

const LEGAL: Record<Phase, Phase[]> = {
  IDLE: ['PLANNING', 'ABORTED'],
  PLANNING: ['TEACHING', 'ABORTED'],
  TEACHING: ['CHECKING', 'INTERRUPTED', 'EXAMINING', 'REVIEW', 'ABORTED'],
  CHECKING: ['TEACHING', 'REMEDIATING', 'EXAMINING', 'ABORTED'],
  REMEDIATING: ['TEACHING', 'CHECKING', 'ABORTED'],
  INTERRUPTED: ['TEACHING', 'ABORTED'],
  EXAMINING: ['CHECKING', 'REVIEW', 'ABORTED'],
  REVIEW: ['IDLE', 'ABORTED'],
  ABORTED: ['IDLE'],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return from === to || (LEGAL[from]?.includes(to) ?? false);
}

/**
 * The transition function. `previous` is where CHECKING should return to,
 * since a check can be raised from teaching or from examining and the answer
 * has to go back where it came from.
 */
export function nextPhase(
  phase: Phase,
  event: PhaseEvent,
  previous: Phase = 'TEACHING',
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
      return event.t === 'planned' ? 'TEACHING' : phase;

    case 'TEACHING':
      if (event.t === 'ask_started') return 'CHECKING';
      if (event.t === 'raise_hand') return 'INTERRUPTED';
      if (event.t === 'lesson_ended') return event.runExam ? 'EXAMINING' : 'REVIEW';
      return phase;

    case 'CHECKING': {
      if (event.t !== 'ask_finished') return phase;
      // The branch is decided here, in code, not by the model's judgement.
      if (previous === 'EXAMINING') return 'EXAMINING';
      if (typeof event.score === 'number' && event.score < REMEDIATION_THRESHOLD) {
        return 'REMEDIATING';
      }
      return 'TEACHING';
    }

    case 'REMEDIATING':
      if (event.t === 'ask_started') return 'CHECKING';
      if (event.t === 'resume') return 'TEACHING';
      return phase;

    case 'INTERRUPTED':
      return event.t === 'resume' ? 'TEACHING' : phase;

    case 'EXAMINING':
      if (event.t === 'ask_started') return 'CHECKING';
      if (event.t === 'exam_finished') return 'REVIEW';
      return phase;

    case 'REVIEW':
      return phase;

    case 'ABORTED':
      return phase;
  }
}

/** What the learner is told is happening. Plain language, always accurate. */
export const PHASE_LABELS: Record<Phase, string> = {
  IDLE: 'Ready',
  PLANNING: 'Planning the lesson',
  TEACHING: 'Teaching',
  CHECKING: 'Waiting for your answer',
  REMEDIATING: 'Backing up to fill a gap',
  INTERRUPTED: 'Listening to your question',
  EXAMINING: 'A short check',
  REVIEW: 'Wrapping up',
  ABORTED: 'Stopped',
};

/** True while a model call may be in flight — used to gate the transport UI. */
export function isRunning(phase: Phase): boolean {
  return phase === 'PLANNING' || phase === 'TEACHING' || phase === 'REMEDIATING' || phase === 'EXAMINING';
}
