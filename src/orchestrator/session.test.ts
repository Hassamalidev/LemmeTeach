/**
 * Integration, with no network (§22).
 *
 * The mock adapter replays a prepared walkthrough through the real runtime,
 * the real tool bus, the real validator and the real page model. This is the
 * main test surface: it is the only place the pieces are checked against each
 * other rather than in isolation.
 */
import { describe, expect, it } from 'vitest';
import { Session, type SessionOptions, type SessionState } from './session';
import { mock, setMockLesson } from '../providers/mock';
import type { AgentEvent, AgentRequest, Attachment, ProviderAdapter } from '../providers/types';
import { DisabledSandbox } from '../sandbox/host';
import { DEFAULT_SETTINGS, type Settings } from '../storage/settings';
import type { SandboxPort, SandboxResult } from '../tools/context';
import type { SubjectId } from '../core/types';
import { DEMO_SUBJECTS } from '../fixtures';

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
  requests: AgentRequest[];
  phases: () => string[];
}

function makeSession(
  subject: SubjectId,
  over: {
    settings?: Partial<Settings>;
    sandbox?: SandboxPort;
    provider?: ProviderAdapter;
    options?: Partial<SessionOptions>;
  } = {},
): Harness {
  setMockLesson(subject);

  const requests: AgentRequest[] = [];
  const inner = over.provider ?? mock;
  const provider: ProviderAdapter = {
    ...inner,
    run(req, cfg, signal) {
      requests.push(req);
      return inner.run(req, cfg, signal);
    },
  };

  const session = new Session({
    topic: 'A ball is thrown at 20 m/s at 40 degrees. How far does it land?',
    subject: 'general',
    level: 'school',
    provider,
    adapterConfig: { apiKey: '' },
    settings: { ...DEFAULT_SETTINGS, sandboxEnabled: true, ...over.settings },
    sandbox: over.sandbox ?? new FakeSandbox(),
    models: { planner: 'mock-replay', tutor: 'mock-replay', repairer: 'mock-replay' },
    contextWindow: 200_000,
    ...over.options,
  });

  const states: SessionState[] = [];
  session.subscribe((s) => states.push(s));

  return {
    session,
    states,
    requests,
    phases: () =>
      session.trace
        .all()
        .filter((e) => e.t === 'phase')
        .map((e) => (e.t === 'phase' ? e.to : '')),
  };
}

const toolNames = (req: AgentRequest): string[] => req.tools.map((t) => t.name).sort();
const isSolver = (req: AgentRequest): boolean => req.tools.some((t) => t.name === 'teach_step');

/* ------------------------------------------------------------------ *
 * A question, solved
 * ------------------------------------------------------------------ */

describe('a solved question', () => {
  it('is read, worked through on the board, and finished', async () => {
    const h = makeSession('physics');
    await h.session.start();

    expect(h.phases()).toEqual(['PLANNING', 'TEACHING', 'REVIEW']);
    expect(h.session.state.plan).toBeTruthy();
    expect(h.session.board.stepCount).toBeGreaterThan(2);
    expect(h.session.state.ending?.summary.length ?? 0).toBeGreaterThan(20);
  }, 30_000);

  it('writes real operations to the board, not just narration', async () => {
    const h = makeSession('math');
    await h.session.start();
    const ops = h.session.board.allSteps().flatMap((s) => s.ops);
    expect(ops.length).toBeGreaterThan(5);
    expect(new Set(ops.map((o) => o.op)).size).toBeGreaterThan(2);
  }, 30_000);

  it('keeps a transcript that matches the steps on the board', async () => {
    const h = makeSession('chemistry');
    await h.session.start();
    const steps = h.session.board.allSteps();
    expect(h.session.state.transcript.map((t) => t.stepId)).toEqual(steps.map((s) => s.id));
  }, 30_000);

  it('never waits on the learner, and never quizzes them', async () => {
    const h = makeSession('physics');
    await h.session.start();
    expect(h.states.some((s) => s.pending !== null)).toBe(false);
    expect(h.phases()).not.toContain('CHECKING');
  }, 30_000);

  it('gives the solver no way to ask, and the reader no board', async () => {
    const h = makeSession('physics');
    await h.session.start();

    const reader = h.requests[0] as AgentRequest;
    expect(toolNames(reader)).toEqual(['ask_learner', 'plan_lesson']);

    const solver = h.requests.find(isSolver) as AgentRequest;
    expect(toolNames(solver)).toEqual(['compute', 'end_lesson', 'run_code', 'save_note', 'teach_step']);
  }, 30_000);

  for (const subject of DEMO_SUBJECTS) {
    it(`the ${subject} walkthrough runs end to end`, async () => {
      const h = makeSession(subject);
      await h.session.start();
      expect(h.session.board.stepCount, subject).toBeGreaterThan(2);
      expect(h.session.state.phase, subject).toBe('REVIEW');
    }, 30_000);
  }
});

