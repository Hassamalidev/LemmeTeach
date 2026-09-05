/**
 * Integration, with no network (§22).
 *
 * The mock adapter replays a lesson through the real runtime, the real tool
 * bus, the real validator and the real page model. This is the main test
 * surface: it is the only place the pieces are checked against each other
 * rather than in isolation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session, type SessionState } from './session';
import { mock, setMockLesson } from '../providers/mock';
import { LearnerStore } from '../memory/store';
import { MaterialsStore } from '../materials/store';
import { DisabledSandbox } from '../sandbox/host';
import { DEFAULT_SETTINGS, type Settings } from '../storage/settings';
import type { SandboxPort, SandboxResult } from '../tools/context';
import type { SubjectId } from '../core/types';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

class FakeSandbox implements SandboxPort {
  constructor(private result: Partial<SandboxResult> = {}) {}
  available(): boolean {
    return true;
  }
  unavailableReason(): string {
    return '';
  }
  async run(): Promise<SandboxResult> {
    return {
      ok: true,
      stdout: 'time of flight 2.62 s',
      result: '',
      figures: [],
      timedOut: false,
      ...this.result,
    };
  }
}

interface Harness {
  session: Session;
  states: SessionState[];
  /** Answers every question as it appears, so the loop never hangs. */
  autoAnswer: (mode?: 'right' | 'wrong' | 'skip') => void;
  run: () => Promise<void>;
}

