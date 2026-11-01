/**
 * The board (§10.2, §16).
 *
 * The board is the product; everything else is a thin rail around it. It takes
 * board operations and draws them, and knows nothing about agents — which is
 * what lets it be driven entirely from a fixture file with no key, no network
 * and no runtime.
 *
 * A 16:9 page scaled to the viewport, dropping to 4:5 below 640px with the
 * side column moved underneath.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SubjectId } from '../core/types';
import type { BoardTheme } from '../storage/settings';
import type { BoardOp } from './op-schema';
import type { BoardPage, BoardStep } from './page';
import { revealUnits } from './page';
import { themeVars, gridFor } from './themes';
import { HeadingOpView, TextOpView, BulletsOpView, MathOpView, DeriveOpView } from './ops/Text';
import { CodeOpView } from './ops/Code';
import { DiagramOpView } from './ops/Diagram';
import { PlotOpView } from './ops/Plot';
import { VectorsOpView } from './ops/Vectors';
import { ReactionOpView, TableOpView, FigureOpView } from './ops/Chem';
import { AnnotateOpView } from './ops/Annotate';

export interface BoardProps {
  pages: BoardPage[];
  /** Which page is on screen. The learner can scroll back through the rest. */
  pageIndex: number;
  theme: BoardTheme;
  subject: SubjectId;
  /**
   * How much of each step is written. Steps not in the map are fully written —
   * the reveal engine only tracks the step currently being narrated.
   */
  reveal: Map<string, number>;
  onPageChange?: (index: number) => void;
}

