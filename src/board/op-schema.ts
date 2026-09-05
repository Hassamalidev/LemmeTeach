/**
 * The board contract (§10).
 *
 * Thirteen operations. The model never writes SVG, HTML, or a coordinate —
 * it describes structure and the renderer owns every pixel. There is no `x`
 * and no `y` field anywhere below, and adding one would be the single change
 * most likely to make the board look broken, because models are unreliable at
 * positions and reliable at describing shape.
 *
 * Adding a fourteenth op requires deleting one.
 */
import { z } from 'zod';

const shortText = z.string().min(1).max(240);
const lineText = z.string().min(1).max(400);

export const TONES = ['note', 'warn', 'key'] as const;
export type Tone = (typeof TONES)[number];

export const NODE_TONES = ['default', 'key', 'warn', 'muted'] as const;
export type NodeTone = (typeof NODE_TONES)[number];

/** Fields every op may carry: an id so `annotate` can point at it, and a column. */
const common = {
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,32}$/, 'id must be short and alphanumeric')
    .optional(),
  col: z.enum(['main', 'side']).optional(),
};

export const HeadingOp = z.object({ ...common, op: z.literal('heading'), text: shortText }).strict();

export const TextOp = z.object({
  ...common,
  op: z.literal('text'),
  text: lineText,
  tone: z.enum(TONES).optional(),
}).strict();

export const MathOp = z.object({
  ...common,
  op: z.literal('math'),
  tex: z.string().min(1).max(600),
  label: shortText.optional(),
}).strict();

export const DeriveOp = z.object({
  ...common,
  op: z.literal('derive'),
  lines: z
    .array(z.object({ tex: z.string().min(1).max(400), note: shortText.optional() }))
    .min(1)
    .max(8),
}).strict();

export const BulletsOp = z.object({
  ...common,
  op: z.literal('bullets'),
  items: z.array(lineText).min(1).max(6),
}).strict();

export const CodeOp = z.object({
  ...common,
  op: z.literal('code'),
  lang: z.string().min(1).max(24),
  src: z.string().min(1).max(4000),
  focus: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
}).strict();

export const DiagramOp = z.object({
  ...common,
  op: z.literal('diagram'),
  layout: z.enum(['flow', 'cycle', 'tree', 'web']),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        label: z.string().min(1).max(60),
        tone: z.enum(NODE_TONES).optional(),
      }),
    )
    .min(2)
    .max(12),
  edges: z
    .array(
      z.object({
        from: z.string().min(1).max(32),
        to: z.string().min(1).max(32),
        label: z.string().min(1).max(40).optional(),
      }),
    )
    .max(24),
}).strict();

export const PlotOp = z.object({
  ...common,
  op: z.literal('plot'),
  fns: z
    .array(z.object({ expr: z.string().min(1).max(200), label: shortText.optional() }))
    .min(1)
    .max(4),
  domain: z.tuple([z.number(), z.number()]),
  range: z.tuple([z.number(), z.number()]).optional(),
  marks: z
    .array(z.object({ x: z.number(), y: z.number(), label: shortText.optional() }))
    .max(8)
    .optional(),
}).strict();

export const VectorsOp = z.object({
  ...common,
  op: z.literal('vectors'),
  origin: shortText.optional(),
  arrows: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        dx: z.number(),
        dy: z.number(),
        tone: z.enum(NODE_TONES).optional(),
      }),
    )
    .min(1)
    .max(8),
}).strict();

const species = z.object({
  formula: z.string().min(1).max(40),
  coeff: z.number().int().min(1).max(99).optional(),
});

export const ReactionOp = z.object({
  ...common,
  op: z.literal('reaction'),
  left: z.array(species).min(1).max(6),
  right: z.array(species).min(1).max(6),
  condition: shortText.optional(),
}).strict();

export const TableOp = z.object({
  ...common,
  op: z.literal('table'),
  headers: z.array(z.string().max(60)).min(1).max(8),
  rows: z.array(z.array(z.string().max(120)).max(8)).min(1).max(12),
}).strict();

export const FigureOp = z.object({
  ...common,
  op: z.literal('figure'),
  figureId: z.string().min(1).max(64),
  caption: shortText.optional(),
}).strict();

export const AnnotateOp = z.object({
  ...common,
  op: z.literal('annotate'),
  target: z.string().min(1).max(32),
  style: z.enum(['circle', 'underline', 'arrow']),
  text: shortText.optional(),
}).strict();

export const BoardOpSchema = z.discriminatedUnion('op', [
  HeadingOp,
  TextOp,
  MathOp,
  DeriveOp,
  BulletsOp,
  CodeOp,
  DiagramOp,
  PlotOp,
  VectorsOp,
  ReactionOp,
  TableOp,
  FigureOp,
  AnnotateOp,
]);

export type BoardOp = z.infer<typeof BoardOpSchema>;
export type BoardOpKind = BoardOp['op'];

export const BOARD_OP_KINDS: BoardOpKind[] = [
  'heading',
  'text',
  'math',
  'derive',
  'bullets',
  'code',
  'diagram',
  'plot',
  'vectors',
  'reaction',
  'table',
  'figure',
  'annotate',
];

/** An op once it is on a page: given an index and a resolved id. */
export interface PlacedOp {
  op: BoardOp;
  /** Position in the step's op list. The renderer is idempotent per index. */
  index: number;
  /** Globally unique within a page; equals op.id when the model supplied one. */
  key: string;
  stepId: string;
}
