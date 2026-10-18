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
import { PLANS } from '../../shared/plans';
import { MANAGED_PROVIDER_ID } from '../providers/managed';
import { forgetAllKeys, setKey, setLicense } from '../storage/settings';

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
  const press = (label: string): void => {
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    );
    expect(button, `a button labelled "${label}"`).toBeTruthy();
    act(() => button?.click());
  };

  it('opens on the landing page when there is no license, not a blank screen', () => {
    render(<App />);
    expect(container.textContent).toContain('LemmeTeach');
    expect(container.querySelector('h1')?.textContent).toMatch(/solved step by step/i);
    expect(container.querySelectorAll('button').length).toBeGreaterThan(3);
    // The hero holds a real board, not a picture of one.
    expect(container.querySelector('.hero-board .board-page')).toBeTruthy();
  });

  it('shows every plan with the price and lesson count from the pricing table', () => {
    render(<App />);
    const cards = [...container.querySelectorAll('.plan')];
    expect(cards).toHaveLength(PLANS.length);
    PLANS.forEach((plan, i) => {
      const text = cards[i]?.textContent ?? '';
      expect(text).toContain(plan.name);
      expect(text).toContain(`$${plan.priceUsd}`);
      expect(text).toContain(`About ${plan.lessons} questions`);
    });
  });

  it('disables a plan button that has no checkout to go to, and says why', () => {
    render(<App />);
    for (const card of container.querySelectorAll('.plan')) {
      const link = card.querySelector('a');
      if (link) {
        expect(link.getAttribute('href')).toMatch(/^https:\/\//);
      } else {
        expect(card.querySelector('button')?.disabled).toBe(true);
        expect(card.textContent).toMatch(/not set up/i);
      }
    }
  });

  it('opens the question box when the demo is pressed, with no payment and no key', () => {
    render(<App />);
    press('Try the demo');
    expect(container.textContent).toContain('What do you want solved?');
    expect(container.textContent).toMatch(/this is the demo/i);
    // A prepared question is already in the box, and the ways in are all there.
    const box = container.querySelector('textarea');
    expect(box?.value.length ?? 0).toBeGreaterThan(20);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Attach a file');
    expect(labels).toContain('Solve it');
  });

  it('the demo really solves: the plan appears and the board gets written on', async () => {
    render(<App />);
    press('Try the demo');
    press('Solve it');
    expect(container.querySelector('.lesson')).toBeTruthy();
    expect(container.textContent).toContain('Demo');

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !container.querySelector('.board-page')?.textContent?.trim()) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
    }
    expect(container.querySelector('.board-page')?.textContent?.length ?? 0).toBeGreaterThan(20);
    // The plan is a press away, so the board keeps the width.
    expect(container.querySelector('.rail')).toBeNull();
    press('Plan');
    expect(container.querySelectorAll('.objective').length).toBeGreaterThan(0);
    // Solving is not quizzing: nothing is waiting on the learner.
    expect(container.querySelector('.ask-panel')).toBeNull();
    press('Stop and leave');
    expect(container.textContent).toContain('What do you want solved?');
  }, 20_000);

  it('says where the license key is stored, on the screen where it is entered', () => {
    render(<App />);
    press('I have a license key');
    expect(container.textContent).toContain('License key');
    expect(container.textContent).toMatch(/stored in this browser/i);
  });

  it('opens on the question box for a subscriber, with their plan shown', () => {
    setKey(MANAGED_PROVIDER_ID, 'sk-or-v1-a-provisioned-key-for-this-test', true);
    setLicense({ licenseKey: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', planId: 'regular', activatedAt: 1 });
    render(<App />);
    expect(container.textContent).toContain('What do you want solved?');
    expect(container.textContent).toContain('Regular plan');
    expect(container.textContent).not.toMatch(/this is the demo/i);
    forgetAllKeys();
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