/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ */

describe('an attached screenshot', () => {
  const PICTURE: Attachment = { kind: 'image', name: 'q4.png', dataUrl: 'data:image/png;base64,AAAA' };

  it('is seen by the reader, once, and by nobody else', async () => {
    const h = makeSession('physics', { options: { attachments: [PICTURE] } });
    await h.session.start();

    const first = (h.requests[0] as AgentRequest).messages[0];
    expect(first?.role === 'user' && first.attachments).toEqual([PICTURE]);

    // Re-sending a picture on every one of thirty turns is what would make
    // uploads expensive. The solver works from the restated question.
    for (const req of h.requests.filter(isSolver)) {
      for (const m of req.messages) {
        expect(m.role === 'user' ? m.attachments : undefined).toBeUndefined();
      }
    }
  }, 30_000);

  it('does not end up in the trace or in what is saved', async () => {
    const h = makeSession('physics', { options: { attachments: [PICTURE] } });
    await h.session.start();
    expect(h.session.trace.toExport({})).not.toContain(PICTURE.dataUrl);
    expect(JSON.stringify(h.session.state.plan)).not.toContain(PICTURE.dataUrl);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * The one question it may ask
 * ------------------------------------------------------------------ */

describe('an unclear question', () => {
  /** A reader that asks one clarifying question before it plans. */
  function askingFirst(): ProviderAdapter {
    return {
      ...mock,
      async *run(req, cfg, signal): AsyncIterable<AgentEvent> {
        const isReader = req.tools.some((t) => t.name === 'plan_lesson');
        const alreadyAsked = req.messages.some((m) => m.role === 'tool');
        if (isReader && !alreadyAsked) {
          const input = {
            question: 'The exponent is cut off in your photo. Is it x squared or x cubed?',
            kind: 'choice',
            options: ['x squared', 'x cubed'],
          };
          yield { t: 'tool_start', id: 'ask1', name: 'ask_learner' };
          yield { t: 'tool_end', id: 'ask1', input };
          yield { t: 'usage', inputTokens: 500, outputTokens: 60 };
          yield { t: 'stop', reason: 'tool_use' };
          return;
        }
        // After the answer, plan as the walkthrough does. The mock counts
        // assistant turns, so hand it the conversation without the detour.
        const messages = isReader ? req.messages.slice(0, 1) : req.messages;
        yield* mock.run({ ...req, messages }, cfg, signal);
      },
    };
  }

  it('is clarified while reading, waits for a real answer, then is solved', async () => {
    const h = makeSession('physics', { provider: askingFirst() });

    let answered = '';
    h.session.subscribe((s) => {
      if (s.pending && !answered) {
        answered = s.pending.question.question;
        queueMicrotask(() => h.session.answerAsk('x squared'));
      }
    });

    await h.session.start();

    expect(answered).toMatch(/cut off/);
    expect(h.phases()).toEqual(['PLANNING', 'CHECKING', 'PLANNING', 'TEACHING', 'REVIEW']);

    // The learner's answer reached the reader as a tool result.
    const second = h.requests[1] as AgentRequest;
    const result = second.messages.find((m) => m.role === 'tool');
    expect(result?.role === 'tool' && result.results[0]?.content).toContain('x squared');
  }, 30_000);

  it('does not invent an answer when the session is stopped mid-question', async () => {
    const h = makeSession('physics', { provider: askingFirst() });
    h.session.subscribe((s) => {
      if (s.pending) queueMicrotask(() => h.session.abort());
    });
    await h.session.start();

    expect(h.session.state.phase).toBe('ABORTED');
    const results = h.requests.flatMap((r) =>
      r.messages.flatMap((m) => (m.role === 'tool' ? m.results : [])),
    );
    expect(results.some((r) => r.name === 'ask_learner' && /x (squared|cubed)/.test(r.content))).toBe(false);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Interrupting and stopping
 * ------------------------------------------------------------------ */

describe('raise hand', () => {
  it('interrupts, injects the question, and carries on without starting again', async () => {
    const h = makeSession('math');

    let raised = false;
    h.session.subscribe((s) => {
      if (!raised && s.phase === 'TEACHING' && h.session.board.stepCount >= 2) {
        raised = true;
        h.session.raiseHand('Wait, why does that step work?');
      }
    });

    await h.session.start();

    expect(h.phases()).toContain('INTERRUPTED');
    expect(h.session.board.stepCount).toBeGreaterThan(2);
    expect(h.session.state.phase).toBe('REVIEW');

    const injected = h.requests
      .flatMap((r) => r.messages)
      .some((m) => m.role === 'user' && m.content.includes('why does that step work'));
    expect(injected, 'the question reached the solver').toBe(true);
  }, 30_000);
});

describe('abort', () => {
  it('stops and keeps what was already on the board', async () => {
    const h = makeSession('math');
    h.session.subscribe(() => {
      if (h.session.board.stepCount === 2) h.session.abort();
    });
    await h.session.start();

    expect(h.session.state.phase).toBe('ABORTED');
    expect(h.session.board.stepCount).toBeGreaterThan(0);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Pacing
 * ------------------------------------------------------------------ */

describe('pacing against the voice', () => {
  it('holds the model one step ahead until the screen says a step was spoken', async () => {
    const h = makeSession('math', { options: { pacing: true } });
    const run = h.session.start();

    // Nothing is acknowledging narration, so it must stop two steps in: the
    // one being spoken and one ready behind it.
    await new Promise((r) => setTimeout(r, 2500));
    expect(h.session.board.stepCount).toBe(2);
    expect(h.session.state.phase).toBe('TEACHING');

    // Each acknowledgement lets exactly one more step through.
    h.session.stepNarrated();
    await new Promise((r) => setTimeout(r, 1500));
    expect(h.session.board.stepCount).toBe(3);

    // Speak the rest as fast as they arrive, and it finishes.
    const speak = setInterval(() => h.session.stepNarrated(), 40);
    await run;
    clearInterval(speak);
    expect(h.session.state.phase).toBe('REVIEW');
  }, 30_000);

  it('lets a raised hand through without waiting for the voice', async () => {
    const h = makeSession('math', { options: { pacing: true } });
    const run = h.session.start();
    await new Promise((r) => setTimeout(r, 2500));
    expect(h.session.board.stepCount).toBe(2);

    h.session.raiseHand('What is u here?');
    await new Promise((r) => setTimeout(r, 1500));
    expect(h.phases()).toContain('INTERRUPTED');
    expect(h.session.board.stepCount).toBeGreaterThan(2);

    h.session.abort();
    await run;
  }, 30_000);

  it('is released by stopping, so a stopped session never hangs', async () => {
    const h = makeSession('math', { options: { pacing: true } });
    const run = h.session.start();
    await new Promise((r) => setTimeout(r, 2500));
    h.session.abort();
    await run;
    expect(h.session.state.phase).toBe('ABORTED');
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * A raised hand, answered and then confirmed
 * ------------------------------------------------------------------ */

describe('a raised hand with a screen attached', () => {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** Run until two steps are written and the model is being held. */
  async function heldAtTwo(): Promise<{ h: Harness; run: Promise<void> }> {
    const h = makeSession('math', { options: { pacing: true } });
    const run = h.session.start();
    await wait(2500);
    expect(h.session.board.stepCount).toBe(2);
    return { h, run };
  }

  it('writes one answer, marks it as an answer, and then holds the solution', async () => {
    const { h, run } = await heldAtTwo();

    h.session.raiseHand('Why is that allowed?');
    expect(h.session.state.aside).toBe('answering');
    await wait(1500);

    // Exactly one more step: the answer. Nothing after it until they say so.
    expect(h.session.board.stepCount).toBe(3);
    expect(h.session.state.aside).toBe('waiting');
    const answer = h.session.board.allSteps()[2];
    expect(h.session.state.asideStepIds).toEqual([answer?.id]);
    // The board shows what was asked, with its answer.
    expect(h.session.state.asideQuestions[answer?.id ?? '']).toBe('Why is that allowed?');

    // However long they take to decide, and however much has been spoken.
    h.session.stepNarrated();
    h.session.stepNarrated();
    h.session.stepNarrated();
    await wait(1200);
    expect(h.session.board.stepCount).toBe(3);

    h.session.abort();
    await run;
  }, 30_000);

  it('goes back to the solution only when the learner says it made sense', async () => {
    const { h, run } = await heldAtTwo();
    h.session.raiseHand('Why is that allowed?');
    await wait(1500);

    h.session.resumeAfterAside(true);
    expect(h.session.state.aside).toBe('none');
    const speak = setInterval(() => h.session.stepNarrated(), 40);
    await run;
    clearInterval(speak);

    expect(h.session.state.phase).toBe('REVIEW');
    expect(h.session.board.stepCount).toBeGreaterThan(3);
    // It was told to pick up where it stopped, not to start again.
    const told = h.requests
      .flatMap((r) => r.messages)
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(told.some((t) => /carry on from exactly where you stopped/.test(t))).toBe(true);
    // And only one step was ever an answer.
    expect(h.session.state.asideStepIds).toHaveLength(1);
  }, 30_000);

  it('explains again, differently, when they say it did not', async () => {
    const { h, run } = await heldAtTwo();
    h.session.raiseHand('Why is that allowed?');
    await wait(1500);

    h.session.resumeAfterAside(false);
    await wait(1500);

    // A second answer, and held again.
    expect(h.session.board.stepCount).toBe(4);
    expect(h.session.state.aside).toBe('waiting');
    expect(h.session.state.asideStepIds).toHaveLength(2);
    const told = h.requests
      .flatMap((r) => r.messages)
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(told.some((t) => /do it differently this time/.test(t))).toBe(true);

    h.session.abort();
    await run;
  }, 30_000);

  it('takes a second question while waiting on the first', async () => {
    const { h, run } = await heldAtTwo();
    h.session.raiseHand('Why is that allowed?');
    await wait(1500);
    h.session.raiseHand('And what is u?');
    await wait(1500);

    expect(h.session.state.asideStepIds).toHaveLength(2);
    expect(h.session.state.aside).toBe('waiting');
    h.session.abort();
    await run;
  }, 30_000);

  it('ignores a confirmation nobody was waiting for', async () => {
    const { h, run } = await heldAtTwo();
    h.session.resumeAfterAside(true);
    await wait(800);
    expect(h.session.board.stepCount).toBe(2);
    h.session.abort();
    await run;
  }, 30_000);
});

describe('a question after the solution is finished', () => {
  it('is answered by the same solver, and the session finishes again', async () => {
    const h = makeSession('math');
    await h.session.start();
    expect(h.session.state.phase).toBe('REVIEW');
    const before = h.requests.length;

    h.session.raiseHand('Can you go over the last line again?');
    expect(h.phases().at(-1)).toBe('INTERRUPTED');

    const deadline = Date.now() + 10_000;
    while (h.session.state.phase !== 'REVIEW' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(h.session.state.phase).toBe('REVIEW');
    expect(h.session.state.aside).toBe('none');

    // The follow-up continued the earlier conversation rather than starting
    // cold, and carried the learner's question.
    const followUp = h.requests[before] as AgentRequest;
    expect(followUp.messages.length).toBeGreaterThan(4);
    expect(
      followUp.messages.some((m) => m.role === 'user' && m.content.includes('go over the last line')),
    ).toBe(true);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Degradation (§17.4)
 * ------------------------------------------------------------------ */

describe('with no sandbox', () => {
  const off = {
    sandbox: new DisabledSandbox('Pyodide is blocked on this network.'),
    settings: { sandboxEnabled: false },
  };

  it('still solves the question and reaches the end', async () => {
    const h = makeSession('physics', off);
    await h.session.start();
    expect(h.session.board.stepCount).toBeGreaterThan(2);
    expect(h.session.state.phase).toBe('REVIEW');
  }, 30_000);

  it('does not offer run_code to the solver at all', async () => {
    const h = makeSession('physics', off);
    await h.session.start();
    for (const req of h.requests) expect(toolNames(req)).not.toContain('run_code');
    const called = h.session.trace.all().some((e) => e.t === 'tool_call' && e.name === 'run_code');
    expect(called).toBe(false);
  }, 30_000);

  it('refuses a figure that was never produced, and says why', async () => {
    // The physics walkthrough places a figure that run_code would have made.
    // With no sandbox that figure does not exist, and the step must be
    // rejected with a reason rather than rendering an empty box.
    const h = makeSession('physics', off);
    await h.session.start();

    const rejection = h.session.trace
      .all()
      .find(
        (e) =>
          e.t === 'tool_result' && e.name === 'teach_step' && !e.ok && e.content.includes('figureId'),
      );
    expect(rejection, 'the figure step was rejected').toBeTruthy();

    const figureOps = h.session.board
      .allSteps()
      .flatMap((s) => s.ops)
      .filter((o) => o.op === 'figure');
    expect(figureOps).toHaveLength(0);
  }, 30_000);
});

describe('a sandbox timeout', () => {
  it('is reported to the model and the solution continues', async () => {
    const h = makeSession('physics', { sandbox: new FakeSandbox({ ok: false, timedOut: true }) });
    await h.session.start();
    expect(h.session.state.phase).toBe('REVIEW');
    expect(h.session.board.stepCount).toBeGreaterThan(2);
  }, 30_000);
});

describe('with Wikipedia switched on', () => {
  it('offers the lookup to both agents, and not otherwise', async () => {
    const on = makeSession('physics', { settings: { wikiEnabled: true } });
    await on.session.start();
    expect(toolNames(on.requests[0] as AgentRequest)).toContain('wiki_lookup');
    expect(toolNames(on.requests.find(isSolver) as AgentRequest)).toContain('wiki_lookup');

    const offH = makeSession('physics');
    await offH.session.start();
    for (const req of offH.requests) expect(toolNames(req)).not.toContain('wiki_lookup');
  }, 30_000);
});

describe('the demo', () => {
  it('needs no key and makes no network request', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('the demo must not touch the network');
    }) as typeof fetch;
    try {
      const h = makeSession('biology');
      await h.session.start();
      expect(h.session.state.phase).toBe('REVIEW');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Budget
 * ------------------------------------------------------------------ */

describe('budget exhaustion', () => {
  it('closes the solution deliberately instead of dying mid-sentence', async () => {
    const h = makeSession('math', {
      settings: { budget: { inputTokens: 4000, outputTokens: 1000 } },
    });
    await h.session.start();

    const state = h.session.state;
    expect(state.ending, 'it was closed, not dropped').toBeTruthy();
    expect(state.phase).toBe('REVIEW');
    expect(h.session.board.stepCount).toBeGreaterThan(0);
  }, 30_000);
});
