/**
 * The degradation ladder, rung by rung (§17.4, §25).
 *
 * "All five degradation rungs are reachable and tested."
 *
 * Each rung has to be a real, working mode rather than a hypothetical, because
 * every one of them is somebody's normal Tuesday: a locked-down school network
 * blocks the Pyodide CDN, a library needs the sound off, a laptop with a small
 * local model cannot call tools, and a train tunnel has no network at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { Session } from './session';
import { mock, setMockLesson } from '../providers/mock';
import { LearnerStore } from '../memory/store';
import { MaterialsStore } from '../materials/store';
import { DisabledSandbox, SandboxHost } from '../sandbox/host';
import { DEFAULT_SETTINGS, type Settings } from '../storage/settings';
import type { AdapterConfig, AgentEvent, AgentRequest, ProviderAdapter } from '../providers/types';
import type { SandboxPort } from '../tools/context';
import { splitSentences, estimateDurationMs, speechAvailable } from '../voice/speech';

function makeSession(opts: {
  provider?: ProviderAdapter;
  settings?: Partial<Settings>;
  sandbox?: SandboxPort;
} = {}): Session {
  setMockLesson('math');
  return new Session({
    subject: 'math',
    topic: 'the chain rule',
    level: 'school',
    provider: opts.provider ?? mock,
    adapterConfig: { apiKey: '' },
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    memory: new LearnerStore(),
    materials: new MaterialsStore(),
    sandbox: opts.sandbox ?? new DisabledSandbox(),
    models: {
      planner: 'mock-replay',
      tutor: 'mock-replay',
      examiner: 'mock-replay',
      repairer: 'mock-replay',
    },
    contextWindow: 200_000,
  });
}

function autoAnswer(session: Session): void {
  session.subscribe((s) => {
    const pending = s.pending;
    if (!pending) return;
    queueMicrotask(() => {
      if (pending.kind === 'ask') session.answerAsk(pending.question.options?.[0] ?? 'yes');
      else session.answerQuiz(pending.questions.map((q) => q.answer));
    });
  });
}

/* ------------------------------------------------------------------ *
 * Rung 2 — no sandbox
 * ------------------------------------------------------------------ */

describe('rung 2: no sandbox', () => {
  it('reports why, so the tutor is told rather than left to discover it', () => {
    const sandbox = new DisabledSandbox('the Pyodide CDN is blocked on this network.');
    expect(sandbox.available()).toBe(false);
    expect(sandbox.unavailableReason()).toContain('Pyodide');
  });

  it('teaches a whole lesson anyway', async () => {
    const session = makeSession({ settings: { sandboxEnabled: false } });
    autoAnswer(session);
    await session.start();
    expect(session.board.stepCount).toBeGreaterThan(2);
    expect(session.state.phase).toBe('REVIEW');
  }, 30_000);

  it('recovers when the sandbox frame never loads', async () => {
    // No document body to attach the frame to means boot fails; the port must
    // report that rather than hanging the tool call forever.
    const host = new SandboxHost('https://example.invalid/');
    const result = await host.run('javascript', 'return 1', new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.error ?? '').not.toBe('');
    host.dispose();
  }, 20_000);
});

/* ------------------------------------------------------------------ *
 * Rung 3 — no voice
 * ------------------------------------------------------------------ */

