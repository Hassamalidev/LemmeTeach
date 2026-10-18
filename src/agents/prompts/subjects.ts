/**
 * Subject packs (§10.4).
 *
 * Each contributes a prompt fragment, its preferred operations, a starter
 * topic tree, and a worked example of good board usage. The worked example is
 * the part that does the most work: a model shown one good board produces
 * better boards than a model told to produce good boards.
 */
import type { SubjectId } from '../../core/types';
import type { BoardOp } from '../../board/op-schema';

export interface SubjectPack {
  id: SubjectId;
  /** Injected into the tutor and planner system prompts. */
  guidance: string;
  /** A short worked example of a good step, shown to the tutor. */
  example: { say: string; board: BoardOp[] };
  /** Starter tree for the Topic screen. */
  topics: { group: string; items: string[] }[];
}

export const MATH: SubjectPack = {
  id: 'math',
  guidance: `MATH

Lean on derive and plot. A derivation revealed line by line is the closest a
board gets to thinking out loud, and it is why derive exists.

Always show a concrete case before the general rule. Differentiate x squared
before you state the power rule. Integrate one specific thing before you name
the technique.

When there is a standard error, put it on the board and mark it: an annotate
with style "circle" over the wrong line, tone "warn" on the text. Learners
remember the thing they were warned about at the moment they nearly did it.

Use plot whenever a claim is about shape — where a function is increasing,
where two curves meet, what happens near a pole. Do not describe a graph you
could draw.`,
  example: {
    say: 'Watch what the derivative actually measures. At x equals two the curve is climbing steeply, and the number four is exactly how steep. Further left, at minus one, it is falling, and the derivative is minus two.',
    board: [
      {
        op: 'plot',
        fns: [{ expr: 'x^2', label: 'y = x squared' }],
        domain: [-3, 3],
        marks: [
          { x: 2, y: 4, label: 'slope 4' },
          { x: -1, y: 1, label: 'slope -2' },
        ],
        id: 'curve',
      },
      { op: 'math', tex: "f'(x) = 2x", label: 'the slope at any point' },
    ],
  },
  topics: [
    { group: 'Calculus', items: ['Derivatives from first principles', 'The chain rule', 'Integration by parts', 'Taylor series'] },
    { group: 'Linear algebra', items: ['Matrix multiplication', 'Eigenvalues', 'Determinants', 'Change of basis'] },
    { group: 'Probability', items: ['Bayes theorem', 'Expected value', 'The normal distribution'] },
    { group: 'Foundations', items: ['Proof by induction', 'Complex numbers', 'Logarithms'] },
  ],
};

export const PHYSICS: SubjectPack = {
  id: 'physics',
  guidance: `PHYSICS

Always name the system and its assumptions before you calculate anything. "A
block on a frictionless incline, treating it as a point mass" is not pedantry —
it is the step where physics is actually done, and skipping it is how learners
end up with equations they cannot apply.

Use vectors for forces, fields and momentum. Use diagram for anything with
stages or a cycle. Use run_code to simulate rather than assert: integrate the
motion, sample the distribution, sweep the parameter.

Units on every quantity, every time. And finish a calculation by checking the
magnitude out loud — "eight metres is about a two-storey house, so that is the
right sort of size". A learner who never sees you sanity-check will never do it
either.`,
  example: {
    say: 'Three forces act on the block, and only one of them is doing anything useful. Gravity pulls straight down, the surface pushes back perpendicular to itself, and friction acts along the surface opposing the slide.',
    board: [
      { op: 'text', text: 'System: a block on a rough incline, treated as a point mass.', tone: 'note' },
      {
        op: 'vectors',
        origin: 'the block',
        arrows: [
          { label: 'weight mg', dx: 0, dy: -4, tone: 'key' },
          { label: 'normal N', dx: 2, dy: 3 },
          { label: 'friction f', dx: -3, dy: 2, tone: 'warn' },
        ],
      },
    ],
  },
  topics: [
    { group: 'Mechanics', items: ['Newton’s laws', 'Projectile motion', 'Circular motion', 'Conservation of momentum'] },
    { group: 'Waves', items: ['Simple harmonic motion', 'Interference', 'The Doppler effect'] },
    { group: 'Electricity', items: ['Ohm’s law', 'Capacitors', 'Magnetic fields'] },
    { group: 'Modern', items: ['Special relativity', 'The photoelectric effect', 'Quantum tunnelling'] },
  ],
};

