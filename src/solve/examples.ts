/**
 * The questions the free demo can solve.
 *
 * The demo replays a prepared walkthrough rather than calling a model, so it
 * can only answer what it has a walkthrough for. Each example is worded as the
 * question its bundled walkthrough actually works through.
 */
import type { SubjectId } from '../core/types';
import { fixtureFor } from '../fixtures';

export interface DemoExample {
  subject: SubjectId;
  /** Shown on the chip. */
  label: string;
  /** What appears in the question box, as a learner might type it. */
  question: string;
}

const ALL: DemoExample[] = [
  {
    subject: 'physics',
    label: 'Projectile motion',
    question:
      'A ball is thrown at 20 m/s at 40 degrees above the ground. How long is it in the air, how far away does it land, and what angle would throw it furthest?',
  },
  {
    subject: 'math',
    label: 'Integration by parts',
    question: 'How do I integrate x cos(x)? Show me integration by parts step by step.',
  },
  {
    subject: 'cs',
    label: 'Binary search',
    question:
      'Trace binary search finding 23 in a sorted list, show the code, and explain why it only takes about 20 steps for a million items.',
  },
  {
    subject: 'chemistry',
    label: 'Equilibrium',
    question:
      'In the Haber process, N2 + 3H2 ⇌ 2NH3. What happens to the equilibrium if I increase the pressure, and does K change?',
  },
  {
    subject: 'biology',
    label: 'Cellular respiration',
    question:
      'Oxygen is only used in the last stage of cellular respiration. So why does the whole process stop without it?',
  },
];

/** Only the examples there is a bundled walkthrough for. */
export const DEMO_EXAMPLES: DemoExample[] = ALL.filter((e) => fixtureFor(e.subject));
