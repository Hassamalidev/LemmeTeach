/**
 * The tool catalog's input schemas (§9).
 *
 * Single source of truth: the runtime validates against these, and the JSON
 * Schema handed to the provider is generated from them (`json-schema.ts`), so
 * the two cannot drift apart.
 *
 * `.describe()` text on a field is sent to the model. Write it as an
 * instruction to a colleague, not as documentation — a vague description
 * produces a vague call, and every one of these is part of the product.
 */
import { z } from 'zod';
import { BoardOpSchema } from '../board/op-schema';
import { LEVELS, PACES, SUBJECT_IDS } from '../core/types';

const conceptId = z
  .string()
  .min(1)
  .max(64)
  .describe('A short slug naming one concept, like "chain-rule" or "activation-energy".');

/* ------------------------------------------------------------------ *
 * 9.1  teach_step — the primary tool
 * ------------------------------------------------------------------ */

export const TeachStepInput = z
  .object({
    say: z
      .string()
      .min(1)
      .max(1200)
      .describe(
'Spoken narration, 2 to 4 sentences, read aloud verbatim: no markdown, LaTeX or symbols. Never read the board out loud.',
      ),
    board: z
      .array(BoardOpSchema)
      .max(12)
      .describe(
'Board operations for this step, in the shapes listed under THE BOARD.',
      ),
    clear: z
      .boolean()
      .optional()
      .describe(
        'True starts a fresh section of the board, under a rule. Earlier sections stay on screen above. Set this when the last result said boardFull, or when starting a new question.',
      ),
    objective: z
      .string()
      .max(32)
      .optional()
      .describe('The id of the plan objective this step serves, for example "obj-2".'),
    pace: z
      .enum(PACES)
      .optional()
      .describe('How fast to reveal this step. "slow" for a hard idea, "quick" for a recap.'),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 9.2  ask_learner — suspends
 * ------------------------------------------------------------------ */

export const AskLearnerInput = z
  .object({
    question: z
      .string()
      .min(1)
      .max(400)
      .describe('One question, asked in plain spoken language. Ask about one thing only.'),
    kind: z
      .enum(['free', 'choice', 'confirm', 'number'])
      .describe(
        '"free" for an open answer, "choice" when you supply options, "confirm" for yes or no, "number" for a numeric answer.',
      ),
    options: z
      .array(z.string().min(1).max(160))
      .min(2)
      .max(6)
      .optional()
      .describe('Required when kind is "choice". Two to six plausible options.'),
    why: z
      .string()
      .max(240)
      .optional()
      .describe(
        'What you are trying to find out. Recorded in the trace for the learner to inspect later; never shown during the lesson.',
      ),
  })
  .strict()
  .refine((v) => v.kind !== 'choice' || (v.options && v.options.length >= 2), {
    message: 'kind "choice" requires an options array with at least two entries',
    path: ['options'],
  });

/* ------------------------------------------------------------------ *
 * 9.4  run_code
 * ------------------------------------------------------------------ */

export const RunCodeInput = z
  .object({
    language: z
      .enum(['python', 'javascript'])
      .describe(
        'JavaScript starts instantly; Python takes about five seconds the first time because the runtime has to load. Prefer javascript unless you need numpy, sympy, scipy, matplotlib or pandas.',
      ),
    source: z.string().min(1).max(8000).describe('The program. Print or return the result.'),
    purpose: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'One line on why this needs running, shown to the learner as the status line, for example "integrating the trajectory so we can see where it lands".',
      ),
    expect: z
      .enum(['value', 'table', 'figure', 'text'])
      .describe('What the code produces. Use "figure" when it draws with matplotlib.'),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 9.5  compute
 * ------------------------------------------------------------------ */

export const ComputeInput = z
  .object({
    expressions: z
      .array(z.string().min(1).max(300))
      .min(1)
      .max(8)
      .describe(
        'mathjs expressions, for example "9.81 * 2.5^2 / 2" or "unit(3, \'eV\') to \'J\'" or "simplify(\'x^2 + 2x + 1\')".',
      ),
    precision: z.number().int().min(1).max(15).optional().describe('Significant figures, default 6.'),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 9.7  wiki_lookup
 * ------------------------------------------------------------------ */

export const WikiLookupInput = z
  .object({
    query: z.string().min(1).max(200).describe('An article title or a search phrase.'),
    mode: z
      .enum(['summary', 'search'])
      .describe('"summary" fetches one article, "search" lists candidate titles.'),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * save_note
 * ------------------------------------------------------------------ */

export const SaveNoteInput = z
  .object({
    title: z.string().min(1).max(120),
    markdown: z
      .string()
      .min(1)
      .max(4000)
      .describe(
        'The note body. Unlike narration this is read, not spoken, so Markdown and LaTeX between dollar signs are welcome here.',
      ),
    tags: z.array(z.string().min(1).max(40)).max(6).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 9.12–9.15  terminal tools
 * ------------------------------------------------------------------ */

export const PlanLessonInput = z
  .object({
    title: z.string().min(1).max(120),
    level: z.enum(LEVELS),
    subject: z.enum(SUBJECT_IDS).optional(),
    problem: z
      .string()
      .max(6000)
      .optional()
      .describe(
        'When solving a question: the question restated in full — every number, unit and condition, what is asked, and a precise description of any figure. The solver sees only this, never the attachment.',
      ),
    objectives: z
      .array(
        z
          .object({
            id: z.string().min(1).max(16).describe('Short id like "obj-1".'),
            text: z
              .string()
              .min(1)
              .max(240)
              .describe(
                'In a lesson: written as "the learner can …" and testable. When solving a question: one stage of the solution, in order, like "Find the time in the air".',
              ),
          })
          .strict(),
      )
      .min(3)
      .max(5),
    prerequisites: z
      .array(
        z
          .object({
            concept: conceptId,
            held: z.boolean().describe('True when the learner record already shows they have it.'),
            recap: z
              .boolean()
              .describe('True to fold a short recap into the lesson because it is load-bearing.'),
          })
          .strict(),
      )
      .max(6),
    steps: z
      .array(
        z
          .object({
            objective: z.string().min(1).max(16).describe('Which objective id this step serves.'),
            representation: z.enum([
              'derivation',
              'diagram',
              'simulation',
              'worked-example',
              'trace',
              'recap',
              'check',
            ]),
            note: z.string().max(600).describe('One line on what happens in this step.'),
          })
          .strict(),
      )
      .min(3)
      .max(9),
    estimatedMinutes: z
      .number()
      .int()
      .min(3)
      .max(60)
      .describe('An honest estimate. Learners plan their time around it.'),
  })
  .strict();

export const EndLessonInput = z
  .object({
    summary: z
      .string()
      .min(1)
      .max(1200)
      .describe('What the question was, the method, and the answer, in plain language.'),
    objectivesMet: z.array(z.string().max(16)).max(8),
    objectivesMissed: z.array(z.string().max(16)).max(8),
    nextTopics: z.array(z.string().max(120)).max(5),
  })
  .strict();

export const FixBoardInput = z
  .object({
    ops: z.array(BoardOpSchema).max(12).describe('The corrected board operations.'),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Inferred input types
 * ------------------------------------------------------------------ */

export type TeachStepIn = z.infer<typeof TeachStepInput>;
export type AskLearnerIn = z.infer<typeof AskLearnerInput>;
export type RunCodeIn = z.infer<typeof RunCodeInput>;
export type ComputeIn = z.infer<typeof ComputeInput>;
export type WikiLookupIn = z.infer<typeof WikiLookupInput>;
export type SaveNoteIn = z.infer<typeof SaveNoteInput>;
export type PlanLessonIn = z.infer<typeof PlanLessonInput>;
export type EndLessonIn = z.infer<typeof EndLessonInput>;
export type FixBoardIn = z.infer<typeof FixBoardInput>;

export type LessonPlan = PlanLessonIn & { id: string; createdAt: number };