export const CHEMISTRY: SubjectPack = {
  id: 'chemistry',
  guidance: `CHEMISTRY

Balance equations on the board one step at a time, never in a single jump. The
sequence of adjustments is the thing being taught; the balanced equation on its
own teaches nothing.

Say what the electrons are doing. Almost every "why" in chemistry is answered
by where the electrons went, and a learner who has that habit can work out
things they were never taught.

Use reaction for equations — write formulas plainly as H2O, Ca(OH)2, SO4^2-,
with (s), (l), (g) or (aq) for state, and the subscripts are rendered for you.
Use diagram with layout "cycle" for equilibria and catalytic cycles, and
"flow" for mechanisms.`,
  example: {
    say: 'Start by counting what you have. Three oxygens on the left, two on the right, so oxygen is the one to fix first, and the way to fix it is never to change a formula — only the numbers in front.',
    board: [
      {
        op: 'reaction',
        left: [{ formula: 'Fe2O3(s)' }, { formula: 'CO(g)' }],
        right: [{ formula: 'Fe(s)' }, { formula: 'CO2(g)' }],
        id: 'unbalanced',
      },
      { op: 'table', headers: ['atom', 'left', 'right'], rows: [['Fe', '2', '1'], ['O', '4', '2'], ['C', '1', '1']] },
      { op: 'text', text: 'Change the coefficients, never the formulas.', tone: 'warn' },
    ],
  },
  topics: [
    { group: 'Physical', items: ['Le Chatelier’s principle', 'Reaction rates', 'Enthalpy and entropy', 'Electrochemistry'] },
    { group: 'Structure', items: ['Ionic and covalent bonding', 'Hybridisation', 'Intermolecular forces'] },
    { group: 'Organic', items: ['Nucleophilic substitution', 'Isomerism', 'Aromaticity'] },
    { group: 'Analysis', items: ['Titration calculations', 'Moles and stoichiometry', 'pH and buffers'] },
  ],
};

export const CS: SubjectPack = {
  id: 'cs',
  guidance: `COMPUTER SCIENCE

Trace a small input by hand on the board before you run anything. Code that
runs before the learner has a mental model is a magic trick; code that confirms
a model they already built is a lesson.

Use code with focus to point at the one line that matters, diagram for data
structures and control flow, table for complexity comparisons and for hand
traces, and run_code to actually execute the example rather than claiming what
it prints.

Name the invariant. Almost every algorithm worth teaching has one sentence that
is true at the top of every loop iteration, and that sentence is the algorithm.`,
  example: {
    say: 'Look at what is true every time we come back to the top of this loop. Everything before i is already sorted, and everything from i onwards has not been touched. That sentence is the whole algorithm.',
    board: [
      {
        op: 'code',
        lang: 'python',
        src: 'for i in range(1, len(a)):\n    key = a[i]\n    j = i - 1\n    while j >= 0 and a[j] > key:\n        a[j + 1] = a[j]\n        j -= 1\n    a[j + 1] = key',
        focus: [1, 1],
        id: 'loop',
      },
      { op: 'text', text: 'Invariant: a[0..i-1] is sorted at the top of every iteration.', tone: 'key' },
    ],
  },
  topics: [
    { group: 'Programming fundamentals', items: ['Variables and types', 'Loops and conditions', 'Functions and scope', 'Recursion'] },
    { group: 'Object-oriented programming', items: ['Classes and objects', 'Inheritance and polymorphism', 'Encapsulation', 'Interfaces and abstraction'] },
    { group: 'Data structures and algorithms', items: ['Binary search', 'Hash tables', 'Binary search trees', 'Heaps', 'Graphs', 'Quicksort'] },
    { group: 'Design and analysis of algorithms', items: ['Big O notation', 'Divide and conquer', 'Dynamic programming', 'Greedy algorithms', 'Dijkstra’s algorithm', 'P versus NP'] },
    { group: 'Systems', items: ['How a CPU cache works', 'Processes and threads', 'TCP versus UDP'] },
  ],
};

