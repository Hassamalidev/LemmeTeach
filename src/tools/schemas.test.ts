/**
 * Tool schemas accept good input and reject each documented bad case, and the
 * JSON Schema handed to the provider is generated from the same source (§9).
 */
import { describe, expect, it } from 'vitest';
import {
  AskLearnerInput,
  CheckUnderstandingInput,
  PlanLessonInput,
  TeachStepInput,
} from './schemas';
import { toJsonSchema } from './json-schema';
import { createToolBus, ALL_TOOLS } from './registry';
import { AGENT_IDS } from '../core/types';

describe('teach_step', () => {
  it('accepts a normal step', () => {
    const r = TeachStepInput.safeParse({
      say: 'Watch what happens when I double the resistance.',
      board: [{ op: 'text', text: 'V = IR' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a step with no narration', () => {
    const r = TeachStepInput.safeParse({ say: '', board: [] });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown field on the call itself', () => {
    const r = TeachStepInput.safeParse({ say: 'hello there', board: [], speed: 2 });
    expect(r.success).toBe(false);
  });
});

describe('ask_learner', () => {
  it('requires options when the kind is choice', () => {
    const bad = AskLearnerInput.safeParse({ question: 'Which one?', kind: 'choice' });
    expect(bad.success).toBe(false);
    const good = AskLearnerInput.safeParse({
      question: 'Which one?',
      kind: 'choice',
      options: ['a', 'b'],
    });
    expect(good.success).toBe(true);
  });

  it('does not require options for a free answer', () => {
    const r = AskLearnerInput.safeParse({ question: 'What do you think?', kind: 'free' });
    expect(r.success).toBe(true);
  });
});

describe('check_understanding', () => {
  const q = (answer: number) => ({
    q: 'Which is conserved?',
    options: ['Momentum', 'Energy'],
    answer,
    why: 'because',
    concept: 'collision',
  });

  it('rejects an answer index outside the options', () => {
    const r = CheckUnderstandingInput.safeParse({ questions: [q(0), q(7)] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('out of range');
    }
  });

  it('rejects a single-question check — that is what ask_learner is for', () => {
    const r = CheckUnderstandingInput.safeParse({ questions: [q(0)] });
    expect(r.success).toBe(false);
  });
});

describe('plan_lesson', () => {
  const base = {
    title: 'Integration by parts',
    level: 'undergrad',
    objectives: [
      { id: 'obj-1', text: 'The learner can choose u and dv sensibly' },
      { id: 'obj-2', text: 'The learner can apply the formula to a polynomial times a trig function' },
      { id: 'obj-3', text: 'The learner can recognise when to apply it twice' },
    ],
    prerequisites: [{ concept: 'product-rule', held: true, recap: false }],
    steps: Array.from({ length: 5 }, () => ({
      objective: 'obj-1',
      representation: 'derivation' as const,
      note: 'derive from the product rule',
    })),
    estimatedMinutes: 12,
  };

  it('accepts a complete plan', () => {
    expect(PlanLessonInput.safeParse(base).success).toBe(true);
  });

  it('rejects fewer than three objectives', () => {
    const r = PlanLessonInput.safeParse({ ...base, objectives: base.objectives.slice(0, 2) });
    expect(r.success).toBe(false);
  });

  it('rejects fewer than five steps', () => {
    const r = PlanLessonInput.safeParse({ ...base, steps: base.steps.slice(0, 3) });
    expect(r.success).toBe(false);
  });
});

describe('generated JSON Schema', () => {
  it('describes teach_step as an object with the fields the model needs', () => {
    const js = toJsonSchema(TeachStepInput);
    expect(js.type).toBe('object');
    expect(js.properties?.say?.type).toBe('string');
    expect(js.required).toContain('say');
    expect(js.required).toContain('board');
    expect(js.required).not.toContain('clear');
  });

  it('carries the field descriptions through, since they instruct the model', () => {
    const js = toJsonSchema(TeachStepInput);
    expect(js.properties?.say?.description).toMatch(/spoken/i);
  });

  it('turns the board op union into a real anyOf', () => {
    const js = toJsonSchema(TeachStepInput);
    const board = js.properties?.board;
    expect(board?.type).toBe('array');
    const items = board?.items as { anyOf?: unknown[] } | undefined;
    expect(items?.anyOf?.length).toBe(13);
  });

  it('generates a schema for every tool without throwing', () => {
    for (const tool of ALL_TOOLS) {
      expect(() => toJsonSchema(tool.schema), tool.name).not.toThrow();
    }
  });
});

describe('the catalog', () => {
  it('has the fifteen tools from §9', () => {
    expect(ALL_TOOLS).toHaveLength(15);
  });

  it('matches the §8.1 access matrix', () => {
    const bus = createToolBus();
    const names = (agent: (typeof AGENT_IDS)[number]) =>
      bus
        .specsFor(agent)
        .map((s) => s.name)
        .sort();

    expect(names('planner')).toEqual(
      ['plan_lesson', 'recall_learner', 'search_materials', 'wiki_lookup'].sort(),
    );
    expect(names('tutor')).toEqual(
      [
        'ask_learner',
        'check_understanding',
        'compute',
        'end_lesson',
        'recall_learner',
        'run_code',
        'save_note',
        'search_materials',
        'teach_step',
        'update_learner',
        'wiki_lookup',
      ].sort(),
    );
    expect(names('examiner')).toEqual(
      [
        'ask_learner',
        'check_understanding',
        'compute',
        'finish_exam',
        'recall_learner',
        'schedule_review',
        'update_learner',
      ].sort(),
    );
    expect(names('repairer')).toEqual(['fix_board']);
  });

  it('gives every tool a description written for the model, not a stub', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120);
    }
  });
});
