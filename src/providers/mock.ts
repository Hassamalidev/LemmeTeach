/**
 * The mock adapter (§5.6).
 *
 * Emits the same `AgentEvent` sequence a real provider would, with realistic
 * timing, so the whole product — board, voice, sandbox, memory, interruption,
 * remediation — is exercisable with no key and no network. This is the main
 * test surface (§22) and the demo on the landing page.
 *
 * Two sources, in order of preference:
 *
 *  1. A **recorded tape** in `src/fixtures/tapes/`, captured from a real
 *     session by `npm run record`. Tapes are the real thing and are what the
 *     integration tests should run against.
 *  2. Failing that, a **fixture lesson** replayed as if a model had produced
 *     it. This is authored content, not a recording, and it is labelled as
 *     such wherever it surfaces — it exists so the UI can be developed and
 *     demonstrated before anyone has spent a token, not to stand in for
 *     evidence of what models actually emit.
 */
import type { SubjectId } from '../core/types';
import type { AdapterConfig, AgentEvent, AgentRequest, ModelInfo, ProviderAdapter } from './types';
import { FIXTURE_LESSONS, fixtureFor, type FixtureLesson, type FixtureLine } from '../fixtures';
import { listTapes, loadTapeEvents } from '../fixtures/tapes';

/** Which lesson the mock will replay next. Set by the orchestrator. */
let selectedSubject: SubjectId = 'math';
let selectedTapeId: string | null = null;

export function setMockLesson(subject: SubjectId, tapeId?: string | null): void {
  selectedSubject = subject;
  selectedTapeId = tapeId ?? null;
}

export function mockSourceLabel(): string {
  if (selectedTapeId) return `recorded session "${selectedTapeId}"`;
  const lesson = fixtureFor(selectedSubject) ?? FIXTURE_LESSONS[0];
  return `sample lesson "${lesson?.meta.title ?? 'untitled'}" (written, not recorded)`;
}

const MODELS: ModelInfo[] = [
  { id: 'mock-replay', label: 'Replay — no key needed', contextWindow: 200_000, tools: true },
];

export const mock: ProviderAdapter = {
  id: 'mock',
  label: 'Try it without a key',
  defaultModel: 'mock-replay',
  keyPlaceholder: 'no key needed',
  keyHelpUrl: '',
  keyHint: 'Replays a bundled lesson. Nothing leaves your browser and nothing is charged.',
  demo: true,
  demoNote:
    'Replay mode plays a bundled lesson with no key and no network. Everything works — the board, the voice, the questions, the notes — except that the tutor cannot respond to anything you have not been shown.',
  supportsToolChoice: true,
  supportsParallelToolCalls: false,
  keyOptional: true,

  async models(): Promise<ModelInfo[]> {
    return MODELS;
  },

  async *run(req: AgentRequest, _cfg: AdapterConfig, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const tape = selectedTapeId ? await loadTapeEvents(selectedTapeId) : null;
    if (tape) {
      yield* replayTape(tape, req, signal);
      return;
    }

    const lesson = fixtureFor(selectedSubject) ?? FIXTURE_LESSONS[0];
    if (!lesson) {
      yield { t: 'stop', reason: 'end_turn' };
      return;
    }
    yield* replayFixture(lesson, req, signal);
  },
};

export function availableTapes(): string[] {
  return listTapes();
}

/* ------------------------------------------------------------------ *
 * Replaying a real recorded tape
 * ------------------------------------------------------------------ */

async function* replayTape(
  events: AgentEvent[],
  req: AgentRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  // A tape is a flat event log across the whole session; turns are separated
  // by their `stop` events, so the turn index picks the slice to emit.
  const turns: AgentEvent[][] = [];
  let current: AgentEvent[] = [];
  for (const e of events) {
    current.push(e);
    if (e.t === 'stop') {
      turns.push(current);
      current = [];
    }
  }
  if (current.length) turns.push(current);

  const slice = turns[turnIndex(req)] ?? turns[turns.length - 1];
  if (!slice) {
    yield { t: 'stop', reason: 'end_turn' };
    return;
  }

  for (const e of slice) {
    signal.throwIfAborted();
    await pause(e.t === 'text' ? 12 : 40, signal);
    yield e;
  }
}

/* ------------------------------------------------------------------ *
 * Replaying an authored fixture lesson
 * ------------------------------------------------------------------ */

