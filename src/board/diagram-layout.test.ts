/**
 * Diagram labels (§10.2). A label cut short loses what the diagram was there
 * to say, and a real board showed exactly that.
 */
import { describe, expect, it } from 'vitest';
import { layoutDiagram, wrapLabel } from './diagram-layout';

describe('a diagram label', () => {
  it('keeps every word of a label a model is allowed to write', () => {
    const label = 'France is pulled in by Russia under the Franco-Russian Alliance';
    const lines = wrapLabel(label.slice(0, 60), 210);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(' ')).toBe(label.slice(0, 60));
  });

  it('stays on one line when it fits', () => {
    expect(wrapLabel('Launch', 120)).toEqual(['Launch']);
  });

  it('breaks a single word too long for the box rather than overflowing', () => {
    const lines = wrapLabel('Pneumonoultramicroscopicsilicovolcanoconiosis', 120);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(13);
  });

  it('makes every box tall enough for the longest label, with room between rows', () => {
    const layout = layoutDiagram(
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'a', label: 'Short' },
          { id: 'b', label: 'A much longer label that needs more than one line to be read' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      760,
    );
    const [a, b] = layout.nodes;
    expect(a?.h).toBe(b?.h);
    expect(a?.h).toBeGreaterThan(44);
    expect((b?.y ?? 0) - (a?.y ?? 0)).toBeGreaterThan(a?.h ?? 0);
    expect(layout.height).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.h ?? 0));
  });
});
