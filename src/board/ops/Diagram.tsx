/**
 * diagram — flow, cycle, tree, web.
 *
 * All positions come from `layoutDiagram`. Nodes are written first, then the
 * edges extend from source to target: an edge that appears before its
 * endpoints reads as noise, and an edge that draws along its path reads as an
 * explanation.
 */
import type { BoardOp } from '../op-schema';
import { layoutDiagram } from '../diagram-layout';
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
                <text
                  x={e.lx}
                  y={e.ly - 6}
                  textAnchor="middle"
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
            <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 5} textAnchor="middle">
              {fit(n.label, n.w)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Truncate a label that cannot fit its box, rather than letting it overflow. */
function fit(label: string, w: number): string {
  const max = Math.floor((w - 20) / 7.6);
  return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`;
}

function describe(op: DiagramOpType): string {
  const edges = op.edges.map((e) => `${e.from} to ${e.to}`).join(', ');
  return `${op.layout} diagram. Nodes: ${op.nodes.map((n) => n.label).join(', ')}.${edges ? ` Connections: ${edges}.` : ''}`;
}

/** Wrapper used by the fixture harness to render one diagram on its own. */
export function DiagramPreview({ op }: { op: DiagramOpType }): JSX.Element {
  return <DiagramOpView op={op} revealed={Infinity} />;
}
