/**
 * plot — a graph drawn from mathjs expressions.
 *
 * The range is computed from the sampled values when the model does not give
 * one, and outliers are clipped rather than allowed to flatten the curve: a
 * plot of tan(x) that renders as a horizontal line at zero because of one
 * sample near the asymptote teaches the opposite of the truth.
 */
import { useMemo } from 'react';
import { compile } from 'mathjs';
import type { BoardOp } from '../op-schema';
import { Written, shown, useRegisterOp, type OpProps } from './common';

type PlotOpType = Extract<BoardOp, { op: 'plot' }>;

const W = 700;
const H = 300;
const M = { top: 16, right: 20, bottom: 34, left: 46 };
const SAMPLES = 400;

const SERIES_DASH = ['', '6 4', '2 4', '10 4'];

export function PlotOpView({ op, revealed, register }: OpProps<PlotOpType>): JSX.Element {
  const ref = useRegisterOp(op.id, register);

  const model = useMemo(() => buildPlot(op), [op]);

  return (
    <div ref={ref} className="op op-plot">
      <Written visible={shown(revealed, 0)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="plot-svg" role="img" aria-label={describe(op)}>
          {/* Axes and ticks first: the frame is the thing the curve is read against. */}
          <g className="plot-axes">
            {model.xTicks.map((t) => (
              <g key={`x${t.v}`}>
                <line x1={t.px} y1={M.top} x2={t.px} y2={H - M.bottom} className="grid" />
                <text x={t.px} y={H - M.bottom + 18} textAnchor="middle" className="tick">
                  {t.label}
                </text>
              </g>
            ))}
            {model.yTicks.map((t) => (
              <g key={`y${t.v}`}>
                <line x1={M.left} y1={t.py} x2={W - M.right} y2={t.py} className="grid" />
                <text x={M.left - 8} y={t.py + 4} textAnchor="end" className="tick">
                  {t.label}
                </text>
              </g>
            ))}
            {model.zeroY !== null ? (
              <line x1={M.left} y1={model.zeroY} x2={W - M.right} y2={model.zeroY} className="axis" />
            ) : null}
            {model.zeroX !== null ? (
              <line x1={model.zeroX} y1={M.top} x2={model.zeroX} y2={H - M.bottom} className="axis" />
            ) : null}
          </g>

          {model.series.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              className={`plot-line ${shown(revealed, i + 1) ? 'plot-draw' : 'plot-hidden'}`}
              stroke={i === 0 ? 'var(--board-accent-soft)' : 'var(--board-ink)'}
              strokeDasharray={SERIES_DASH[i % SERIES_DASH.length]}
              strokeWidth="2.4"
              style={{ animationDelay: `${i * 220}ms` }}
            />
          ))}

          {(op.marks ?? []).map((mk, i) => {
            const px = model.toPx(mk.x);
            const py = model.toPy(mk.y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
            return (
              <g key={i} className={shown(revealed, op.fns.length + 1) ? 'mark-in' : 'plot-hidden'}>
                <circle cx={px} cy={py} r="4.5" className="plot-mark" />
                {mk.label ? (
                  // A mark near the right edge has its label to its left, so
                  // the label is not cut off by the edge of the plot.
                  <text
                    x={px + 9 + mk.label.length * 7.5 > W ? px - 9 : px + 9}
                    y={py - 8}
                    textAnchor={px + 9 + mk.label.length * 7.5 > W ? 'end' : 'start'}
                    className="mark-label"
                  >
                    {mk.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {op.fns.some((f) => f.label) ? (
          <div className="plot-legend">
            {op.fns.map((f, i) => (
              <span key={i} className="legend-item">
                <svg width="26" height="8" aria-hidden="true">
                  <line
                    x1="0"
                    y1="4"
                    x2="26"
                    y2="4"
                    stroke={i === 0 ? 'var(--board-accent-soft)' : 'var(--board-ink)'}
                    strokeWidth="2.4"
                    strokeDasharray={SERIES_DASH[i % SERIES_DASH.length]}
                  />
                </svg>
                {f.label ?? f.expr}
              </span>
            ))}
          </div>
        ) : null}
      </Written>
    </div>
  );
}

interface PlotModel {
  series: { d: string }[];
  xTicks: { v: number; px: number; label: string }[];
  yTicks: { v: number; py: number; label: string }[];
  zeroX: number | null;
  zeroY: number | null;
  toPx: (x: number) => number;
  toPy: (y: number) => number;
}

function buildPlot(op: PlotOpType): PlotModel {
  const x0 = op.domain[0];
  const x1 = op.domain[1];

  const sampled = op.fns.map((fn) => {
    let evaluate: (scope: { x: number }) => unknown;
    try {
      const compiled = compile(fn.expr);
      evaluate = (scope) => compiled.evaluate(scope);
    } catch {
      return [] as (number | null)[];
    }
    const out: (number | null)[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / SAMPLES;
      try {
        const y = evaluate({ x });
        out.push(typeof y === 'number' && Number.isFinite(y) ? y : null);
      } catch {
        out.push(null);
      }
    }
    return out;
  });

  const finite = sampled.flat().filter((v): v is number => v !== null);
  let [y0, y1] = op.range ?? autoRange(finite);
  if (!(y1 > y0)) {
    y0 -= 1;
    y1 += 1;
  }

  const px = (x: number) => M.left + ((x - x0) / (x1 - x0)) * (W - M.left - M.right);
  const py = (y: number) => H - M.bottom - ((y - y0) / (y1 - y0)) * (H - M.top - M.bottom);

  const series = sampled.map((values) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      const x = x0 + ((x1 - x0) * i) / SAMPLES;
      // A value outside the window lifts the pen, so an asymptote shows as a
      // break rather than as a near-vertical line joining two branches.
      if (v === null || v < y0 - (y1 - y0) || v > y1 + (y1 - y0)) {
        pen = false;
        return;
      }
      const cy = Math.max(M.top - 40, Math.min(H - M.bottom + 40, py(v)));
      d += `${pen ? 'L' : 'M'} ${px(x).toFixed(1)} ${cy.toFixed(1)} `;
      pen = true;
    });
    return { d: d.trim() };
  });

  return {
    series,
    xTicks: ticks(x0, x1).map((v) => ({ v, px: px(v), label: fmt(v) })),
    yTicks: ticks(y0, y1).map((v) => ({ v, py: py(v), label: fmt(v) })),
    zeroX: x0 <= 0 && x1 >= 0 ? px(0) : null,
    zeroY: y0 <= 0 && y1 >= 0 ? py(0) : null,
    toPx: px,
    toPy: py,
  };
}

/**
 * A range that shows the shape of the function. Clipping to a central
 * percentile band keeps a single spike near a pole from flattening everything
 * else into a line.
 */
function autoRange(values: number[]): [number, number] {
  if (values.length === 0) return [-1, 1];
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)] ?? sorted[0] ?? -1;
  const hi = sorted[Math.floor(sorted.length * 0.98)] ?? sorted.at(-1) ?? 1;
  const pad = (hi - lo) * 0.12 || 1;
  return [lo - pad, hi + pad];
}

function ticks(a: number, b: number): number[] {
  const span = b - a;
  if (!Number.isFinite(span) || span <= 0) return [a];
  const raw = span / 6;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

function fmt(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
}

function describe(op: PlotOpType): string {
  return `Graph of ${op.fns.map((f) => f.label ?? f.expr).join(' and ')} from x equals ${op.domain[0]} to ${op.domain[1]}.`;
}
