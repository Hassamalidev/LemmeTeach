/**
 * The hero's example boards are held to the same validator as a board the
 * tutor writes. One that failed would silently vanish from the landing page.
 */
import { describe, expect, it } from 'vitest';
import { SHOWCASES } from './showcase';
import { validateOps } from '../board/validate';
import { SUBJECT_IDS, SUBJECT_LABELS } from '../core/types';
import { SUBJECT_PACKS } from '../agents/prompts/subjects';

describe('the showcase boards', () => {
  for (const show of SHOWCASES) {
    it(`${show.field} — ${show.topic} is a valid board`, () => {
      const result = validateOps(show.board, { knownIds: new Set() });
      expect(result.ok, result.ok ? '' : JSON.stringify(result)).toBe(true);
      expect(show.board[0]?.op).toBe('heading');
      // Short enough to fit the frame.
      expect(show.board.length).toBeLessThanOrEqual(4);
    });
  }

  it('span many fields rather than repeating one', () => {
    expect(new Set(SHOWCASES.map((s) => s.field)).size).toBe(SHOWCASES.length);
    expect(new Set(SHOWCASES.map((s) => s.subject)).size).toBeGreaterThanOrEqual(5);
    // No one subject takes over the rotation.
    for (const id of new Set(SHOWCASES.map((s) => s.subject))) {
      if (id === 'general') continue;
      expect(SHOWCASES.filter((s) => s.subject === id).length, id).toBeLessThanOrEqual(2);
    }
  });
});

describe('every subject', () => {
  for (const id of SUBJECT_IDS) {
    it(`${SUBJECT_LABELS[id]} has guidance, starter topics and a valid worked example`, () => {
      const pack = SUBJECT_PACKS[id];
      expect(pack.id).toBe(id);
      expect(pack.guidance.length).toBeGreaterThan(200);
      expect(pack.topics.length).toBeGreaterThanOrEqual(3);
      const result = validateOps(pack.example.board, { knownIds: new Set() });
      expect(result.ok, result.ok ? '' : JSON.stringify(result)).toBe(true);
    });
  }
});
