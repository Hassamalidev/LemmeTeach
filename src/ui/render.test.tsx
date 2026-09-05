/**
 * Render smoke tests.
 *
 * These mount the real component tree — no shallow rendering and no mocked
 * children — because the failure worth catching here is "the app shows a blank
 * screen", and that is precisely what a shallow render cannot see.
 *
 * They also cover the accessibility floor from §16: focusable controls, an
 * accessible name on every button, and the board's non-text content carrying a
 * description.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../App';
import { Board } from '../board/Board';
import { BoardModel } from '../board/page';
import { FIXTURE_LESSONS } from '../fixtures';
import { validateOps } from '../board/validate';
import type { BoardOp } from '../board/op-schema';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: JSX.Element): void {
  act(() => root.render(node));
}

describe('the app', () => {
  it('opens on Setup when there is no key, and does not show a blank screen', () => {
    render(<App />);
    expect(container.textContent).toContain('Chalk');
    expect(container.textContent).toContain('API key');
    expect(container.querySelectorAll('button').length).toBeGreaterThan(1);
  });

  it('offers a way in with no key at all', () => {
    render(<App />);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('without a key'))).toBe(true);
  });

  it('says where the key is stored, on the screen where it is entered', () => {
    render(<App />);
    expect(container.textContent).toMatch(/stored in this browser/i);
  });

  it('gives every control an accessible name', () => {
    render(<App />);
    for (const button of container.querySelectorAll('button')) {
      const name = button.textContent?.trim() || button.getAttribute('aria-label');
      expect(name, button.outerHTML.slice(0, 120)).toBeTruthy();
    }
    for (const input of container.querySelectorAll('input, select')) {
      const labelled =
        input.closest('label') !== null ||
        input.getAttribute('aria-label') !== null ||
        input.getAttribute('id') !== null;
      expect(labelled, input.outerHTML.slice(0, 120)).toBe(true);
    }
  });
});

describe('the board, driven from a fixture', () => {
  /** Build a page model the way the tool bus would, from fixture steps. */
  function modelFor(lessonId: string): BoardModel {
    const lesson = FIXTURE_LESSONS.find((l) => l.id === lessonId);
    const model = new BoardModel();
    const figures = new Set<string>();

    for (const line of lesson?.lines ?? []) {
      if (line.t === 'code' && line.figureId) figures.add(line.figureId);
      if (line.t !== 'step') continue;
      const result = validateOps(line.board, {
        knownIds: model.knownIds(),
        knownFigures: figures,
      });
      if (result.ok) {
        model.write({ say: line.say, ops: result.ops, clear: line.clear ?? false });
      }
    }
    return model;
  }

  for (const lesson of FIXTURE_LESSONS) {
    it(`renders the ${lesson.meta.subject} lesson without throwing`, () => {
      const model = modelFor(lesson.id);
      render(
        <Board
          pages={model.pages}
          pageIndex={0}
          theme="slate"
          subject={lesson.meta.subject}
          reveal={new Map()}
        />,
      );
      expect(container.querySelector('.board-page')).toBeTruthy();
      expect(container.textContent?.length ?? 0).toBeGreaterThan(50);
    });
  }

  it('renders in both themes', () => {
    const model = modelFor('math-integration-by-parts');
    for (const theme of ['slate', 'paper'] as const) {
      render(
        <Board pages={model.pages} pageIndex={0} theme={theme} subject="math" reveal={new Map()} />,
      );
      const shell = container.querySelector('.board-shell') as HTMLElement | null;
      expect(shell?.dataset.theme).toBe(theme);
      // The board paints its own ground rather than borrowing the page's.
      expect(shell?.style.getPropertyValue('--board-bg')).toBeTruthy();
    }
  });

  it('describes non-text operations for a screen reader', () => {
    const ops: BoardOp[] = [
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'a', label: 'Glycolysis' },
          { id: 'b', label: 'Krebs cycle' },
        ],
        edges: [{ from: 'a', to: 'b', label: 'pyruvate' }],
      },
      { op: 'plot', fns: [{ expr: 'x^2', label: 'y = x squared' }], domain: [-3, 3] },
      { op: 'vectors', arrows: [{ label: 'weight', dx: 0, dy: -4 }] },
      { op: 'math', tex: '\\frac{d}{dx}x^2 = 2x' },
    ];
    const model = new BoardModel();
    model.write({ say: 'Look at this.', ops, clear: false });

    render(
      <Board pages={model.pages} pageIndex={0} theme="slate" subject="biology" reveal={new Map()} />,
    );

    const described = [...container.querySelectorAll('[role="img"], [role="math"]')];
    expect(described.length).toBeGreaterThanOrEqual(4);
    for (const el of described) {
      expect(el.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(5);
    }
  });

  it('hides unwritten content rather than removing it, so nothing reflows', () => {
    const model = new BoardModel();
    model.write({
      say: 'Three points.',
      ops: [{ op: 'bullets', items: ['one', 'two', 'three'] }],
      clear: false,
    });
    const step = model.allSteps()[0];

    render(
      <Board
        pages={model.pages}
        pageIndex={0}
        theme="slate"
        subject="math"
        reveal={new Map([[step?.id ?? '', 1]])}
      />,
    );

    const items = container.querySelectorAll('.op-bullets li');
    expect(items).toHaveLength(3);
    expect(items[0]?.className).toContain('chalk-write');
    expect(items[1]?.className).toContain('chalk-unwritten');
  });
});
