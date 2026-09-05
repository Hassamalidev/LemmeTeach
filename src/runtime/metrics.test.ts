/**
 * The metrics run over real sessions, not synthetic traces — the point of them
 * is to catch a prompt or runtime regression, so they have to be computed from
 * the same trace a lesson actually produces.
 */
import { describe, expect, it } from 'vitest';
import { computeMetrics, summarize } from './metrics';
import { Session } from '../orchestrator/session';
import { mock, setMockLesson } from '../providers/mock';
import { LearnerStore } from '../memory/store';
import { MaterialsStore } from '../materials/store';
import { DisabledSandbox } from '../sandbox/host';
import { DEFAULT_SETTINGS } from '../storage/settings';
import type { SubjectId } from '../core/types';

async function runLesson(
  subject: SubjectId,
  answers: 'right' | 'wrong',
): Promise<Session> {
  setMockLesson(subject);
  const session = new Session({
    subject,
    topic: 'a topic',
    level: 'school',
    provider: mock,
    adapterConfig: { apiKey: '' },
    settings: { ...DEFAULT_SETTINGS, sandboxEnabled: false },
    memory: new LearnerStore(),
    materials: new MaterialsStore(),
    sandbox: new DisabledSandbox(),
    models: {
      planner: 'mock-replay',
      tutor: 'mock-replay',
      examiner: 'mock-replay',
      repairer: 'mock-replay',
    },
    contextWindow: 200_000,
  });

  session.subscribe((s) => {
    const pending = s.pending;
    if (!pending) return;
    queueMicrotask(() => {
      if (pending.kind === 'ask') {
        session.answerAsk(pending.question.options?.[0] ?? 'yes');
      } else {
        session.answerQuiz(
          pending.questions.map((q) =>
            answers === 'right' ? q.answer : (q.answer + 1) % q.options.length,
          ),
        );
      }
    });
  });

  await session.start();
  return session;
}

describe('lesson metrics', () => {
  it('measures a clean lesson', async () => {
    const session = await runLesson('math', 'right');
    const m = computeMetrics(session.trace.all());

    expect(m.stepsTaught).toBeGreaterThan(2);
    expect(m.turnsUsed).toBeGreaterThan(3);
    expect(m.reachedReview).toBe(true);
    expect(m.inputTokens).toBeGreaterThan(0);
    expect(m.outputTokens).toBeGreaterThan(0);
  }, 30_000);

  it('records that a check was asked before step four', async () => {
    const session = await runLesson('math', 'right');
    const m = computeMetrics(session.trace.all());

    expect(m.checksAsked + m.questionsAsked).toBeGreaterThan(0);
    expect(m.stepsBeforeFirstCheck).not.toBeNull();
    // §8.3: the first check comes no later than step three.
    expect(m.stepsBeforeFirstCheck ?? 99).toBeLessThanOrEqual(3);
  }, 30_000);

  it('says remediation was correct when no check went badly', async () => {
    const session = await runLesson('math', 'right');
    const m = computeMetrics(session.trace.all());

    expect(m.lowScores).toHaveLength(0);
    expect(m.remediationTriggered).toBe(false);
    expect(m.remediationCorrect).toBe(true);
  }, 30_000);

  it('says remediation was correct when a bad check did trigger it', async () => {
    const session = await runLesson('math', 'wrong');
    const m = computeMetrics(session.trace.all());

    expect(m.lowScores.length).toBeGreaterThan(0);
    expect(m.remediationTriggered).toBe(true);
    expect(m.remediationCorrect).toBe(true);
  }, 30_000);

  it('keeps the board failure rate at zero for a valid lesson', async () => {
    const session = await runLesson('cs', 'right');
    const m = computeMetrics(session.trace.all());
    expect(m.boardFailureRate).toBe(0);
    expect(m.repairEscalations).toBe(0);
  }, 30_000);

  it('summarises a run in one line a person can read', async () => {
    const session = await runLesson('biology', 'right');
    const line = summarize('biology-2', computeMetrics(session.trace.all()));
    expect(line).toContain('biology-2');
    expect(line).toMatch(/steps.*turns.*tokens/);
  }, 30_000);
});