function makeSession(
  subject: SubjectId,
  overrides: {
    settings?: Partial<Settings>;
    sandbox?: SandboxPort;
  } = {},
): Harness {
  setMockLesson(subject);

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    sandboxEnabled: true,
    ...overrides.settings,
  };

  const session = new Session({
    subject,
    topic: 'a topic',
    level: 'school',
    provider: mock,
    adapterConfig: { apiKey: '' },
    settings,
    memory: new LearnerStore(),
    materials: new MaterialsStore(),
    sandbox: overrides.sandbox ?? new FakeSandbox(),
    models: {
      planner: 'mock-replay',
      tutor: 'mock-replay',
      examiner: 'mock-replay',
      repairer: 'mock-replay',
    },
    contextWindow: 200_000,
  });

  const states: SessionState[] = [];
  session.subscribe((s) => states.push(s));

  return {
    session,
    states,
    autoAnswer(mode = 'right') {
      session.subscribe((s) => {
        const pending = s.pending;
        if (!pending) return;
        // Answer on a microtask so the tool's promise is fully wired first.
        queueMicrotask(() => {
          if (pending.kind === 'ask') {
            session.answerAsk(
              mode === 'skip' ? '' : pending.question.options?.[0] ?? 'I think so',
              mode === 'skip',
            );
          } else {
            session.answerQuiz(
              pending.questions.map((q) =>
                mode === 'right' ? q.answer : mode === 'skip' ? -1 : (q.answer + 1) % q.options.length,
              ),
            );
          }
        });
      });
    },
    run: () => session.start(),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * A clean lesson, end to end
 * ------------------------------------------------------------------ */

describe('a clean lesson', () => {
  it('plans, teaches, checks, examines and reaches review', async () => {
    const h = makeSession('math');
    h.autoAnswer('right');
    await h.run();

    const final = h.session.state;
    expect(final.plan, 'a plan was committed').toBeTruthy();
    expect(final.plan?.objectives.length).toBeGreaterThanOrEqual(3);
    expect(h.session.board.stepCount, 'steps reached the board').toBeGreaterThan(3);
    expect(final.ending, 'the tutor closed the lesson').toBeTruthy();
    expect(final.phase).toBe('REVIEW');
  }, 30_000);

  it('writes real operations to the board, not just narration', async () => {
    const h = makeSession('math');
    h.autoAnswer('right');
    await h.run();

    const ops = h.session.board.allSteps().flatMap((s) => s.ops);
    expect(ops.length).toBeGreaterThan(8);
    expect(new Set(ops.map((o) => o.op)).size, 'several kinds of op were used').toBeGreaterThan(3);
  }, 30_000);

  it('keeps a transcript that matches the steps on the board', async () => {
    const h = makeSession('math');
    h.autoAnswer('right');
    await h.run();

    const state = h.session.state;
    expect(state.transcript.length).toBe(h.session.board.stepCount);
    for (const line of state.transcript) {
      // Narration is read aloud verbatim, so nothing unpronounceable may reach it.
      expect(line.say).not.toMatch(/\\frac|\$\$|<[a-z]/);
    }
  }, 30_000);

  it('records the phase transitions in the trace', async () => {
    const h = makeSession('math');
    h.autoAnswer('right');
    await h.run();

    const phases = h.session.trace
      .all()
      .filter((e) => e.t === 'phase')
      .map((e) => (e.t === 'phase' ? e.to : ''));

    expect(phases).toContain('PLANNING');
    expect(phases).toContain('TEACHING');
    expect(phases).toContain('REVIEW');
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Branching
 * ------------------------------------------------------------------ */

describe('when a check goes badly', () => {
  it('enters REMEDIATING rather than carrying on', async () => {
    const h = makeSession('math');
    h.autoAnswer('wrong');
    await h.run();

    const phases = h.session.trace
      .all()
      .filter((e) => e.t === 'phase')
      .map((e) => (e.t === 'phase' ? e.to : ''));

    expect(phases, 'a failed check forces remediation').toContain('REMEDIATING');
  }, 30_000);

  it('tells the tutor to back up, in its own words', async () => {
    const h = makeSession('math');
    h.autoAnswer('wrong');
    await h.run();

    const injected = h.session.trace
      .all()
      .some((e) => e.t === 'note' && e.message.includes('injected'));
    expect(injected).toBe(true);
  }, 30_000);
});

describe('a skipped question', () => {
  it('is not counted as a wrong answer', async () => {
    const h = makeSession('math');
    h.autoAnswer('skip');
    await h.run();
    // Skipping every question leaves the score at zero out of zero answered,
    // which must not be reported as a total failure of the lesson.
    expect(h.session.state.phase).toBe('REVIEW');
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Interruption and abort
 * ------------------------------------------------------------------ */

describe('raise hand', () => {
  it('moves to INTERRUPTED and resumes teaching', async () => {
    const h = makeSession('math');
    h.autoAnswer('right');

    let raised = false;
    h.session.subscribe((s) => {
      if (!raised && s.phase === 'TEACHING' && h.session.board.stepCount >= 2) {
        raised = true;
        h.session.raiseHand('Wait, why does that step work?');
      }
    });

    await h.run();

    const phases = h.session.trace
      .all()
      .filter((e) => e.t === 'phase')
      .map((e) => (e.t === 'phase' ? e.to : ''));
    expect(phases).toContain('INTERRUPTED');
    // It resumed rather than restarting.
    expect(h.session.board.stepCount).toBeGreaterThan(2);
  }, 30_000);
});

describe('abort', () => {
  it('stops the lesson and keeps what was already taught', async () => {
    const h = makeSession('math');
    h.autoAnswer('right');

    h.session.subscribe(() => {
      if (h.session.board.stepCount === 2) h.session.abort();
    });

    await h.run();

    expect(h.session.state.phase).toBe('ABORTED');
    expect(h.session.board.stepCount, 'the board keeps what was taught').toBeGreaterThan(0);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Degradation
 * ------------------------------------------------------------------ */

describe('with no sandbox', () => {
  it('still teaches the lesson and reaches the end', async () => {
    const h = makeSession('physics', {
      sandbox: new DisabledSandbox('Pyodide is blocked on this network.'),
      settings: { sandboxEnabled: false },
    });
    h.autoAnswer('right');
    await h.run();

    expect(h.session.board.stepCount).toBeGreaterThan(2);
    expect(h.session.state.phase).toBe('REVIEW');
    expect(h.session.state.ending).toBeTruthy();
  }, 30_000);

  it('refuses a figure that was never produced, and says why', async () => {
    // The physics lesson places a figure that run_code would have made. With
    // no sandbox that figure does not exist, and the step must be rejected
    // with a reason rather than rendering an empty box.
    const h = makeSession('physics', {
      sandbox: new DisabledSandbox('Pyodide is blocked on this network.'),
      settings: { sandboxEnabled: false },
    });
    h.autoAnswer('right');
    await h.run();

    const rejection = h.session.trace
      .all()
      .find(
        (e) =>
          e.t === 'tool_result' && e.name === 'teach_step' && !e.ok && e.content.includes('figureId'),
      );
    expect(rejection, 'the figure step was rejected').toBeTruthy();
    expect(rejection && 'content' in rejection && rejection.content).toContain('run_code');

    // And nothing was silently dropped: no figure op reached the board.
    const figureOps = h.session.board
      .allSteps()
      .flatMap((s) => s.ops)
      .filter((o) => o.op === 'figure');
    expect(figureOps).toHaveLength(0);
  }, 30_000);

  it('does not offer run_code to the tutor at all', async () => {
    const h = makeSession('physics', {
      sandbox: new DisabledSandbox('Pyodide is blocked on this network.'),
      settings: { sandboxEnabled: false },
    });
    h.autoAnswer('right');
    await h.run();

    const calledRunCode = h.session.trace
      .all()
      .some((e) => e.t === 'tool_call' && e.name === 'run_code');
    expect(calledRunCode).toBe(false);
  }, 30_000);
});

describe('a sandbox timeout', () => {
  it('is reported to the model and the lesson continues', async () => {
    const h = makeSession('physics', {
      sandbox: new FakeSandbox({ ok: false, timedOut: true }),
    });
    h.autoAnswer('right');
    await h.run();

    expect(h.session.state.phase).toBe('REVIEW');
    expect(h.session.board.stepCount).toBeGreaterThan(2);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Budget
 * ------------------------------------------------------------------ */

describe('budget exhaustion', () => {
  it('closes the lesson gracefully instead of dying mid-sentence', async () => {
    const h = makeSession('math', {
      settings: { budget: { inputTokens: 4000, outputTokens: 1000 } },
    });
    h.autoAnswer('right');
    await h.run();

    const state = h.session.state;
    expect(state.ending, 'the lesson was closed, not dropped').toBeTruthy();
    expect(['REVIEW', 'EXAMINING']).toContain(state.phase);
    expect(h.session.board.stepCount).toBeGreaterThan(0);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Every subject
 * ------------------------------------------------------------------ */

describe('every subject', () => {
  for (const subject of ['math', 'physics', 'chemistry', 'cs', 'biology'] as SubjectId[]) {
    it(`${subject} runs end to end`, async () => {
      const h = makeSession(subject);
      h.autoAnswer('right');
      await h.run();
      expect(h.session.board.stepCount, subject).toBeGreaterThan(2);
      expect(h.session.state.phase, subject).toBe('REVIEW');
    }, 30_000);
  }
});
