/**
 * diagram — flow, cycle, tree, web.
 *
 * All positions come from `layoutDiagram`. Nodes are written first, then the
 * edges extend from source to target: an edge that appears before its
 * endpoints reads as noise, and an edge that draws along its path reads as an
 * explanation.
 */
import type { BoardOp } from '../op-schema';
import { layoutDiagram, wrapLabel } from '../diagram-layout';
import { shown, toneClass, useRegisterOp, type OpProps } from './common';

type DiagramOpType = Extract<BoardOp, { op: 'diagram' }>;

const VIEW_W = 760;

export function DiagramOpView({ op, revealed, register }: OpProps<DiagramOpType>): JSX.Element {
  const ref = useRegisterOp(op.id, register);

  const layout = layoutDiagram(op, VIEW_W);
  const nodeCount = op.nodes.length;

  return (
    <div ref={ref} className="op op-diagram">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height + 8}`}
        className="diagram-svg"
        role="img"
        aria-label={describe(op)}
        preserveAspectRatio="xMidYMin meet"
      >
        <defs>
          <marker
            id={`arrow-${op.id ?? 'd'}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--board-ink-dim)" />
          </marker>
        </defs>

        {layout.edges.map((e, i) => {
          // Edges follow their endpoints: an edge is written only once both of
          // the nodes it joins are on the board.
          const visible = shown(revealed, nodeCount + i);
          return (
            <g key={`${e.from}-${e.to}-${i}`} className={visible ? 'edge-draw' : 'edge-hidden'}>
              <path
                d={e.d}
                fill="none"
                stroke="var(--board-ink-dim)"
                strokeWidth="1.8"
                markerEnd={`url(#arrow-${op.id ?? 'd'})`}
              />
              {e.label ? (
                // Beside a line that runs up or down, above one that runs across,
                // so the line never goes through the words.
                <text
                  x={Math.abs(Math.sin((e.angle * Math.PI) / 180)) > 0.7 ? e.lx + 9 : e.lx}
                  y={Math.abs(Math.sin((e.angle * Math.PI) / 180)) > 0.7 ? e.ly + 4 : e.ly - 7}
                  textAnchor={Math.abs(Math.sin((e.angle * Math.PI) / 180)) > 0.7 ? 'start' : 'middle'}
                  className="edge-label"
                  fill="var(--board-ink-dim)"
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {layout.nodes.map((n, i) => (
          <g
            key={n.id}
            className={`diagram-node ${shown(revealed, i) ? 'node-in' : 'node-hidden'} ${toneClass(n.tone)}`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" />
            <text textAnchor="middle">
              {wrapLabel(n.label, n.w).map((line, l, lines) => (
                <tspan key={l} x={n.x + n.w / 2} y={n.y + n.h / 2 + 5 + (l - (lines.length - 1) / 2) * 18}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function describe(op: DiagramOpType): string {
  const edges = op.edges.map((e) => `${e.from} to ${e.to}`).join(', ');
  return `${op.layout} diagram. Nodes: ${op.nodes.map((n) => n.label).join(', ')}.${edges ? ` Connections: ${edges}.` : ''}`;
}

/** Wrapper used by the fixture harness to render one diagram on its own. */
export function DiagramPreview({ op }: { op: DiagramOpType }): JSX.Element {
  return <DiagramOpView op={op} revealed={Infinity} />;
}
