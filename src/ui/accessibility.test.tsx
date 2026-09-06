/**
 * Automated accessibility pass on every screen (§22).
 *
 * axe cannot see everything — the manual keyboard-only run and the screen
 * reader pass over the board still matter — but it catches the whole class of
 * regressions that are invisible until someone who needs them tries to use the
 * thing: an unlabelled control, a contrast failure, a heading that skips a
 * level.
 *
 * jsdom has no layout engine, so rules that need geometry cannot run here.
 * Those are excluded explicitly rather than by lowering the bar, so the list
 * is a visible statement of what still needs checking in a real browser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import axe from 'axe-core';
import { App } from '../App';
import { Board } from '../board/Board';
import { BoardModel } from '../board/page';
import { AskPanel } from './AskPanel';
import { QuizPanel } from './QuizPanel';
import { RaiseHand } from './RaiseHand';
import { Shortcuts } from './Shortcuts';
import { Meter } from './Meter';
import { FIXTURE_LESSONS } from '../fixtures';
import { validateOps } from '../board/validate';

/** Rules that need real layout, which jsdom does not provide. */
const NEEDS_A_BROWSER = [
  'color-contrast',
  'scrollable-region-focusable',
  'target-size',
];

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

async function auditing(node: JSX.Element): Promise<axe.Result[]> {
  act(() => root.render(node));
  const results = await axe.run(container, {
    rules: Object.fromEntries(NEEDS_A_BROWSER.map((id) => [id, { enabled: false }])),
  });
  return results.violations;
}

function describeViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes[0]?.html?.slice(0, 140) ?? ''}`)
    .join('\n');
}

describe('axe', () => {
  it('Setup has no violations', async () => {
    const violations = await auditing(<App />);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('a question panel has no violations', async () => {
    const violations = await auditing(
      <AskPanel
        question={{
          question: 'What happens to the current if I double the resistance?',
          kind: 'choice',
          options: ['It doubles', 'It halves', 'No change'],
        }}
        onAnswer={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('a free-text question has no violations', async () => {
    const violations = await auditing(
      <AskPanel
        question={{ question: 'What do you think happens next?', kind: 'free' }}
        onAnswer={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('a scored check has no violations', async () => {
    const violations = await auditing(
      <QuizPanel
        questions={[
          {
            q: 'Which quantity is conserved in an elastic collision?',
            options: ['Momentum only', 'Kinetic energy only', 'Both'],
            answer: 2,
            why: 'Elastic means kinetic energy is conserved as well as momentum.',
            concept: 'elastic-collision',
          },
          {
            q: 'What does a catalyst change?',
            options: ['The position of equilibrium', 'How fast equilibrium is reached'],
            answer: 1,
            why: 'It speeds both directions equally.',
            concept: 'catalyst',
          },
        ]}
        onSubmit={() => {}}
      />,
    );
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('raise hand has no violations', async () => {
    const violations = await auditing(<RaiseHand onAsk={() => {}} onCancel={() => {}} />);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('the shortcut sheet has no violations', async () => {
    const violations = await auditing(<Shortcuts onClose={() => {}} />);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('the budget meter has no violations', async () => {
    const violations = await auditing(
      <Meter
        budget={{
          inputTokens: 42_000,
          outputTokens: 8_000,
          limits: { inputTokens: 120_000, outputTokens: 30_000 },
          fraction: 0.35,
          estimatedCostUsd: 0.24,
          warned: false,
          exhausted: false,
          turns: 11,
        }}
      />,
    );
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  for (const lesson of FIXTURE_LESSONS) {
    it(`the ${lesson.meta.subject} board has no violations`, async () => {
      const model = new BoardModel();
      for (const line of lesson.lines) {
        if (line.t !== 'step') continue;
        const check = validateOps(line.board, { knownIds: model.knownIds() });
        if (check.ok) {
          model.write({ say: line.say, ops: check.ops, clear: line.clear ?? false });
        }
      }

      const violations = await auditing(
        <Board
          pages={model.pages}
          pageIndex={0}
          theme="slate"
          subject={lesson.meta.subject}
          reveal={new Map()}
        />,
      );
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  }
});
