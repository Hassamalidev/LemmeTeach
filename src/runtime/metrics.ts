/**
 * Mechanical evaluation metrics (§22).
 *
 * Derived from a finished session's trace, with no model involved, so they can
 * run in CI against the mock adapter and cost nothing.
 *
 * `remediationCorrect` is the one that matters most: it checks that the lesson
 * branched when — and only when — a check went badly. Everything else here is
 * quality; that one is whether this is a tutor or a video.
 */
import type { TraceEntry } from './trace';
import { REMEDIATION_THRESHOLD } from '../orchestrator/machine';

export interface LessonMetrics {
  turnsUsed: number;
  inputTokens: number;
  outputTokens: number;
  wallTimeMs: number;
  stepsTaught: number;
  boardFailures: number;
  boardFailureRate: number;
  toolErrors: number;
  toolErrorRate: number;
  checksAsked: number;
  questionsAsked: number;
  /**
   * How many steps were taught before the learner was first asked anything.
   * §8.3 requires no more than three — "step 4" and "after 3 steps" are the
   * same moment, and counting what came before is the reading that cannot be
   * argued with.
   */
  stepsBeforeFirstCheck: number | null;
  lowScores: number[];
  remediationTriggered: boolean;
  /** True when remediation happened exactly when it should have. */
  remediationCorrect: boolean;
  repairEscalations: number;
  errors: { kind: string; message: string }[];
  reachedReview: boolean;
}

export function computeMetrics(entries: readonly TraceEntry[]): LessonMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  let turnsUsed = 0;
  let stepsTaught = 0;
  let boardCalls = 0;
  let boardFailures = 0;
  let toolResults = 0;
  let toolErrors = 0;
  let checksAsked = 0;
  let questionsAsked = 0;
  let stepsBeforeFirstCheck: number | null = null;
  let repairEscalations = 0;
  let remediationTriggered = false;
  let reachedReview = false;

  const lowScores: number[] = [];
  const errors: { kind: string; message: string }[] = [];

  const first = entries[0]?.at ?? 0;
  const last = entries[entries.length - 1]?.at ?? first;

  for (const e of entries) {
    switch (e.t) {
      case 'turn':
        turnsUsed += 1;
        break;

      case 'usage':
        inputTokens += e.inputTokens;
        outputTokens += e.outputTokens;
        break;

      case 'phase':
        if (e.to === 'REMEDIATING') remediationTriggered = true;
        if (e.to === 'REVIEW') reachedReview = true;
        break;

      case 'tool_call':
        if (e.name === 'teach_step') boardCalls += 1;
        if (e.name === 'check_understanding') {
          checksAsked += 1;
          if (stepsBeforeFirstCheck === null) stepsBeforeFirstCheck = stepsTaught;
        }
        if (e.name === 'ask_learner') {
          questionsAsked += 1;
          if (stepsBeforeFirstCheck === null) stepsBeforeFirstCheck = stepsTaught;
        }
        if (e.name === 'fix_board') repairEscalations += 1;
        break;

      case 'tool_result': {
        toolResults += 1;
        if (!e.ok) toolErrors += 1;
        if (e.name === 'teach_step') {
          if (e.ok) stepsTaught += 1;
          else boardFailures += 1;
        }
        if (e.name === 'check_understanding' && e.ok) {
          const score = readScore(e.content);
          if (score !== null && score < REMEDIATION_THRESHOLD) lowScores.push(score);
        }
        break;
      }

      case 'error':
        errors.push({ kind: e.error.kind, message: e.error.message });
        break;

      default:
        break;
    }
  }

  // The branch must fire when a check went badly, and must not fire when none
  // did. Both directions matter: remediating after a good check wastes the
  // learner's time as surely as not remediating after a bad one loses them.
  const shouldRemediate = lowScores.length > 0;
  const remediationCorrect = shouldRemediate === remediationTriggered;

  return {
    turnsUsed,
    inputTokens,
    outputTokens,
    wallTimeMs: last - first,
    stepsTaught,
    boardFailures,
    boardFailureRate: boardCalls ? boardFailures / boardCalls : 0,
    toolErrors,
    toolErrorRate: toolResults ? toolErrors / toolResults : 0,
    checksAsked,
    questionsAsked,
    stepsBeforeFirstCheck,
    lowScores,
    remediationTriggered,
    remediationCorrect,
    repairEscalations,
    errors,
    reachedReview,
  };
}

/** The score lives inside the stringified tool result; pull it back out. */
function readScore(content: string): number | null {
  try {
    const parsed = JSON.parse(content) as { score?: unknown; answered?: unknown };
    // A check nobody answered has no score, and must not read as a failure.
    if (parsed.answered === 0) return null;
    return typeof parsed.score === 'number' ? parsed.score : null;
  } catch {
    return null;
  }
}

/** A one-line verdict per topic, for a run summary a person will actually read. */
export function summarize(id: string, m: LessonMetrics): string {
  const problems: string[] = [];
  if (!m.reachedReview) problems.push('did not finish');
  if (m.checksAsked === 0) problems.push('never checked understanding');
  if (m.stepsBeforeFirstCheck !== null && m.stepsBeforeFirstCheck > 3) {
    problems.push(`nothing asked for ${m.stepsBeforeFirstCheck} steps`);
  }
  if (!m.remediationCorrect) {
    problems.push(m.remediationTriggered ? 'remediated with no bad check' : 'did not remediate after a bad check');
  }
  if (m.boardFailureRate > 0.05) {
    problems.push(`${Math.round(m.boardFailureRate * 100)}% of board steps rejected`);
  }

  const head = `${id}: ${m.stepsTaught} steps, ${m.turnsUsed} turns, ${Math.round(
    (m.inputTokens + m.outputTokens) / 1000,
  )}k tokens`;

  return problems.length ? `${head} — ${problems.join('; ')}` : `${head} — clean`;
}
