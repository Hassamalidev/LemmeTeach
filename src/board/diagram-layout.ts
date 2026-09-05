/**
 * Diagram layout (§10.2).
 *
 * The model gives nodes and edges; every coordinate on this page is computed
 * here. Four layouts: layered for `flow` and `tree`, radial for `cycle`, a
 * relaxed grid for `web`.
 *
 * Edges route around nodes rather than through them. That single detail is
 * most of the difference between a diagram that looks drawn and one that looks
 * emitted, and it is cheap: with at most twelve nodes an O(n²) pass is free.
 */
import type { BoardOp } from './op-schema';

export interface LaidNode {
  id: string;
  label: string;
  tone: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidEdge {
  from: string;
  to: string;
  label?: string;
  /** SVG path data, already routed. */
  d: string;
  /** Where a label sits, if there is one. */
  lx: number;
  ly: number;
  /** Arrowhead angle in degrees. */
  angle: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: LaidNode[];
  edges: LaidEdge[];
}

type Diagram = Extract<BoardOp, { op: 'diagram' }>;

const NODE_H = 44;
const H_GAP = 44;
const V_GAP = 62;
const CHAR_W = 8.2;
const PAD_X = 22;

function nodeWidth(label: string): number {
  return Math.max(84, Math.min(210, label.length * CHAR_W + PAD_X * 2));
}

export function layoutDiagram(op: Diagram, maxWidth: number): DiagramLayout {
  switch (op.layout) {
    case 'cycle':
      return radial(op, maxWidth);
    case 'web':
      return web(op, maxWidth);
    default:
      return layered(op, maxWidth);
  }
}

/* ----------------------------- flow and tree ----------------------------- */

function layered(op: Diagram, maxWidth: number): DiagramLayout {
  const incoming = new Map<string, number>();
  for (const n of op.nodes) incoming.set(n.id, 0);
  for (const e of op.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);

  // Longest-path layering. Roots are nodes nothing points at; a graph where
  // everything has a parent (possible in `flow`) falls back to the first node.
  const depth = new Map<string, number>();
  const roots = op.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seeds = roots.length ? roots : op.nodes[0] ? [op.nodes[0].id] : [];
  for (const id of seeds) depth.set(id, 0);

  const adjacency = new Map<string, string[]>();
  for (const e of op.edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }

  // Relax repeatedly; with ≤12 nodes this settles immediately and cannot spin.
  for (let pass = 0; pass < op.nodes.length + 1; pass++) {
    for (const e of op.edges) {
      const from = depth.get(e.from);
      if (from === undefined) continue;
      const want = from + 1;
      if ((depth.get(e.to) ?? -1) < want) depth.set(e.to, want);
    }
  }
  for (const n of op.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  const rows = new Map<number, string[]>();
  for (const n of op.nodes) {
    const d = depth.get(n.id) ?? 0;
    const row = rows.get(d) ?? [];
    row.push(n.id);
    rows.set(d, row);
  }

  // Order each row by the mean position of its parents, which uncrosses most
  // edges without a full barycentre sweep.
  const order = new Map<string, number>();
  const depths = [...rows.keys()].sort((a, b) => a - b);
  for (const d of depths) {
    const row = rows.get(d) ?? [];
    row.sort((a, b) => parentMean(a, op.edges, order) - parentMean(b, op.edges, order));
    row.forEach((id, i) => order.set(id, i));
    rows.set(d, row);
  }

  const byId = new Map(op.nodes.map((n) => [n.id, n]));
  const laid: LaidNode[] = [];
  let width = 0;

  for (const d of depths) {
    const row = rows.get(d) ?? [];
    const widths = row.map((id) => nodeWidth(byId.get(id)?.label ?? id));
    const rowWidth = widths.reduce((a, b) => a + b, 0) + H_GAP * (row.length - 1);
    const scale = rowWidth > maxWidth ? maxWidth / rowWidth : 1;
    let x = (maxWidth - Math.min(rowWidth, maxWidth)) / 2;
    row.forEach((id, i) => {
      const node = byId.get(id);
      const w = (widths[i] ?? 100) * scale;
      laid.push({
        id,
        label: node?.label ?? id,
        tone: node?.tone ?? 'default',
        x,
        y: d * (NODE_H + V_GAP),
        w,
        h: NODE_H,
      });
      x += w + H_GAP * scale;
    });
    width = Math.max(width, Math.min(rowWidth, maxWidth));
  }

  const height = (depths.length - 1) * (NODE_H + V_GAP) + NODE_H;
  return { width: maxWidth, height, nodes: laid, edges: routeEdges(op, laid) };
}

function parentMean(
  id: string,
  edges: readonly { from: string; to: string }[],
  order: Map<string, number>,
): number {
  const parents = edges.filter((e) => e.to === id).map((e) => order.get(e.from) ?? 0);
  if (!parents.length) return 0;
  return parents.reduce((a, b) => a + b, 0) / parents.length;
}

/* --------------------------------- cycle --------------------------------- */

function radial(op: Diagram, maxWidth: number): DiagramLayout {
  const n = op.nodes.length;
  const widest = Math.max(...op.nodes.map((x) => nodeWidth(x.label)));
  const r = Math.min(
    (maxWidth - widest) / 2,
    Math.max(120, (n * (widest + 30)) / (2 * Math.PI)),
  );
  const cx = maxWidth / 2;
  const cy = r + NODE_H;

  const nodes: LaidNode[] = op.nodes.map((node, i) => {
    // Start at the top and go clockwise: a cycle read anticlockwise reads wrong
    // to almost everyone, whatever the subject.
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const w = nodeWidth(node.label);
    return {
      id: node.id,
      label: node.label,
      tone: node.tone ?? 'default',
      x: cx + Math.cos(a) * r - w / 2,
      y: cy + Math.sin(a) * r - NODE_H / 2,
      w,
      h: NODE_H,
    };
  });

  return {
    width: maxWidth,
    height: cy + r + NODE_H,
    nodes,
    edges: routeEdges(op, nodes, true),
  };
}

/* ---------------------------------- web ---------------------------------- */

function web(op: Diagram, maxWidth: number): DiagramLayout {
  const n = op.nodes.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = maxWidth / cols;
  const cellH = NODE_H + V_GAP;

  const nodes: LaidNode[] = op.nodes.map((node, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const w = Math.min(nodeWidth(node.label), cellW - 24);
    // Stagger alternate rows so edges between them run at an angle rather than
    // straight through the node in between.
    const offset = r % 2 === 1 ? cellW * 0.18 : 0;
    return {
      id: node.id,
      label: node.label,
      tone: node.tone ?? 'default',
      x: c * cellW + (cellW - w) / 2 + offset,
      y: r * cellH,
      w,
      h: NODE_H,
    };
  });

  return {
    width: maxWidth,
    height: rows * cellH - V_GAP + NODE_H,
    nodes,
    edges: routeEdges(op, nodes),
  };
}

/* ------------------------------ edge routing ----------------------------- */

function routeEdges(op: Diagram, nodes: LaidNode[], curved = false): LaidEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: LaidEdge[] = [];

  for (const e of op.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;

    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const start = edgePoint(a, bc);
    const end = edgePoint(b, ac);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy) || 1;

    // Bow the line away from anything it would otherwise cross. One pass is
    // enough at this scale, and a gentle curve reads as deliberate.
    let bow = curved ? dist * 0.16 : 0;
    for (const other of nodes) {
      if (other.id === a.id || other.id === b.id) continue;
      if (segmentHitsBox(start, end, other)) {
        bow = Math.max(bow, (other.h + 26) * side(start, end, other));
      }
    }

    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const nx = -dy / dist;
    const ny = dx / dist;
    const cxp = mx + nx * bow;
    const cyp = my + ny * bow;

    const d = bow === 0
      ? `M ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)}`
      : `M ${round(start.x)} ${round(start.y)} Q ${round(cxp)} ${round(cyp)} ${round(end.x)} ${round(end.y)}`;

    // Arrowhead points along the final tangent, which for a quadratic is the
    // direction from the control point to the end.
    const tx = bow === 0 ? dx : end.x - cxp;
    const ty = bow === 0 ? dy : end.y - cyp;

    out.push({
      from: e.from,
      to: e.to,
      label: e.label,
      d,
      lx: bow === 0 ? mx : mx + nx * bow * 0.55,
      ly: bow === 0 ? my : my + ny * bow * 0.55,
      angle: (Math.atan2(ty, tx) * 180) / Math.PI,
    });
  }

  return out;
}

/** Where a line toward `to` leaves the box of `node`. */
function edgePoint(node: LaidNode, to: { x: number; y: number }): { x: number; y: number } {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = to.x - cx;
  const dy = to.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const hw = node.w / 2 + 4;
  const hh = node.h / 2 + 4;
  const scale = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : hw / Math.abs(dx),
    Math.abs(dy) < 1e-6 ? Infinity : hh / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function segmentHitsBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  node: LaidNode,
): boolean {
  const pad = 8;
  const minX = node.x - pad;
  const maxX = node.x + node.w + pad;
  const minY = node.y - pad;
  const maxY = node.y + node.h + pad;

  // Sample the segment. Exact segment/AABB intersection is not worth the code
  // here: a missed near-graze costs a slightly tighter curve, nothing more.
  for (let t = 0.08; t <= 0.92; t += 0.06) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
  }
  return false;
}

/** Which way to bow, so the curve moves away from the obstacle. */
function side(
  a: { x: number; y: number },
  b: { x: number; y: number },
  node: LaidNode,
): number {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const cross = (b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x);
  return cross > 0 ? -1 : 1;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
