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
        'Plain spoken narration, 2 to 5 sentences. A speech engine reads this aloud verbatim, so write it the way you would say it: no markdown, no LaTeX, no bullet characters, no symbols. Say "d by d x" rather than writing the notation. Carry the meaning here and put the notation on the board — never read the board out loud.',
      ),
    board: z
      .array(BoardOpSchema)
      .max(12)
      .describe(
        'The operations to write on the board for this step. The board carries notation and structure; it must not repeat the narration as sentences.',
      ),
    clear: z
      .boolean()
      .optional()
      .describe('True starts a fresh board page. Set this when the last result said boardFull.'),
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
 * 9.3  check_understanding — suspends
 * ------------------------------------------------------------------ */

export const CheckUnderstandingInput = z
  .object({
    questions: z
      .array(
        z
          .object({
            q: z.string().min(1).max(400).describe('The question.'),
            options: z
              .array(z.string().min(1).max(160))
              .min(2)
              .max(5)
              .describe('Two to five options. Wrong options should be plausible misconceptions.'),
            answer: z
              .number()
              .int()
              .min(0)
              .describe('Zero-based index of the correct option.'),
            why: z
              .string()
              .max(300)
              .describe('One sentence explaining why that answer is right. Shown after answering.'),
            concept: conceptId.describe(
              'The concept this question tests, so a wrong answer updates the right record.',
            ),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    onFail: z
      .string()
      .max(80)
      .optional()
      .describe(
        'Optional hint for what to do on a low score, for example "prerequisite:momentum-conservation".',
      ),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.questions.forEach((q, i) => {
      if (q.answer >= q.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', i, 'answer'],
          message: `answer ${q.answer} is out of range; there are ${q.options.length} options (0 to ${q.options.length - 1})`,
        });
      }
    });
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
 * 9.6  search_materials
 * ------------------------------------------------------------------ */

export const SearchMaterialsInput = z
  .object({
    query: z.string().min(1).max(300).describe('What to look for, in the learner’s own words where you have them.'),
    k: z.number().int().min(1).max(8).optional().describe('How many passages to return, default 4.'),
    docId: z.string().max(64).optional().describe('Restrict the search to one document.'),
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
 * 9.8 / 9.9  learner memory
 * ------------------------------------------------------------------ */

export const RecallLearnerInput = z
  .object({
    concepts: z
      .array(conceptId)
      .max(12)
      .optional()
      .describe('Concepts to look up. Omit for a short profile summary instead of the whole record.'),
    includeRecentLessons: z.boolean().optional().describe('Include the last three lesson titles.'),
  })
  .strict();

export const UpdateLearnerInput = z
  .object({
    updates: z
      .array(
        z
          .object({
            concept: conceptId,
            mastery: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe(
                'How well they hold this concept right now, 0 to 1, judged from what you just saw. The store blends this with history rather than overwriting, so report the observation, not a running average.',
              ),
            confidence: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe('How much weight this observation deserves. A single lucky answer is low.'),
            evidence: z
              .string()
              .max(300)
              .optional()
              .describe('What they actually did, for example "applied it to sin(x^2) unprompted".'),
            misconception: z
              .string()
              .max(300)
              .optional()
              .describe('A specific wrong belief you saw, phrased as they would phrase it.'),
            resolved: z
              .boolean()
              .optional()
              .describe('True when a misconception you had recorded is now cleared up.'),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * 9.10 / 9.11  notes and review
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

export const ScheduleReviewInput = z
  .object({
    concept: conceptId,
    dueInDays: z.number().int().min(1).max(180),
    reason: z.string().max(240).describe('Why this needs revisiting, in one line.'),
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
                'Written as "the learner can …" and testable. Never "understand X" — you cannot check that.',
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
            note: z.string().max(240).describe('One line on what happens in this step.'),
          })
          .strict(),
      )
      .min(5)
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
    summary: z.string().min(1).max(1200).describe('What was covered, in plain spoken language.'),
    objectivesMet: z.array(z.string().max(16)).max(8),
    objectivesMissed: z.array(z.string().max(16)).max(8),
    nextTopics: z.array(z.string().max(120)).max(5),
    runExam: z.boolean().describe('Whether to finish with a short check. Usually true.'),
  })
  .strict();

export const FinishExamInput = z
  .object({
    score: z.number().min(0).max(1),
    strengths: z.array(z.string().max(240)).max(5),
    gaps: z
      .array(z.string().max(240))
      .max(5)
      .describe('Name the misconception, not "got question 3 wrong".'),
    verdict: z.string().min(1).max(300).describe('One sentence: are they ready to move on?'),
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
export type CheckUnderstandingIn = z.infer<typeof CheckUnderstandingInput>;
export type RunCodeIn = z.infer<typeof RunCodeInput>;
export type ComputeIn = z.infer<typeof ComputeInput>;
export type SearchMaterialsIn = z.infer<typeof SearchMaterialsInput>;
export type WikiLookupIn = z.infer<typeof WikiLookupInput>;
export type RecallLearnerIn = z.infer<typeof RecallLearnerInput>;
export type UpdateLearnerIn = z.infer<typeof UpdateLearnerInput>;
export type SaveNoteIn = z.infer<typeof SaveNoteInput>;
export type ScheduleReviewIn = z.infer<typeof ScheduleReviewInput>;
export type PlanLessonIn = z.infer<typeof PlanLessonInput>;
export type EndLessonIn = z.infer<typeof EndLessonInput>;
export type FinishExamIn = z.infer<typeof FinishExamInput>;
export type FixBoardIn = z.infer<typeof FixBoardInput>;

export type LessonPlan = PlanLessonIn & { id: string; createdAt: number };
