/**
 * Tool schemas accept good input and reject each documented bad case, and the
 * JSON Schema handed to the provider is generated from the same source (§9).
 */
import { describe, expect, it } from 'vitest';
import {
  AskLearnerInput,
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

  it('rejects fewer than three steps, and accepts a short worked solution', () => {
    expect(PlanLessonInput.safeParse({ ...base, steps: base.steps.slice(0, 2) }).success).toBe(false);
    expect(PlanLessonInput.safeParse({ ...base, steps: base.steps.slice(0, 3) }).success).toBe(true);
  });

  it('carries the question restated in full, for the solver that cannot see the upload', () => {
    const r = PlanLessonInput.safeParse({ ...base, problem: 'A ball is thrown at 20 m/s at 40 degrees. How far does it land?' });
    expect(r.success).toBe(true);
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
  it('has the nine tools from §9', () => {
    expect(ALL_TOOLS).toHaveLength(9);
  });

  it('matches the §8.1 access matrix', () => {
    const bus = createToolBus();
    const names = (agent: (typeof AGENT_IDS)[number]) =>
      bus
        .specsFor(agent)
        .map((s) => s.name)
        .sort();

    // The reader is the only one that may ask, and only to clarify.
    expect(names('planner')).toEqual(['ask_learner', 'plan_lesson', 'wiki_lookup'].sort());
    // The solver cannot ask the learner anything at all.
    expect(names('tutor')).toEqual(
      ['compute', 'end_lesson', 'run_code', 'save_note', 'teach_step', 'wiki_lookup'].sort(),
    );
    expect(names('repairer')).toEqual(['fix_board']);
  });

  it('has nothing left from quizzing, exams or a learner record', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    for (const gone of [
      'check_understanding',
      'finish_exam',
      'recall_learner',
      'update_learner',
      'schedule_review',
      'search_materials',
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it('gives every tool a description written for the model, not a stub', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(120);
    }
  });
});
