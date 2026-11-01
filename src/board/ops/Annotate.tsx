/**
 * annotate — points at something already on the board.
 *
 * This is the one op whose geometry depends on where another op ended up, so
 * it measures the target element rather than being laid out in flow. It draws
 * in an overlay above the page and re-measures on resize, because the board
 * scales with the viewport and a circle that has drifted off its target is
 * worse than no circle.
 */
import { useLayoutEffect, useState } from 'react';
import type { BoardOp } from '../op-schema';
import { shown, type OpProps } from './common';

type AnnotateOpType = Extract<BoardOp, { op: 'annotate' }>;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function AnnotateOpView({
  op,
  revealed,
  targets,
  container,
}: OpProps<AnnotateOpType> & {
  targets: Map<string, HTMLElement>;
  container: HTMLElement | null;
}): JSX.Element | null {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const measure = (): void => {
      const el = targets.get(op.target);
      if (!el || !container) {
        setBox(null);
        return;
      }
      const a = inkBox(el);
      const b = container.getBoundingClientRect();
      // The overlay scrolls with the page, so positions are in the page's own
      // coordinates rather than the viewport's.
      setBox({
        x: a.left - b.left + container.scrollLeft,
        y: a.top - b.top + container.scrollTop,
        w: a.width,
        h: a.height,
      });
    };

    measure();
    if (!container) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    const el = targets.get(op.target);
    if (el) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [op.target, targets, container]);

  // A target that has not mounted yet simply draws nothing this frame. The
  // validator has already guaranteed the id exists on the page.
  if (!box) return null;

  const visible = shown(revealed, 0);
  const pad = 8;
  // The note gets a line of its own below the mark, so the stroke never runs
  // through it.
  const noteRoom = op.text ? 24 : 0;
  const width = box.w + (pad + 6) * 2;
  const height = box.h + (pad + 6) * 2 + noteRoom;

  return (
    <svg
      className={`annotate-layer ${visible ? 'annotate-draw' : 'annotate-hidden'}`}
      aria-hidden="true"
      style={{
        left: box.x - pad - 6,
        top: box.y - pad - 6,
        width,
        height,
      }}
      viewBox={`0 0 ${width} ${height}`}
    >
      {op.style === 'circle' ? (
        <ellipse
          cx={(box.w + (pad + 6) * 2) / 2}
          cy={(box.h + (pad + 6) * 2) / 2}
          rx={box.w / 2 + pad}
          ry={box.h / 2 + pad}
          className="annotate-stroke"
          fill="none"
        />
      ) : null}

      {op.style === 'underline' ? (
        <path
          d={underlinePath(pad + 6, box.h + pad + 10, box.w)}
          className="annotate-stroke"
          fill="none"
        />
      ) : null}

      {op.style === 'arrow' ? (
        <path
          d={`M ${box.w + pad + 4} ${-4 + pad + 6} q ${-26} ${-14} ${-52} ${6}`}
          className="annotate-stroke"
          fill="none"
          markerEnd="url(#annotate-head)"
        />
      ) : null}

      <defs>
        <marker
          id="annotate-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--board-accent-soft)" />
        </marker>
      </defs>

      {op.text ? (
        <text
          x={width / 2}
          y={height - 6}
          textAnchor="middle"
          className="annotate-text"
        >
          {op.text}
        </text>
      ) : null}
    </svg>
  );
}

/**
 * The box around what is actually written in an element, not the element.
 * Board operations are full-width blocks, so circling or underlining the
 * block draws a line across the whole board; the writing inside is usually a
 * fraction of that. Falls back to the element when there is nothing to
 * measure.
 */
function inkBox(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (r: DOMRect): void => {
    if (r.width <= 0 || r.height <= 0) return;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  };
  try {
    for (const svg of el.querySelectorAll('svg')) add(svg.getBoundingClientRect());
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('svg, .katex-mathml')) continue;
      range.selectNodeContents(node);
      add(range.getBoundingClientRect());
    }
  } catch {
    /* Measuring is best effort. */
  }
  if (!Number.isFinite(left)) return el.getBoundingClientRect();
  return { left, top, width: right - left, height: bottom - top };
}

/** A hand-drawn underline wobbles slightly; a perfectly straight one reads as a border. */
function underlinePath(x0: number, y: number, w: number): string {
  const mid = x0 + w / 2;
  return `M ${x0} ${y} Q ${mid} ${y + 4} ${x0 + w} ${y - 1}`;
}