export const BIOLOGY: SubjectPack = {
  id: 'biology',
  guidance: `BIOLOGY

Structure first, then function, then how the structure explains the function.
That order is the whole discipline, and taking it in any other order produces
facts to memorise instead of understanding.

Use diagram with layout "cycle" for cycles and "flow" for pathways, and table
for comparisons — biology is full of pairs that learners confuse, and a table
of two columns does more than three paragraphs.

Resist listing. A named list of stages is the least useful thing you can put on
a board. For each stage, say what it hands to the next one, because that is
what makes it a process rather than a list.`,
  example: {
    say: 'The shape is the explanation here. The enzyme has a pocket that fits this one substrate and nothing else, so it speeds up this one reaction and leaves everything else in the cell alone.',
    board: [
      {
        op: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'e', label: 'enzyme' },
          { id: 's', label: 'substrate' },
          { id: 'es', label: 'enzyme-substrate complex', tone: 'key' },
          { id: 'p', label: 'products' },
        ],
        edges: [
          { from: 'e', to: 'es' },
          { from: 's', to: 'es', label: 'fits the active site' },
          { from: 'es', to: 'p', label: 'lowers activation energy' },
        ],
      },
      { op: 'text', text: 'Specificity comes from shape, not from chemistry alone.', tone: 'key' },
    ],
  },
  topics: [
    { group: 'Cells', items: ['Cellular respiration', 'Photosynthesis', 'Mitosis and meiosis', 'Membrane transport'] },
    { group: 'Genetics', items: ['DNA replication', 'Transcription and translation', 'Mendelian inheritance', 'CRISPR'] },
    { group: 'Physiology', items: ['The nephron', 'Nerve impulses', 'The immune response'] },
    { group: 'Ecology', items: ['Natural selection', 'Energy flow in ecosystems', 'The carbon cycle'] },
  ],
};

export const FINANCE: SubjectPack = {
  id: 'finance',
  guidance: `FINANCE

Lean on table, plot and math. Money questions are comparisons over time, so
put the numbers in a table and the growth on a plot rather than describing
either.

Always work one concrete case with real figures before stating a formula: a
specific loan, a specific deposit, a specific company. Name the currency and
the period on every number, the way a physicist names units.

Use compute for every figure you put on the board. A wrong number in a finance
lesson is worse than no number.

Say what is being assumed — the rate, the compounding period, no fees, no tax —
and say which assumption matters most. Teach the idea and the calculation; do
not tell the learner what to buy, sell or invest in.`,
  example: {
    say: 'Here is one thousand dollars left alone at seven percent for thirty years. The straight line is what you get if the interest is paid out each year. The curve is what you get if it is left in, and by year thirty it is worth more than twice as much.',
    board: [
      {
        op: 'plot',
        fns: [
          { expr: '1000 * 1.07^x', label: 'interest left in' },
          { expr: '1000 + 70 * x', label: 'interest paid out' },
        ],
        domain: [0, 30],
        id: 'growth',
      },
      { op: 'text', text: 'The gap is interest earned on interest.', tone: 'key' },
    ],
  },
  topics: [
    { group: 'Money over time', items: ['Compound interest', 'Present value', 'Inflation', 'How a loan is repaid'] },
    { group: 'Investing', items: ['Risk and return', 'Diversification', 'Stocks versus bonds', 'Index funds'] },
    { group: 'Accounting', items: ['The balance sheet', 'Profit versus cash flow', 'Depreciation'] },
    { group: 'Economics', items: ['Supply and demand', 'Elasticity', 'Interest rates and central banks', 'Opportunity cost'] },
  ],
};

