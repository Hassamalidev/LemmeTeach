/**
 * Every rule in §10.3 gets a test. These are the rules that keep the board
 * from looking broken, and a regression here is invisible until a learner sees
 * it.
 */
import { describe, expect, it } from 'vitest';
import { validateOps } from './validate';
import type { BoardOp } from './op-schema';

const ok = (ops: unknown, ctx = {}) => validateOps(ops, ctx);
const problemsOf = (r: ReturnType<typeof validateOps>) => (r.ok ? [] : r.problems);

describe('validateOps', () => {
  it('accepts a well-formed step', () => {
    const ops: BoardOp[] = [
      { op: 'heading', text: 'Integration by parts' },
      { op: 'math', tex: '\\int u\\,dv = uv - \\int v\\,du', id: 'formula' },
      { op: 'annotate', target: 'formula', style: 'circle', text: 'the swap' },
    ];
    const r = ok(ops);
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown op by name, and lists the real ones', () => {
    const r = ok([{ op: 'sparkle', text: 'hi' }]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('"sparkle" is not a board operation');
    expect(problemsOf(r)[0]).toContain('heading');
  });

  it('rejects coordinates, because the renderer owns layout', () => {
    const r = ok([{ op: 'text', text: 'hello', x: 40, y: 100 }]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r).join(' ')).toMatch(/unknown field/);
    expect(problemsOf(r).join(' ')).toMatch(/no coordinate/);
  });

  it('rejects annotate that points at nothing', () => {
    const r = ok([{ op: 'annotate', target: 'ghost', style: 'underline' }]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('nothing on the board has id "ghost"');
  });

  it('accepts annotate targeting an id already on the page', () => {
    const r = ok([{ op: 'annotate', target: 'earlier', style: 'arrow' }], {
      knownIds: new Set(['earlier']),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a derive over eight lines', () => {
    const lines = Array.from({ length: 9 }, (_, i) => ({ tex: `x_${i}` }));
    const r = ok([{ op: 'derive', lines }]);
    expect(r.ok).toBe(false);
  });

  it('rejects bullets over six items', () => {
    const items = Array.from({ length: 7 }, (_, i) => `item ${i}`);
    const r = ok([{ op: 'bullets', items }]);
    expect(r.ok).toBe(false);
  });

  it('rejects a table wider than eight columns', () => {
    const headers = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const r = ok([{ op: 'table', headers, rows: [headers] }]);
    expect(r.ok).toBe(false);
  });

  it('rejects a row whose cell count does not match the headers', () => {
    const r = ok([{ op: 'table', headers: ['a', 'b'], rows: [['1']] }]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('1 cells but there are 2 headers');
  });

  it('rejects a plot expression mathjs cannot parse', () => {
    const r = ok([{ op: 'plot', fns: [{ expr: 'sin(' }], domain: [0, 10] }]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('not valid mathjs syntax');
  });

  it('rejects an empty or reversed domain', () => {
    expect(ok([{ op: 'plot', fns: [{ expr: 'x' }], domain: [5, 5] }]).ok).toBe(false);
    expect(ok([{ op: 'plot', fns: [{ expr: 'x' }], domain: [5, 1] }]).ok).toBe(false);
    expect(ok([{ op: 'plot', fns: [{ expr: 'x' }], domain: [1, 5] }]).ok).toBe(true);
  });

  it('rejects a diagram edge that references a missing node', () => {
    const r = ok([
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [{ from: 'a', to: 'zzz' }],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('no node with id "zzz"');
  });

  it('rejects more than twelve diagram nodes', () => {
    const nodes = Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
    const r = ok([{ op: 'diagram', layout: 'web', nodes, edges: [] }]);
    expect(r.ok).toBe(false);
  });

  it('rejects a cycle in a tree, and names the cycle', () => {
    const r = ok([
      {
        op: 'diagram',
        layout: 'tree',
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      },
    ]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('cannot contain a cycle');
    expect(problemsOf(r)[0]).toContain('a -> b -> a');
  });

  it('allows the same cycle under layout "cycle"', () => {
    const r = ok([
      {
        op: 'diagram',
        layout: 'cycle',
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects a figure id that does not exist', () => {
    const r = ok([{ op: 'figure', figureId: 'fig_made_up' }], {
      knownFigures: new Set(['fig_real']),
    });
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('Only figure ids returned by run_code');
  });

  it('rejects a step taller than two pages', () => {
    const ops = Array.from({ length: 8 }, () => ({
      op: 'diagram' as const,
      layout: 'cycle' as const,
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [],
    }));
    const r = ok(ops);
    expect(r.ok).toBe(false);
    expect(problemsOf(r).join(' ')).toContain('board pages');
  });

  it('rejects a code focus range past the end of the snippet', () => {
    const r = ok([{ op: 'code', lang: 'python', src: 'a = 1\nb = 2', focus: [1, 9] }]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r)[0]).toContain('past the end');
  });

  it('reports several problems at once rather than stopping at the first', () => {
    const r = ok([
      { op: 'annotate', target: 'ghost', style: 'circle' },
      { op: 'plot', fns: [{ expr: '((' }], domain: [3, 1] },
    ]);
    expect(r.ok).toBe(false);
    expect(problemsOf(r).length).toBeGreaterThanOrEqual(3);
  });
});
