/**
 * Board geometry and deterministic height estimation.
 *
 * Pagination has to be decided *before* anything renders, because the tool
 * result for `teach_step` reports `boardFull` back to the model in the same
 * turn (§9.1). Measuring the real DOM would mean rendering first and telling
 * the model afterwards, which is a turn too late — so heights are estimated
 * from the op's own structure. The estimate only has to be good enough to
 * decide "does this fit"; the actual layout is ordinary CSS flow.
 */
import type { BoardOp } from './op-schema';

/** Nominal content box of one 16:9 page, in board units (≈ CSS px at 1× scale). */
export const PAGE_W = 1120;
export const PAGE_H = 616;
/** The side column takes a fixed slice of the width when it is in use. */
export const SIDE_W = 300;
export const GUTTER = 40;
export const MAIN_W = PAGE_W - SIDE_W - GUTTER;

/** Fill ratio past which the page shrinks type by one step before paginating. */
export const SHRINK_AT = 0.82;
export const SHRINK_SCALE = 0.88;
/** A single step may never be taller than this many pages (§10.3). */
export const MAX_STEP_PAGES = 2;

const LINE = 26; // one line of 18px body text plus leading
const GAP = 14; // vertical rhythm between ops

/** Rough characters that fit on one line of body text in a column of `w` units. */
function charsPerLine(w: number): number {
  return Math.max(12, Math.floor(w / 9.1));
}

function wrappedLines(text: string, w: number): number {
  const per = charsPerLine(w);
  // Count explicit breaks too; a model will occasionally send them.
  return text
    .split('\n')
    .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / per)), 0);
}

/**
 * Estimated height of one op in board units. Deliberately a little generous:
 * over-estimating paginates a step early, which looks fine, while
 * under-estimating writes off the bottom of the page, which does not.
 */
export function estimateOpHeight(op: BoardOp, colWidth = MAIN_W): number {
  const w = op.col === 'side' ? SIDE_W : colWidth;
  switch (op.op) {
    case 'heading':
      return wrappedLines(op.text, w * 0.8) * 42 + GAP + 10;
    case 'text': {
      const h = wrappedLines(op.text, w) * LINE;
      return (op.tone === 'key' ? h + 34 : h) + GAP;
    }
    case 'math':
      // KaTeX display math runs tall, and long expressions wrap to two rows.
      return (op.tex.length > 60 ? 96 : 62) + (op.label ? LINE : 0) + GAP;
    case 'derive':
      return op.lines.reduce((n, l) => n + (l.note ? 62 : 46), 0) + GAP;
    case 'bullets':
      return op.items.reduce((n, i) => n + wrappedLines(i, w - 28) * LINE + 8, 0) + GAP;
    case 'code': {
      const lines = op.src.split('\n').length;
      return lines * 24 + 28 + GAP;
    }
    case 'diagram': {
      const n = op.nodes.length;
      if (op.layout === 'cycle') return Math.min(360, 180 + n * 18) + GAP;
      if (op.layout === 'web') return Math.min(360, 200 + n * 14) + GAP;
      // flow and tree are layered; depth drives height.
      const depth = estimateDepth(op.nodes.length, op.edges.length);
      return Math.min(420, 70 + depth * 96) + GAP;
    }
    case 'plot':
      return 300 + (op.fns.length > 1 ? 26 : 0) + GAP;
    case 'vectors':
      return 260 + GAP;
    case 'reaction':
      return 78 + (op.condition ? 24 : 0) + GAP;
    case 'table':
      return 44 + op.rows.length * 38 + GAP;
    case 'figure':
      return 320 + (op.caption ? LINE : 0) + GAP;
    case 'annotate':
      // Drawn over an existing op; costs a little room for its label only.
      return op.text ? LINE + GAP : 6;
  }
}

function estimateDepth(nodes: number, edges: number): number {
  if (nodes <= 1) return 1;
  // A chain has n-1 edges and depth n; a wide fan has depth 2. Interpolate.
  const branching = edges / Math.max(1, nodes - 1);
  return Math.max(2, Math.round(nodes / Math.max(1, branching * 1.6)));
}

export function estimateOpsHeight(ops: BoardOp[], colWidth = MAIN_W): number {
  // Side-column ops stack in their own track, so a page's height is whichever
  // column is taller rather than the sum of both.
  let main = 0;
  let side = 0;
  for (const op of ops) {
    const h = estimateOpHeight(op, colWidth);
    if (op.col === 'side') side += h;
    else main += h;
  }
  return Math.max(main, side);
}