describe('rung 3: no voice', () => {
  it('is the environment these tests already run in', () => {
    // jsdom has no speech synthesis, so the whole suite exercises muted mode.
    expect(speechAvailable()).toBe(false);
  });

  it('still paces the board from the narration length', () => {
    const short = estimateDurationMs('A short line.', 1);
    const long = estimateDurationMs('A considerably longer line with a good many more words in it than the other one had.', 1);
    expect(long).toBeGreaterThan(short);
    // Rate control applies to reveal timing as well as speech (§14).
    expect(estimateDurationMs('same text here', 1.5)).toBeLessThan(
      estimateDurationMs('same text here', 0.75),
    );
  });

  it('splits narration into utterances short enough for a backgrounded tab', () => {
    const say =
      'Integration by parts is not a new idea. It is the product rule, read backwards. Let me show you where it comes from, because if you can rebuild it you will never misremember it.';
    const parts = splitSentences(say);
    expect(parts.length).toBeGreaterThan(1);
    // Chrome cuts an utterance after roughly fifteen seconds when the tab is
    // in the background, so none may be long enough to hit that.
    for (const part of parts) {
      expect(estimateDurationMs(part, 1)).toBeLessThan(15_000);
    }
    expect(parts.join(' ')).toBe(say);
  });

  it('keeps a transcript, so a muted lesson is readable in full', async () => {
    const session = makeSession({ settings: { muted: true } });
    autoAnswer(session);
    await session.start();
    expect(session.state.transcript.length).toBe(session.board.stepCount);
    expect(session.state.transcript.every((t) => t.say.length > 20)).toBe(true);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Rung 4 — scripted mode
 * ------------------------------------------------------------------ */

/** A provider that cannot call tools — the case this rung exists for. */
function uselessProvider(ndjson: string): ProviderAdapter {
  return {
    ...mock,
    id: 'compatible',
    label: 'A small local model',
    async *run(req: AgentRequest, _cfg: AdapterConfig): AsyncIterable<AgentEvent> {
      if (req.tools.length === 0) {
        // Scripted mode asks with no tools at all, and this it can manage.
        yield { t: 'text', delta: ndjson };
        yield { t: 'usage', inputTokens: 800, outputTokens: 600 };
        yield { t: 'stop', reason: 'end_turn' };
        return;
      }
      // Given tools, it produces prose and no call, every time.
      yield { t: 'text', delta: 'Sure! I would be happy to teach that.' };
      yield { t: 'usage', inputTokens: 900, outputTokens: 40 };
      yield { t: 'stop', reason: 'end_turn' };
    },
  };
}

const SCRIPT = [
  '{"say":"The chain rule is about a function inside another function.","board":[{"op":"heading","text":"The chain rule"}]}',
  '{"say":"Differentiate the outside, leave the inside alone, then multiply by the derivative of the inside.","board":[{"op":"math","tex":"\\\\frac{d}{dx}f(g(x)) = f\'(g(x))g\'(x)"}]}',
  '{"say":"Try it on sine of x squared and you get cosine of x squared times two x.","board":[{"op":"text","text":"d/dx sin(x^2) = cos(x^2) · 2x","tone":"key"}]}',
].join('\n');

describe('rung 4: scripted mode', () => {
  it('is offered after three turns with no valid tool call, not before', async () => {
    const session = makeSession({ provider: uselessProvider(SCRIPT) });
    await session.start();

    expect(session.state.scriptedOffered, 'the reduced mode was offered').toBe(true);
    // It is offered, never switched on behind the learner's back.
    expect(session.state.scriptedMode).toBe(false);
  }, 30_000);

  it('teaches the lesson once the learner accepts', async () => {
    const session = makeSession({ provider: uselessProvider(SCRIPT) });
    await session.start();
    await session.runScripted();

    expect(session.state.scriptedMode).toBe(true);
    expect(session.board.stepCount).toBe(3);
    expect(session.state.transcript[0]?.say).toContain('chain rule');
    // The board still gets real operations, validated the same way.
    const ops = session.board.allSteps().flatMap((s) => s.ops);
    expect(ops.length).toBe(3);
    expect(ops.some((o) => o.op === 'math')).toBe(true);
  }, 30_000);

  it('says so plainly rather than pretending the lesson was normal', async () => {
    const session = makeSession({ provider: uselessProvider(SCRIPT) });
    await session.start();
    await session.runScripted();
    expect(session.state.ending?.summary).toMatch(/reduced mode/i);
    expect(session.state.ending?.runExam).toBe(false);
  }, 30_000);

  it('fails honestly when even the reduced mode produces nothing usable', async () => {
    const session = makeSession({ provider: uselessProvider('I cannot help with that.') });
    await session.start();
    await session.runScripted();
    expect(session.state.error?.message).toMatch(/could not produce a usable lesson/i);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Rung 5 — replay
 * ------------------------------------------------------------------ */

describe('rung 5: replay', () => {
  it('needs no key and makes no network request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const session = makeSession();
    autoAnswer(session);
    await session.start();

    expect(fetchSpy, 'replay mode reached the network').not.toHaveBeenCalled();
    expect(session.board.stepCount).toBeGreaterThan(2);
    expect(session.state.phase).toBe('REVIEW');

    vi.unstubAllGlobals();
  }, 30_000);

  it('declares itself a demo, so no screen has to name the adapter', () => {
    expect(mock.demo).toBe(true);
    expect(mock.keyOptional).toBe(true);
    expect(mock.demoNote ?? '').toMatch(/no key/i);
  });
});
