/**
 * Spending fewer tokens (§18).
 *
 * Two things are held here. A question that has already been solved plays
 * back without a single request. And what is sent to the model on every turn
 * stays small: the board's shapes are described once, not twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../orchestrator/session';
import { mock, setMockLesson } from './mock';
import { canReplay, findSolved, questionKey, replayAdapter, savedFigureIds, savedSteps } from './replay';
import { DEFAULT_SETTINGS } from '../storage/settings';
import type { SolutionRecord } from '../storage/records';
import type { SandboxPort } from '../tools/context';
import { createToolBus } from '../tools/registry';
import { minifySchema, toJsonSchema } from '../tools/json-schema';
import { TeachStepInput } from '../tools/schemas';
import { BOARD_OP_KINDS } from '../board/op-schema';
import { solverPrompt } from '../agents';
import { compact, KEEP_RECENT_TURNS } from '../runtime/compact';
import type { AgentMessage } from './types';

const noSandbox: SandboxPort = {
  available: () => false,
  unavailableReason: () => 'off',
  run: async () => ({ ok: false, stdout: '', result: '', figures: [], timedOut: false }),
};

const tokens = (s: string): number => Math.ceil(s.length / 4);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Solve the maths walkthrough once and hand back what would have been saved. */
async function solveOnce(): Promise<SolutionRecord> {
  setMockLesson('math');
  const session = new Session({
    topic: 'Integrate x cos(x) dx.',
    subject: 'general',
    level: 'school',
    provider: mock,
    adapterConfig: { apiKey: '' },
    settings: { ...DEFAULT_SETTINGS, sandboxEnabled: false },
    sandbox: noSandbox,
    models: { planner: 'm', tutor: 'm', repairer: 'm' },
    contextWindow: 200_000,
  });
  await session.start();
  const state = session.state;
  return {
    id: session.id,
    subject: session.subject,
    topic: session.topic,
    title: state.plan?.title ?? '',
    level: session.level,
    startedAt: Date.now() - 86_400_000,
    plan: state.plan,
    // Through JSON, as IndexedDB would hand it back: plain data, no classes.
    pages: JSON.parse(JSON.stringify(state.pages)) as unknown,
    transcript: state.transcript,
    notes: state.notes,
    ending: state.ending ?? undefined,
  };
}

describe('replaying a solved question', () => {
  it('plays the same board and narration back without one request', async () => {
    const record = await solveOnce();
    expect(canReplay(record)).toBe(true);

    let requests = 0;
    vi.stubGlobal('fetch', async () => {
      requests += 1;
      throw new Error('a replay must not touch the network');
    });

    const replayed = new Session({
      ephemeral: true,
      topic: record.topic,
      subject: record.subject,
      level: record.level,
      provider: replayAdapter(record),
      adapterConfig: { apiKey: '' },
      settings: DEFAULT_SETTINGS,
      sandbox: noSandbox,
      knownFigures: savedFigureIds(record),
      models: { planner: 'replay', tutor: 'replay', repairer: 'replay' },
      contextWindow: 1_000_000,
    });
    await replayed.start();

    expect(requests).toBe(0);
    expect(replayed.state.phase).toBe('REVIEW');

    const before = savedSteps(record);
    const after = replayed.board.allSteps();
    expect(after.map((s) => s.say)).toEqual(before.map((s) => s.say));
    expect(after.map((s) => s.ops)).toEqual(before.map((s) => s.ops));
    expect(replayed.state.ending?.summary).toBe(record.ending?.summary);
    expect(replayed.state.plan?.title).toBe(record.title);

    // And it cost nothing, which the meter can say for certain.
    const budget = replayed.state.budget;
    expect(budget.inputTokens + budget.outputTokens).toBe(0);
    expect(budget.estimatedCostUsd).toBe(0);
    expect(budget.costIsExact).toBe(true);
  }, 30_000);

  it('keeps the sections of the board where they were', async () => {
    const record = await solveOnce();
    const pages = record.pages as { steps: unknown[] }[];
    const starts = savedSteps(record).filter((s) => s.clear).length;
    expect(starts).toBe(pages.filter((p) => p.steps.length > 0).length - 1);
  }, 30_000);

  it('has nothing to replay from a record with no board', () => {
    const empty = { pages: [], notes: [], topic: 'x' } as unknown as SolutionRecord;
    expect(canReplay(empty)).toBe(false);
    expect(savedSteps({ ...empty, pages: 'corrupt' })).toEqual([]);
  });
});

