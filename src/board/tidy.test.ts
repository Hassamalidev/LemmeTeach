/**
 * Tidying board operations before they are checked (§10.3, §18).
 *
 * The first case is the call a real model made five times in a row on one
 * step, each rejection costing a full turn.
 */
import { describe, expect, it } from 'vitest';
import { balanceBraces, explainOps, OP_SHAPES, tidyOps } from './tidy';
import { BOARD_OP_KINDS } from './op-schema';
import { TeachStepInput } from '../tools/schemas';
import { BOARD_CONTRACT } from '../agents/prompts/base';

const fits = (board: unknown): boolean => TeachStepInput.safeParse({ say: 'Next.', board }).success;

describe('tidying operations', () => {
  it('puts {"derive": [...]} into the shape the board takes', () => {
    const sent = [
      {
        derive: [
          { note: 'vertical component', tex: 'v_{0y} = v_0 \\sin\\theta \\approx 11.47' },
          { note: 'horizontal component', tex: 'v_{0x} = v_0 \\cos\\theta \\approx 16.38' },
        ],
      },
    ];
    expect(fits(sent)).toBe(false);
    const { ops, fixes } = tidyOps(sent);
    expect(fits(ops)).toBe(true);
    expect(ops).toEqual([
      {
        op: 'derive',
        lines: [
          { note: 'vertical component', tex: 'v_{0y} = v_0 \\sin\\theta \\approx 11.47' },
          { note: 'horizontal component', tex: 'v_{0x} = v_0 \\cos\\theta \\approx 16.38' },
        ],
      },
    ]);
    // And the model is told the right way, so it does not do it again.
    expect(fixes.join(' ')).toContain(OP_SHAPES.derive);
  });

  it('maps a tone the schema does not have onto one it does, or drops it', () => {
    const { ops, fixes } = tidyOps([
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'a', label: 'Launch', tone: 'note' },
          { id: 'b', label: 'Land', tone: 'sparkly' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      { op: 'text', text: 'Watch the sign.', tone: 'warning' },
    ]);
    expect(fits(ops)).toBe(true);
    const [diagram, text] = ops as [{ nodes: { tone?: string }[] }, { tone?: string }];
    expect(diagram.nodes.map((n) => n.tone)).toEqual(['muted', undefined]);
    expect(text.tone).toBe('warn');
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('reads the other names models give fields', () => {
    const { ops } = tidyOps([
      { type: 'math', latex: 'E = mc^2' },
      { op: 'derive', lines: ['a = b', { equation: 'b = c', explanation: 'by symmetry' }] },
      { op: 'plot', fns: ['x^2'], domain: ['-2', '2'] },
      { op: 'bullets', items: [{ text: 'one' }, 'two'] },
      { heading: 'Given' },
    ]);
    expect(fits(ops)).toBe(true);
  });

  it('turns an id written as a label into an id, and a program’s * into a times sign', () => {
    const { ops } = tidyOps([
      { op: 'math', tex: 'M = 2 * 1.008 = 2.016', label: 'molar-h2' },
      { op: 'derive', lines: [{ tex: 'n = (10) * (2)' }] },
      { op: 'math', tex: 'E = mc^2', label: 'Mass and energy' },
    ]);
    expect(ops).toEqual([
      { op: 'math', tex: 'M = 2 \\times 1.008 = 2.016', id: 'molar-h2' },
      { op: 'derive', lines: [{ tex: 'n = (10) \\times (2)' }] },
      { op: 'math', tex: 'E = mc^2', label: 'Mass and energy' },
    ]);
    expect(fits(ops)).toBe(true);
  });

  it('balances the braces in an equation, which KaTeX refuses otherwise', () => {
    // The line a real model sent: one closing brace too many after a number.
    const { ops } = tidyOps([{ op: 'derive', lines: [{ tex: 'n = \\frac{10}{2.02} = {{10/2.02}}}\\text{ mol}' }] }]);
    expect(ops).toEqual([{ op: 'derive', lines: [{ tex: 'n = \\frac{10}{2.02} = {{10/2.02}}\\text{ mol}' }] }]);
    expect(balanceBraces('x^{2')).toBe('x^{2}');
    expect(balanceBraces('\\{a\\}')).toBe('\\{a\\}');
  });

  it('reads the variations a real model sent', () => {
    const tex = 'x = 1';
    const { ops } = tidyOps([
      { op: 'derive', derive: [{ tex }] },
      { op: 'math', derive: [{ tex }] },
      { op: 'derive', lines: [{ tex }], label: 'area-formula' },
      { op: 'bullets', items: ['one'], label: 'A caption' },
    ]);
    expect(fits(ops)).toBe(true);
    expect((ops as { op: string; id?: string }[]).map((o) => o.op)).toEqual(['derive', 'derive', 'derive', 'bullets']);
    expect((ops as { id?: string }[])[2]?.id).toBe('area-formula');
  });

  it('reads an operation by a name close to the real one', () => {
    const { ops, fixes } = tidyOps([
      { op: 'equation', tex: 'x = 1' },
      { op: 'list', items: ['one'] },
      { op: 'title', text: 'Given' },
      { op: 'graph', fns: ['x^2'], domain: [0, 1] },
    ]);
    expect(fits(ops)).toBe(true);
    expect(fixes.length).toBe(4);
  });

  it('accepts a diagram with no arrows', () => {
    const { ops } = tidyOps([
      { op: 'diagram', layout: 'web', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    ]);
    expect(fits(ops)).toBe(true);
  });

  it('leaves correct operations exactly as they were, and says nothing', () => {
    const good = [
      { op: 'heading', text: 'Given' },
      { op: 'derive', lines: [{ tex: 'x = 2', note: 'divide by 3' }] },
    ];
    expect(tidyOps(good)).toEqual({ ops: good, fixes: [] });
  });

  it('does not guess when an item names two operations', () => {
    const { ops } = tidyOps([{ math: 'x', text: 'y' }]);
    expect(fits(ops)).toBe(false);
  });

  it('copes with anything at all without throwing', () => {
    for (const junk of [null, 'board', 3, [null, 'x', 4, []], { op: 'derive' }]) {
      expect(() => tidyOps(junk)).not.toThrow();
    }
  });
});

describe('explaining a rejection', () => {
  it('quotes the shape of the operation that failed', () => {
    expect(explainOps([{ op: 'heading', text: 'ok' }, { op: 'derive', steps: 3 }], [1])).toBe(
      `Item 1 is a derive, written ${OP_SHAPES.derive}.`,
    );
    expect(explainOps([{ nothing: true }], [0])).toContain('needs "op"');
  });

  it('gives the same shapes the system prompt does', () => {
    for (const kind of BOARD_OP_KINDS) expect(BOARD_CONTRACT, kind).toContain(OP_SHAPES[kind]);
  });
});
