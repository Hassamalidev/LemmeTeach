/**
 * The example boards in the landing page hero (§29).
 *
 * One short board per field, so a visitor sees the range of what a lesson
 * looks like rather than the same derivation on a loop. These are written by
 * hand as examples, and the caption under the board says so. They go through
 * the same validator as a board the tutor writes, and a test holds them to it.
 */
import type { SubjectId } from '../core/types';
import type { BoardOp } from '../board/op-schema';

export interface Showcase {
  /** Decides the board's accent. */
  subject: SubjectId;
  /** The field, as the caption names it. */
  field: string;
  topic: string;
  board: BoardOp[];
}

const BOARDS: Showcase[] = [
  {
    subject: 'physics',
    field: 'Physics',
    topic: 'Projectile motion',
    board: [
      { op: 'heading', text: 'Projectile motion' },
      {
        op: 'plot',
        fns: [{ expr: 'x - 9.81 * x^2 / 400', label: '20 m/s at 45°' }],
        domain: [0, 41],
      },
      { op: 'text', text: 'Sideways speed never changes. Gravity only pulls down.', tone: 'key' },
    ],
  },
  {
    subject: 'chemistry',
    field: 'Chemistry',
    topic: 'Balancing an equation',
    board: [
      { op: 'heading', text: 'Burning methane' },
      {
        op: 'reaction',
        left: [{ formula: 'CH4' }, { formula: 'O2', coeff: 2 }],
        right: [{ formula: 'CO2' }, { formula: 'H2O', coeff: 2 }],
      },
      {
        op: 'bullets',
        items: ['Carbon: 1 on each side', 'Hydrogen: 4 on each side', 'Oxygen: 4 on each side'],
      },
      { op: 'text', text: 'Count atoms, not molecules. Change coefficients, never formulas.', tone: 'key' },
    ],
  },
  {
    subject: 'finance',
    field: 'Finance',
    topic: 'Compound interest',
    board: [
      { op: 'heading', text: 'Compound interest' },
      {
        op: 'plot',
        fns: [
          { expr: '1000 * 1.07^x', label: 'compound, 7%' },
          { expr: '1000 + 70 * x', label: 'simple, 7%' },
        ],
        domain: [0, 30],
      },
      { op: 'text', text: 'The gap is interest earned on interest. Time does most of the work.', tone: 'key' },
    ],
  },
  {
    subject: 'cs',
    field: 'Data structures and algorithms',
    topic: 'Binary search',
    board: [
      { op: 'heading', text: 'Binary search' },
      {
        op: 'code',
        lang: 'python',
        src: 'lo, hi = 0, len(a) - 1\nwhile lo <= hi:\n    mid = (lo + hi) // 2\n    if a[mid] == target:\n        return mid\n    if a[mid] < target:\n        lo = mid + 1\n    else:\n        hi = mid - 1',
        focus: [3, 3],
      },
      { op: 'text', text: 'Every comparison throws away half of what is left.', tone: 'key' },
    ],
  },
  {
    subject: 'cs',
    field: 'Object-oriented programming',
    topic: 'Inheritance and polymorphism',
    board: [
      { op: 'heading', text: 'One call, many shapes' },
      {
        op: 'diagram',
        layout: 'tree',
        nodes: [
          { id: 'shape', label: 'Shape' },
          { id: 'circle', label: 'Circle' },
          { id: 'square', label: 'Square' },
        ],
        edges: [
          { from: 'shape', to: 'circle' },
          { from: 'shape', to: 'square' },
        ],
      },
      { op: 'code', lang: 'python', src: 'for s in shapes:\n    print(s.area())' },
      { op: 'text', text: 'The caller asks for an area. Each object decides how.', tone: 'key' },
    ],
  },
  {
    subject: 'psychology',
    field: 'Psychology',
    topic: 'Classical conditioning',
    board: [
      { op: 'heading', text: 'Classical conditioning' },
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'bell', label: 'Bell' },
          { id: 'food', label: 'Food' },
          { id: 'drool', label: 'Salivation' },
        ],
        edges: [
          { from: 'bell', to: 'food', label: 'paired, many times' },
          { from: 'food', to: 'drool', label: 'reflex' },
        ],
      },
      {
        op: 'bullets',
        items: ['Before: the bell means nothing', 'After: the bell alone triggers salivation'],
      },
      { op: 'text', text: 'The bell matters only once it predicts the food.', tone: 'key' },
    ],
  },
  {
    subject: 'math',
    field: 'Math',
    topic: 'Integration by parts',
    board: [
      { op: 'heading', text: 'Integration by parts' },
      {
        op: 'derive',
        lines: [
          { tex: '\\frac{d}{dx}(uv) = u\'v + uv\'', note: 'the product rule' },
          { tex: 'uv = \\int u\'v\\,dx + \\int uv\'\\,dx', note: 'integrate both sides' },
          { tex: '\\int u\\,dv = uv - \\int v\\,du', note: 'rearranged' },
        ],
      },
      { op: 'text', text: 'You trade one integral for another. It helps only if the new one is easier.', tone: 'key' },
    ],
  },
  {
    subject: 'biology',
    field: 'Biology',
    topic: 'The cell cycle',
    board: [
      { op: 'heading', text: 'The cell cycle' },
      {
        op: 'diagram',
        layout: 'cycle',
        nodes: [
          { id: 'g1', label: 'G1: grow' },
          { id: 's', label: 'S: copy DNA' },
          { id: 'g2', label: 'G2: check' },
          { id: 'm', label: 'M: divide' },
        ],
        edges: [
          { from: 'g1', to: 's' },
          { from: 's', to: 'g2' },
          { from: 'g2', to: 'm' },
          { from: 'm', to: 'g1' },
        ],
      },
      { op: 'text', text: 'Most of a cell’s life is spent preparing, not dividing.', tone: 'key' },
    ],
  },
  {
    subject: 'general',
    field: 'History',
    topic: 'Causes of the First World War',
    board: [
      { op: 'heading', text: 'How a war became possible' },
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'alliances', label: 'Rival alliances' },
          { id: 'arms', label: 'Arms race' },
          { id: 'spark', label: 'Assassination, 1914' },
          { id: 'war', label: 'War' },
        ],
        edges: [
          { from: 'alliances', to: 'arms' },
          { from: 'arms', to: 'spark' },
          { from: 'spark', to: 'war' },
        ],
      },
      { op: 'text', text: 'Long causes make a war possible. A short one decides when.', tone: 'key' },
    ],
  },
  {
    subject: 'general',
    field: 'English',
    topic: 'Active and passive voice',
    board: [
      { op: 'heading', text: 'Active and passive voice' },
      {
        op: 'table',
        headers: ['Voice', 'Sentence'],
        rows: [
          ['Active', 'The dog chased the ball.'],
          ['Passive', 'The ball was chased by the dog.'],
        ],
      },
      {
        op: 'bullets',
        items: ['Active: the subject does the action', 'Passive: the subject receives it'],
      },
      { op: 'text', text: 'Use the active voice unless who did it is unknown or beside the point.', tone: 'key' },
    ],
  },
  {
    subject: 'general',
    field: 'Geography',
    topic: 'The water cycle',
    board: [
      { op: 'heading', text: 'The water cycle' },
      {
        op: 'diagram',
        layout: 'cycle',
        nodes: [
          { id: 'evap', label: 'Evaporation' },
          { id: 'cond', label: 'Condensation' },
          { id: 'rain', label: 'Precipitation' },
          { id: 'run', label: 'Runoff' },
        ],
        edges: [
          { from: 'evap', to: 'cond' },
          { from: 'cond', to: 'rain' },
          { from: 'rain', to: 'run' },
          { from: 'run', to: 'evap' },
        ],
      },
      { op: 'text', text: 'No water is made or lost. The sun just keeps it moving.', tone: 'key' },
    ],
  },
  {
    subject: 'general',
    field: 'Art',
    topic: 'Colour theory',
    board: [
      { op: 'heading', text: 'Mixing colours' },
      {
        op: 'table',
        headers: ['Mix these', 'To get'],
        rows: [
          ['Red and yellow', 'Orange'],
          ['Yellow and blue', 'Green'],
          ['Blue and red', 'Purple'],
        ],
      },
      { op: 'text', text: 'Colours opposite each other on the wheel make each other look brighter.', tone: 'key' },
    ],
  },
  {
    subject: 'chemistry',
    field: 'Organic chemistry',
    topic: 'Making an ester',
    board: [
      { op: 'heading', text: 'Making an ester' },
      {
        op: 'reaction',
        left: [{ formula: 'CH3COOH' }, { formula: 'C2H5OH' }],
        right: [{ formula: 'CH3COOC2H5' }, { formula: 'H2O' }],
        condition: 'acid catalyst',
      },
      {
        op: 'bullets',
        items: ['Acid plus alcohol gives ester plus water', 'The reaction runs both ways'],
      },
      { op: 'text', text: 'The acid gives up OH, the alcohol gives up H, and they leave as water.', tone: 'key' },
    ],
  },
  {
    subject: 'general',
    field: 'Physical education',
    topic: 'Heart rate training zones',
    board: [
      { op: 'heading', text: 'Training by heart rate' },
      {
        op: 'table',
        headers: ['Zone', 'Share of maximum', 'Feels like'],
        rows: [
          ['Easy', '60 to 70%', 'You can hold a conversation'],
          ['Tempo', '80 to 90%', 'A few words at a time'],
          ['Hard', 'Over 90%', 'You cannot talk'],
        ],
      },
      { op: 'text', text: 'A rough guide to your maximum: 220 minus your age.', tone: 'key' },
    ],
  },
];

/**
 * The order they play in: no two neighbours from the same corner of the
 * curriculum, so the range is obvious within the first few boards.
 */
const ORDER = [
  'Physics',
  'History',
  'Chemistry',
  'English',
  'Finance',
  'Geography',
  'Data structures and algorithms',
  'Art',
  'Psychology',
  'Organic chemistry',
  'Math',
  'Physical education',
  'Biology',
  'Object-oriented programming',
];

export const SHOWCASES: Showcase[] = [
  ...ORDER.flatMap((field) => BOARDS.filter((b) => b.field === field)),
  // Anything not named above still plays, at the end.
  ...BOARDS.filter((b) => !ORDER.includes(b.field)),
];
