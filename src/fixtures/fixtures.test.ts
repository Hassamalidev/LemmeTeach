/**
 * Every bundled fixture has to survive the real validator and the real page
 * model. A fixture that no longer passes validation is worse than no fixture:
 * it means the board is being developed against something the tool bus would
 * have rejected.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURE_LESSONS } from './index';
import { validateOps } from '../board/validate';
import { BoardModel } from '../board/page';
import { SUBJECT_IDS } from '../core/types';
import { PlanLessonInput, TeachStepInput } from '../tools/schemas';

describe('fixture lessons', () => {
  it('has one lesson for each subject the demo offers, all of them real subjects', () => {
    const subjects = FIXTURE_LESSONS.map((f) => f.meta.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(subjects.length).toBeGreaterThanOrEqual(5);
    for (const s of subjects) expect(SUBJECT_IDS).toContain(s);
  });

  for (const lesson of FIXTURE_LESSONS) {
    describe(lesson.id, () => {
      it('has a plan that passes plan_lesson validation', () => {
        const plan = lesson.lines.find((l) => l.t === 'plan');
        expect(plan, 'fixture has a plan line').toBeTruthy();
        if (!plan || plan.t !== 'plan') return;
        const { t: _t, ...rest } = plan;
        const parsed = PlanLessonInput.safeParse(rest);
        if (!parsed.success) {
          throw new Error(
            parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          );
        }
      });

      it('has steps that pass teach_step and board validation', () => {
        const model = new BoardModel();
        const figures = new Set<string>();

        for (const line of lesson.lines) {
          if (line.t === 'code' && line.figureId) figures.add(line.figureId);

          if (line.t !== 'step') continue;

          const shape = TeachStepInput.safeParse({
            say: line.say,
            board: line.board,
            clear: line.clear,
            objective: line.objective,
          });
          if (!shape.success) {
            throw new Error(
              `${line.say.slice(0, 40)}… ${shape.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
            );
          }

          const result = validateOps(line.board, {
            knownIds: model.knownIds(),
            knownFigures: figures,
          });
          if (!result.ok) {
            throw new Error(`"${line.say.slice(0, 40)}…" → ${result.problems.join(' ')}`);
          }
          model.write({ say: line.say, ops: result.ops, clear: line.clear ?? false });
        }

        expect(model.stepCount).toBeGreaterThan(3);
      });

      it('narrates in spoken language, with no markup or notation', () => {
        for (const line of lesson.lines) {
          if (line.t !== 'step') continue;
          // The narration is read aloud verbatim (§9.1). Anything a voice
          // cannot pronounce is a bug in the fixture, not a style preference.
          expect(line.say, line.say).not.toMatch(/[\\$*_`#]|\\frac|\\int/);
          expect(line.say.length).toBeGreaterThan(40);
        }
      });

      it('never puts a question to the learner, since they cannot answer one', () => {
        for (const line of lesson.lines) {
          if (line.t !== 'step') continue;
          expect(line.say, line.say).not.toMatch(/what do you think|can you tell me|your turn/i);
        }
      });

      it('ends properly', () => {
        expect(lesson.lines.at(-1)?.t).toBe('end');
      });
    });
  }
});