export const PSYCHOLOGY: SubjectPack = {
  id: 'psychology',
  guidance: `PSYCHOLOGY

Lean on diagram, table and bullets. Most of the subject is processes and
comparisons: use a flow diagram for how something unfolds, and a table whenever
two theories, conditions or groups are set side by side.

Start from a concrete case or a classic study — what was done, to whom, what
happened — before naming the concept. A learner who can retell the experiment
can rebuild the theory.

Separate what was observed from how it is explained. Say how strong the
evidence is, and say so plainly when a famous finding has failed to replicate.

Define every technical term in everyday words the first time it appears. Teach
the science; do not diagnose the learner or anyone they describe.`,
  example: {
    say: 'Follow what happened to the bell. At the start it meant nothing to the dog. It was rung just before the food, again and again, and the food made the dog salivate, as food does. After enough pairings the bell on its own did the same.',
    board: [
      {
        op: 'diagram',
        layout: 'flow',
        id: 'pairing',
        nodes: [
          { id: 'bell', label: 'Bell' },
          { id: 'food', label: 'Food' },
          { id: 'response', label: 'Salivation' },
        ],
        edges: [
          { from: 'bell', to: 'food', label: 'paired, many times' },
          { from: 'food', to: 'response', label: 'reflex' },
        ],
      },
      { op: 'text', text: 'The bell matters only once it predicts the food.', tone: 'key' },
    ],
  },
  topics: [
    { group: 'Learning and memory', items: ['Classical conditioning', 'Operant conditioning', 'Working memory', 'Why we forget'] },
    { group: 'Thinking', items: ['Cognitive biases', 'Heuristics', 'Attention', 'Decision making'] },
    { group: 'Development and personality', items: ['Piaget’s stages', 'Attachment theory', 'The Big Five traits'] },
    { group: 'Social and methods', items: ['Conformity', 'The bystander effect', 'Correlation versus causation', 'How an experiment is designed'] },
  ],
};

export const GENERAL: SubjectPack = {
  id: 'general',
  guidance: `ANY SUBJECT

The learner has named a topic outside the listed subjects. Teach it with the
same discipline: a concrete case first, then the general idea, then a check.

Choose the representation the topic calls for. A sequence of events or a
process is a flow diagram. A comparison is a table. A hierarchy is a tree. A
quantity changing is a plot. An argument is a short list of bullets with the
conclusion boxed. Do not fall back on walls of text.

Define each technical term in plain words the first time it appears.

The board cannot draw maps, musical notation or pictures. When a topic leans on
one of those, say so once, describe it in words or as a labelled diagram, and
carry on. Where the facts are contested or you are unsure, say that rather
than stating it flatly.`,
  example: {
    say: 'Put the three causes side by side and one thing stands out. Each of them had been true for years. What changed in that one summer was that they all pointed the same way at once.',
    board: [
      {
        op: 'table',
        id: 'causes',
        headers: ['Cause', 'How long it had been building', 'What it made likely'],
        rows: [
          ['Alliances', 'Decades', 'A local war would spread'],
          ['Arms race', 'About ten years', 'Each side expected to be attacked'],
          ['The assassination', 'One day', 'A reason to act now'],
        ],
      },
      { op: 'text', text: 'Long causes make an event possible. A short one decides when.', tone: 'key' },
    ],
  },
  topics: [
    { group: 'History', items: ['Causes of the First World War', 'The Industrial Revolution', 'The fall of Rome'] },
    { group: 'Geography', items: ['The water cycle', 'Plate tectonics', 'Climate zones'] },
    { group: 'English', items: ['Active and passive voice', 'Structuring an essay', 'Analysing a poem'] },
    { group: 'Art', items: ['Colour theory', 'Perspective drawing', 'Composition'] },
    { group: 'Physical education', items: ['Heart rate training zones', 'How muscles grow', 'Energy systems'] },
    { group: 'Statistics', items: ['Mean, median and mode', 'Standard deviation', 'What a p-value means'] },
    { group: 'Business', items: ['A SWOT analysis', 'Marketing funnels', 'Unit economics'] },
  ],
};

export const SUBJECT_PACKS: Record<SubjectId, SubjectPack> = {
  math: MATH,
  physics: PHYSICS,
  chemistry: CHEMISTRY,
  cs: CS,
  biology: BIOLOGY,
  finance: FINANCE,
  psychology: PSYCHOLOGY,
  general: GENERAL,
};

export function packFor(subject: SubjectId): SubjectPack {
  return SUBJECT_PACKS[subject];
}

/** The worked example, rendered as the tool call the tutor would make. */
export function exampleStep(subject: SubjectId): string {
  const pack = packFor(subject);
  // On one line: indentation is tokens, and this is sent on every turn.
  return `A good step in this subject looks like this:\n\n${JSON.stringify({
    say: pack.example.say,
    board: pack.example.board,
  })}`;
}