describe('recognising a question asked before', () => {
  const solved = (topic: string, over: Partial<SolutionRecord> = {}): SolutionRecord =>
    ({
      id: topic,
      topic,
      title: topic,
      subject: 'math',
      level: 'school',
      startedAt: 1,
      pages: [{ steps: [{ say: 'First.', ops: [] }] }],
      transcript: [],
      notes: [],
      ending: { summary: 's', objectivesMet: [], objectivesMissed: [], nextTopics: [] },
      ...over,
    }) as SolutionRecord;

  it('ignores case, spacing and punctuation', () => {
    const history = [solved('Integrate x cos(x) dx.')];
    expect(findSolved('integrate   x cos(x) dx', history)?.id).toBe('Integrate x cos(x) dx.');
    expect(findSolved('INTEGRATE X COS(X) DX!', history)).not.toBeNull();
  });

  it('does not confuse two different questions', () => {
    const history = [solved('Integrate x cos(x) dx.')];
    expect(findSolved('Integrate x sin(x) dx.', history)).toBeNull();
    expect(findSolved('Integrate x^2 cos(x) dx.', history)).toBeNull();
    // The operators that change a question survive the tidying.
    expect(questionKey('x^2 + 3')).not.toBe(questionKey('x^2 - 3'));
    expect(questionKey('x*2')).not.toBe(questionKey('x/2'));
  });

  it('will not offer a solution that never finished, or one too short to be sure of', () => {
    expect(findSolved('Integrate x cos(x) dx.', [solved('Integrate x cos(x) dx.', { ending: undefined })])).toBeNull();
    expect(findSolved('x', [solved('x')])).toBeNull();
  });

  it('prefers the most recent, which the history lists first', () => {
    const history = [solved('What is 2 + 2?', { id: 'new' }), solved('What is 2 + 2?', { id: 'old' })];
    expect(findSolved('what is 2 + 2', history)?.id).toBe('new');
  });
});

