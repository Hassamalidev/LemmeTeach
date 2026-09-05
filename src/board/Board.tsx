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
