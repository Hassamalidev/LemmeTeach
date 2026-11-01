/**
 * vectors — forces, fields, momentum.
 *
 * All arrows share one scale, chosen from the largest, so relative magnitudes
 * are readable. Scaling each arrow to fit its own label would make a 2 N force
 * and a 200 N force the same length, which is worse than not drawing them.
 */
import type { BoardOp } from '../op-schema';
import { shown, toneClass, useRegisterOp, type OpProps } from './common';

type VectorsOpType = Extract<BoardOp, { op: 'vectors' }>;

const W = 620;
const H = 260;

export function VectorsOpView({ op, revealed, register }: OpProps<VectorsOpType>): JSX.Element {
  const ref = useRegisterOp(op.id, register);

  const cx = W / 2;
  const cy = H / 2;
  const longest = Math.max(...op.arrows.map((a) => Math.hypot(a.dx, a.dy)), 1);
  const scale = Math.min((W / 2 - 90) / longest, (H / 2 - 46) / longest);
  const labels = placeLabels(op.arrows, cx, cy, scale);

  return (
    <div ref={ref} className="op op-vectors">
      <svg viewBox={`0 0 ${W} ${H}`} className="vectors-svg" role="img" aria-label={describe(op)}>
        <defs>
          <marker
            id={`vhead-${op.id ?? 'v'}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="context-stroke" />
          </marker>
        </defs>

        <line x1={20} y1={cy} x2={W - 20} y2={cy} className="v-axis" />
        <line x1={cx} y1={16} x2={cx} y2={H - 16} className="v-axis" />

        {op.arrows.map((a, i) => {
          // SVG y grows downward; physics does not. Flip once, here.
          const ex = cx + a.dx * scale;
          const ey = cy - a.dy * scale;
          const visible = shown(revealed, i);
          return (
            <g
              key={i}
              className={`vector ${visible ? 'vector-in' : 'vector-hidden'} ${toneClass(a.tone)}`}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <line
                x1={cx}
                y1={cy}
                x2={ex}
                y2={ey}
                strokeWidth="2.8"
                markerEnd={`url(#vhead-${op.id ?? 'v'})`}
              />
              <text
                x={labels[i]?.x ?? ex}
                y={labels[i]?.y ?? ey}
                textAnchor={labels[i]?.anchor ?? 'start'}
                className="vector-label"
              >
                {a.label}
              </text>
            </g>
          );
        })}

        <circle cx={cx} cy={cy} r="4" className="v-origin" />
        {op.origin ? (
          <text x={cx + 10} y={cy + 20} className="v-origin-label">
            {op.origin}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

interface LabelSpot {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

/** Roughly how wide a label is at the board's 14px label size. */
const charWidth = 7.4;
const lineHeight = 18;

/**
 * Where each arrow's label goes: just past its tip, along the arrow, so it
 * reads as belonging to that arrow. Arrows that end near each other would put
 * their labels on top of one another — a real board showed "Vertical" and
 * "Actual path" printed over each other — so a label that would collide with
 * one already placed is moved a line up or down until it is clear.
 */
export function placeLabels(
  arrows: { label: string; dx: number; dy: number }[],
  cx: number,
  cy: number,
  scale: number,
): LabelSpot[] {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  return arrows.map((a) => {
    const ex = cx + a.dx * scale;
    const ey = cy - a.dy * scale;
    const len = Math.hypot(a.dx, a.dy) || 1;
    const ux = a.dx / len;
    const uy = -a.dy / len;
    // Mostly vertical arrows get a centred label; others hang off the side
    // the arrow points to.
    const anchor: LabelSpot['anchor'] = Math.abs(ux) < 0.35 ? 'middle' : ux < 0 ? 'end' : 'start';
    const baseX = ex + ux * 10;
    const baseY = ey + (uy <= 0 ? -10 : 18) + (anchor === 'middle' ? uy * 6 : 0);
    const width = a.label.length * charWidth;
    const box = (y: number): { x0: number; x1: number; y0: number; y1: number } => {
      const x0 = anchor === 'start' ? baseX : anchor === 'end' ? baseX - width : baseX - width / 2;
      return { x0, x1: x0 + width, y0: y - 14, y1: y + 4 };
    };
    const clear = (b: ReturnType<typeof box>): boolean =>
      placed.every((p) => b.x1 < p.x0 || b.x0 > p.x1 || b.y1 < p.y0 || b.y0 > p.y1);

    let y = baseY;
    for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
      const candidate = baseY + shift * lineHeight;
      if (candidate < 14 || candidate > H - 4) continue;
      if (clear(box(candidate))) {
        y = candidate;
        break;
      }
    }
    placed.push(box(y));
    return { x: baseX, y, anchor };
  });
}

function describe(op: VectorsOpType): string {
  const list = op.arrows
    .map((a) => `${a.label}, ${a.dx} across and ${a.dy} up`)
    .join('; ');
  return `Vector diagram${op.origin ? ` at ${op.origin}` : ''}. ${list}.`;
}