describe('what is sent to the model on every turn', () => {
  const bus = createToolBus();
  const solver = bus.specsFor('tutor', new Set(['wiki_lookup']));
  const teach = solver.find((t) => t.name === 'teach_step');

  it('names the thirteen board operations without spelling each one out again', () => {
    const board = teach?.parameters.properties?.board;
    const items = board?.items as { properties?: { op?: { enum?: string[] } }; anyOf?: unknown } | undefined;
    expect(items?.properties?.op?.enum).toEqual(BOARD_OP_KINDS);
    expect(items?.anyOf).toBeUndefined();
    // The full shapes are still what a call is checked against.
    const full = toJsonSchema(TeachStepInput).properties?.board?.items as { anyOf?: unknown[] };
    expect(full.anyOf).toHaveLength(13);
  });

  it('still tells the model the shapes, once, in the system prompt', () => {
    const prompt = solverPrompt({ subject: 'math', level: 'school', topic: 'x', sandbox: true, wiki: false });
    for (const op of BOARD_OP_KINDS) expect(prompt, op).toContain(`"op":"${op}"`);
  });

  it('drops what only a validator needs and keeps what the model reads', () => {
    const slim = minifySchema({
      type: 'object',
      additionalProperties: false,
      required: ['say'],
      properties: {
        say: { type: 'string', minLength: 1, maxLength: 1200, description: 'Spoken.' },
        kind: { type: 'string', const: 'a', enum: ['a'] },
        list: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', pattern: '^x' } },
      },
    });
    expect(slim).toEqual({
      type: 'object',
      required: ['say'],
      properties: {
        say: { type: 'string', description: 'Spoken.' },
        kind: { type: 'string', enum: ['a'] },
        list: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  it('sends every tool as a schema the strictest service accepts', () => {
    // One service refused the whole request over a tuple written as an `items`
    // array, and another turn over a note a few characters past its limit.
    const limits = ['minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'minimum', 'maximum'];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (!node || typeof node !== 'object') return;
      const schema = node as Record<string, unknown>;
      expect(Array.isArray(schema.items), `${path}.items is a tuple`).toBe(false);
      if (typeof schema.type === 'string') {
        for (const key of limits) expect(schema[key], `${path}.${key}`).toBeUndefined();
        expect(schema.additionalProperties, `${path}.additionalProperties`).toBeUndefined();
      }
      if (schema.required !== undefined) {
        const props = Object.keys((schema.properties ?? {}) as object);
        for (const name of schema.required as string[]) expect(props, `${path}.required`).toContain(name);
      }
      for (const [k, v] of Object.entries(schema)) {
        if (k === 'properties') {
          for (const [name, sub] of Object.entries(v as object)) walk(sub, `${path}.${name}`);
        } else if (k === 'items' || k === 'anyOf') walk(v, `${path}.${k}`);
      }
    };
    for (const agent of ['planner', 'tutor', 'repairer'] as const) {
      for (const spec of bus.specsFor(agent)) {
        expect(spec.parameters.type, spec.name).toBe('object');
        walk(spec.parameters, spec.name);
      }
    }
  });

  it('turns a tuple into a plain array', () => {
    const slim = minifySchema({
      type: 'object',
      properties: { domain: { type: 'array', items: [{ type: 'number' }, { type: 'number' }], minItems: 2, maxItems: 2 } },
    });
    expect(slim.properties?.domain).toEqual({ type: 'array', items: { type: 'number' } });
  });

  it('keeps the solver’s fixed cost per turn under budget', () => {
    const prompt = solverPrompt({ subject: 'math', level: 'school', topic: 'x', sandbox: true, wiki: false });
    const fixed = tokens(prompt) + tokens(JSON.stringify(solver));
    // It was about 6,050 before this work. This is sent on every turn of every
    // question, so it is held down by a test rather than by good intentions.
    expect(fixed, `fixed prefix is ${fixed} tokens`).toBeLessThan(4200);
    expect(tokens(JSON.stringify(teach)), 'teach_step').toBeLessThan(600);
  });

  it('keeps the reader’s even smaller', () => {
    const reader = bus.specsFor('planner', new Set(['wiki_lookup']));
    expect(tokens(JSON.stringify(reader))).toBeLessThan(1300);
  });
});

describe('a long conversation', () => {
  it('is cut back to the opening, a summary and the last few turns', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: 'Solve this.' }];
    for (let i = 0; i < 30; i++) {
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: `c${i}`, name: 'teach_step', input: { say: 'x'.repeat(2400), board: [] } }],
      });
      messages.push({ role: 'tool', results: [{ id: `c${i}`, name: 'teach_step', ok: true, content: '{}' }] });
    }
    const out = compact(messages, { contextWindow: 14_000, boardSummary: '- step one\n- step two' });
    expect(out.length).toBeLessThan(messages.length);
    // Opening + summary + the recent turns, each a call and its result.
    expect(out.length).toBeLessThanOrEqual(2 + KEEP_RECENT_TURNS * 2);
    expect(JSON.stringify(out)).toContain('step one');
    // The last call and its result are intact and still paired.
    const last = out.at(-1);
    expect(last?.role === 'tool' && last.results[0]?.id).toBe('c29');
  });

  it('is left alone while it is short', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: 'Solve this.' }];
    expect(compact(messages, { contextWindow: 14_000 })).toBe(messages);
  });
});