async function* replayFixture(
  lesson: FixtureLesson,
  req: AgentRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const role = roleOf(req);
  const turn = turnIndex(req);

  if (role === 'planner') {
    const plan = lesson.lines.find((l) => l.t === 'plan');
    if (plan) {
      const { t: _t, ...rest } = plan;
      yield* emitCall('plan_lesson', rest, signal);
      yield { t: 'usage', inputTokens: 900, outputTokens: 320 };
      yield { t: 'stop', reason: 'tool_use' };
      return;
    }
  }

  if (role === 'examiner') {
    yield* emitExam(lesson, turn, signal);
    return;
  }

  // Tutor: walk the teaching lines one per turn, exactly as a tutor would.
  //
  // Lines whose tool was not offered this session are dropped rather than
  // replayed — a real model does not call a tool it was never given, and a
  // mock that does would make the degradation rungs untestable.
  const offered = new Set(req.tools.map((t) => t.name));
  const teaching = lesson.lines.filter((l): l is FixtureLine => {
    switch (l.t) {
      case 'step':
        return offered.has('teach_step');
      case 'ask':
        return offered.has('ask_learner');
      case 'check':
        return offered.has('check_understanding');
      case 'code':
        return offered.has('run_code');
      case 'end':
        return true;
      default:
        return false;
    }
  });
  const line = teaching[turn];

  if (!line) {
    yield* emitCall('end_lesson', {
      summary: 'That is where we will stop for today.',
      objectivesMet: [],
      objectivesMissed: [],
      nextTopics: [],
      runExam: false,
    }, signal);
    yield { t: 'usage', inputTokens: 1200, outputTokens: 120 };
    yield { t: 'stop', reason: 'tool_use' };
    return;
  }

  switch (line.t) {
    case 'step':
      yield* emitCall(
        'teach_step',
        { say: line.say, board: line.board, clear: line.clear ?? false, objective: line.objective },
        signal,
      );
      break;
    case 'ask':
      yield* emitCall(
        'ask_learner',
        { question: line.question, kind: line.kind, options: line.options, why: line.why },
        signal,
      );
      break;
    case 'check':
      yield* emitCall('check_understanding', { questions: line.questions }, signal);
      break;
    case 'code':
      yield* emitCall(
        'run_code',
        {
          language: line.language,
          source: line.source,
          purpose: line.purpose,
          expect: line.expect,
        },
        signal,
      );
      break;
    case 'end':
      yield* emitCall('end_lesson', {
        summary: line.summary,
        objectivesMet: line.objectivesMet,
        objectivesMissed: line.objectivesMissed,
        nextTopics: line.nextTopics,
        runExam: line.runExam,
      }, signal);
      break;
    default:
      break;
  }

  yield { t: 'usage', inputTokens: 1400 + turn * 700, outputTokens: 480 };
  yield { t: 'stop', reason: 'tool_use' };
}

async function* emitExam(
  lesson: FixtureLesson,
  turn: number,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const checks = lesson.lines.filter((l): l is Extract<FixtureLine, { t: 'check' }> => l.t === 'check');
  const questions = checks.flatMap((c) => c.questions).slice(0, 5);

  if (turn === 0 && questions.length >= 2) {
    yield* emitCall('check_understanding', { questions: questions.slice(0, 4) }, signal);
  } else {
    yield* emitCall(
      'finish_exam',
      {
        score: 0.8,
        strengths: ['Held on to the main idea and could restate it'],
        gaps: ['Still hesitant when the setup is unfamiliar'],
        verdict: 'Ready to move on, with one more pass over the tricky case.',
      },
      signal,
    );
  }

  yield { t: 'usage', inputTokens: 2200, outputTokens: 300 };
  yield { t: 'stop', reason: 'tool_use' };
}

/**
 * Emit one tool call the way a real provider does — streamed argument
 * fragments, then a resolved input. The board's incremental parse (§6) has to
 * be exercised by the mock or it is never exercised at all.
 */
async function* emitCall(
  name: string,
  input: unknown,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const id = `mock_${name}_${Math.random().toString(36).slice(2, 8)}`;
  yield { t: 'tool_start', id, name };

  const json = JSON.stringify(input);
  const chunk = 90;
  for (let i = 0; i < json.length; i += chunk) {
    signal.throwIfAborted();
    await pause(18, signal);
    yield { t: 'tool_delta', id, json: json.slice(i, i + chunk) };
  }

  await pause(30, signal);
  yield { t: 'tool_end', id, input };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Which agent is calling, inferred from the tools it was given — never a flag. */
function roleOf(req: AgentRequest): 'planner' | 'tutor' | 'examiner' | 'repairer' {
  const names = new Set(req.tools.map((t) => t.name));
  if (names.has('plan_lesson')) return 'planner';
  if (names.has('finish_exam')) return 'examiner';
  if (names.has('fix_board')) return 'repairer';
  return 'tutor';
}

/** Turn number within this agent's run: how many times it has already replied. */
function turnIndex(req: AgentRequest): number {
  return req.messages.filter((m) => m.role === 'assistant').length;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