export function Board({
  pages,
  pageIndex,
  theme,
  subject,
  reveal,
  onPageChange,
}: BoardProps): JSX.Element {
  const page = pages[Math.min(pageIndex, pages.length - 1)] ?? pages[0];
  const containerRef = useRef<HTMLDivElement>(null);
  const [targets] = useState(() => new Map<string, HTMLElement>());
  const [, forceMeasure] = useState(0);

  const register = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (el) targets.set(id, el);
      else targets.delete(id);
      // Annotations measure their target, so a newly registered element has to
      // trigger one more pass. Cheap: this fires once per identified op.
      forceMeasure((n) => n + 1);
    },
    [targets],
  );

  const style = useMemo(
    () => ({ ...themeVars(theme, subject) }) as React.CSSProperties,
    [theme, subject],
  );

  const grid = gridFor(theme);

  useEffect(() => {
    // Keep the newest page in view when the tutor moves on, unless the learner
    // has scrolled back deliberately.
    if (onPageChange && pageIndex > pages.length - 1) onPageChange(pages.length - 1);
  }, [pages.length, pageIndex, onPageChange]);

  if (!page) return <div className="board-shell" style={style} />;

  const mainSteps = page.steps;
  const hasSide = mainSteps.some((s) => s.ops.some((o) => o.col === 'side'));

  return (
    <div className="board-shell" style={style} data-theme={theme}>
      <div
        className={`board-page ${hasSide ? 'has-side' : ''}`}
        ref={containerRef}
        style={{ '--page-scale': page.scale } as React.CSSProperties}
      >
        {grid ? <div className="board-grid" aria-hidden="true" style={{ background: ruled(grid) }} /> : null}

        <div className="board-col board-main">
          {mainSteps.map((step) => (
            <StepView key={step.id} step={step} col="main" reveal={reveal} register={register} theme={theme} />
          ))}
        </div>

        {hasSide ? (
          <div className="board-col board-side">
            {mainSteps.map((step) => (
              <StepView key={step.id} step={step} col="side" reveal={reveal} register={register} theme={theme} />
            ))}
          </div>
        ) : null}

        {/* Annotations sit above everything and measure what they point at. */}
        <div className="board-annotations">
          {mainSteps.flatMap((step) =>
            step.ops
              .filter((o): o is Extract<BoardOp, { op: 'annotate' }> => o.op === 'annotate')
              .map((op, i) => (
                <AnnotateOpView
                  key={`${step.id}-a${i}`}
                  op={op}
                  revealed={revealedFor(step, reveal, indexOfOp(step, op))}
                  targets={targets}
                  container={containerRef.current}
                />
              )),
          )}
        </div>
      </div>

      {pages.length > 1 ? (
        <div className="board-pager">
          <span>
            Page {page.index + 1} of {pages.length}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The scrolling board
 * ------------------------------------------------------------------ */

export interface BoardScrollProps {
  /** The steps to show, top to bottom, in the order they were explained. */
  steps: BoardStep[];
  /** Steps that begin a fresh page: drawn with a rule above them. */
  breaks: ReadonlySet<string>;
  /** Steps that answer a raised hand rather than continue the solution. */
  asides: ReadonlySet<string>;
  /** The question each answer step answers, shown at the top of its box. */
  questions?: Readonly<Record<string, string>>;
  /** The step being explained now. The board keeps it in view. */
  followId: string | null;
  theme: BoardTheme;
  subject: SubjectId;
  reveal: Map<string, number>;
  reducedMotion?: boolean;
}

/**
 * Everything written so far, in one column that grows downwards.
 *
 * Earlier steps stay where they were written, so the learner can scroll up to
 * look at one and scroll back. The board follows the step being explained
 * unless they have scrolled away, in which case it leaves them alone and
 * offers a way back — nothing is worse than a page that moves while you read.
 */
export function BoardScroll({
  steps,
  breaks,
  asides,
  questions,
  followId,
  theme,
  subject,
  reveal,
  reducedMotion = false,
}: BoardScrollProps): JSX.Element {
  const pageRef = useRef<HTMLDivElement>(null);
  const [targets] = useState(() => new Map<string, HTMLElement>());
  const [, forceMeasure] = useState(0);
  const following = useRef(true);
  const [away, setAway] = useState(false);

  const register = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (el) targets.set(id, el);
      else targets.delete(id);
      forceMeasure((n) => n + 1);
    },
    [targets],
  );

  const style = useMemo(
    () => ({ ...themeVars(theme, subject) }) as React.CSSProperties,
    [theme, subject],
  );
  const grid = gridFor(theme);

  /** Bring the step being explained into view. */
  const follow = useCallback(
    (smooth: boolean) => {
      const page = pageRef.current;
      if (!page || !followId) return;
      const el = page.querySelector<HTMLElement>(`[data-step-wrap="${followId}"]`);
      if (!el) return;

      const top = el.offsetTop;
      const height = el.offsetHeight;
      const room = page.clientHeight;
      // A step that fits is shown whole, sitting at the bottom of the view with
      // what came before it above. One that does not fit starts at the top.
      const target = height + 48 <= room ? top + height - room + 48 : top - 20;
      const clamped = Math.max(0, Math.min(target, page.scrollHeight - room));
      if (Math.abs(clamped - page.scrollTop) < 4) return;
      if (typeof page.scrollTo === 'function') {
        page.scrollTo({ top: clamped, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
      } else {
        page.scrollTop = clamped;
      }
    },
    [followId, reducedMotion],
  );

  // Follow when the step changes, and again shortly after: typeset math,
  // highlighted code and figures all arrive late and change heights.
  useEffect(() => {
    if (!following.current) return;
    follow(true);
    const soon = window.setTimeout(() => following.current && follow(false), 350);
    const later = window.setTimeout(() => following.current && follow(false), 1300);
    return () => {
      window.clearTimeout(soon);
      window.clearTimeout(later);
    };
  }, [follow, steps.length]);

  /** The learner moved the page themselves: stop following until they come back. */
  const letGo = useCallback(() => {
    if (!following.current) return;
    following.current = false;
    setAway(true);
  }, []);

  const comeBack = useCallback(() => {
    following.current = true;
    setAway(false);
    follow(true);
  }, [follow]);

  return (
    <div className="board-shell board-continuous" style={style} data-theme={theme}>
      <div
        className="board-page"
        ref={pageRef}
        tabIndex={0}
        role="region"
        aria-label="The board. Scroll up to see earlier steps."
        style={grid ? { backgroundImage: ruled(grid), backgroundAttachment: 'local' } : undefined}
        onWheel={(e) => {
          if (e.deltaY < 0) letGo();
        }}
        onTouchMove={letGo}
        onKeyDown={(e) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) letGo();
        }}
      >
        <div className="board-col board-main">
          {steps.map((step) => (
            <div
              key={step.id}
              data-step-wrap={step.id}
              className={[
                'board-entry',
                breaks.has(step.id) ? 'board-break' : '',
                asides.has(step.id) ? 'board-aside' : '',
                step.id === followId ? 'board-current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {asides.has(step.id) && (
                <div className="board-aside-label">
                  Your question
                  {questions?.[step.id] ? <span className="board-aside-question">{questions[step.id]}</span> : null}
                </div>
              )}
              <StepView step={step} col="main" reveal={reveal} register={register} theme={theme} />
              <StepView step={step} col="side" reveal={reveal} register={register} theme={theme} />
            </div>
          ))}
        </div>

        <div className="board-annotations">
          {steps.flatMap((step) =>
            step.ops
              .filter((o): o is Extract<BoardOp, { op: 'annotate' }> => o.op === 'annotate')
              .map((op, i) => (
                <AnnotateOpView
                  key={`${step.id}-a${i}`}
                  op={op}
                  revealed={revealedFor(step, reveal, indexOfOp(step, op))}
                  targets={targets}
                  container={pageRef.current}
                />
              )),
          )}
        </div>
      </div>

      {away && followId ? (
        <button className="board-jump" onClick={comeBack}>
          ↓ Back to the current step
        </button>
      ) : null}
    </div>
  );
}

function StepView({
  step,
  col,
  reveal,
  register,
  theme,
}: {
  step: BoardStep;
  col: 'main' | 'side';
  reveal: Map<string, number>;
  register: (id: string, el: HTMLElement | null) => void;
  theme: BoardTheme;
}): JSX.Element | null {
  const ops = step.ops.filter((o) => o.op !== 'annotate' && (o.col ?? 'main') === col);
  if (ops.length === 0) return null;

  return (
    <div className="board-step" data-step-id={step.id}>
      {ops.map((op, i) => (
        <OpView
          key={`${step.id}-${i}`}
          op={op}
          revealed={revealedFor(step, reveal, indexOfOp(step, op))}
          register={register}
          theme={theme}
        />
      ))}
    </div>
  );
}

function indexOfOp(step: BoardStep, op: BoardOp): number {
  return step.ops.indexOf(op);
}

/**
 * Reveal units are counted across the whole step in order, so an op's own
 * count is the global progress minus everything written before it. This is
 * what keeps the board and the narration in step rather than each op running
 * its own clock.
 */
function revealedFor(step: BoardStep, reveal: Map<string, number>, opIndex: number): number {
  const progress = reveal.get(step.id);
  if (progress === undefined) return Infinity;
  let before = 0;
  for (let i = 0; i < opIndex; i++) {
    const op = step.ops[i];
    if (op) before += revealUnits(op);
  }
  return Math.max(0, progress - before);
}

function OpView({
  op,
  revealed,
  register,
  theme,
}: {
  op: BoardOp;
  revealed: number;
  register: (id: string, el: HTMLElement | null) => void;
  theme: BoardTheme;
}): JSX.Element | null {
  switch (op.op) {
    case 'heading':
      return <HeadingOpView op={op} revealed={revealed} register={register} />;
    case 'text':
      return <TextOpView op={op} revealed={revealed} register={register} />;
    case 'bullets':
      return <BulletsOpView op={op} revealed={revealed} register={register} />;
    case 'math':
      return <MathOpView op={op} revealed={revealed} register={register} />;
    case 'derive':
      return <DeriveOpView op={op} revealed={revealed} register={register} />;
    case 'code':
      return <CodeOpView op={op} revealed={revealed} register={register} theme={theme} />;
    case 'diagram':
      return <DiagramOpView op={op} revealed={revealed} register={register} />;
    case 'plot':
      return <PlotOpView op={op} revealed={revealed} register={register} />;
    case 'vectors':
      return <VectorsOpView op={op} revealed={revealed} register={register} />;
    case 'reaction':
      return <ReactionOpView op={op} revealed={revealed} register={register} />;
    case 'table':
      return <TableOpView op={op} revealed={revealed} register={register} />;
    case 'figure':
      return <FigureOpView op={op} revealed={revealed} register={register} />;
    case 'annotate':
      return null; // Drawn in the overlay, above.
  }
}

function ruled(color: string): string {
  return `repeating-linear-gradient(to bottom, transparent, transparent 33px, ${color} 33px, ${color} 34px)`;
}
