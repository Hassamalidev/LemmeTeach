/**
 * The pieces around a solution: what an attachment looks like on the wire,
 * what the two agents are told, the demo's questions, and how a voice is
 * chosen. The session itself is tested in orchestrator/session.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { toOpenAiMessages } from '../providers/normalize';
import type { Attachment } from '../providers/types';
import { kindOf } from './attachments';
import { DEMO_EXAMPLES } from './examples';
import { bestVoices, pickVoice, voiceLabel, voiceQuality } from '../voice/speech';
import { readerPrompt, readerSeed, solverPrompt, solverSeed } from '../agents';
import { fixtureFor } from '../fixtures';

const PICTURE: Attachment = { kind: 'image', name: 'q4.png', dataUrl: 'data:image/png;base64,AAAA' };
const SHEET: Attachment = { kind: 'file', name: 'sheet.pdf', dataUrl: 'data:application/pdf;base64,BBBB' };

describe('an attachment on the wire', () => {
  it('goes as a picture or a file part beside the text', () => {
    const out = toOpenAiMessages('system', [
      { role: 'user', content: 'Solve question 4.', attachments: [PICTURE, SHEET] },
    ]);
    expect(out[1]?.content).toEqual([
      { type: 'text', text: 'Solve question 4.' },
      { type: 'image_url', image_url: { url: PICTURE.dataUrl } },
      { type: 'file', file: { filename: 'sheet.pdf', file_data: SHEET.dataUrl } },
    ]);
  });

  it('leaves a plain message exactly as it was', () => {
    const out = toOpenAiMessages('system', [{ role: 'user', content: 'Solve this.' }]);
    expect(out[1]).toEqual({ role: 'user', content: 'Solve this.' });
  });

  it('is recognised by type, and anything else is turned away', () => {
    expect(kindOf({ name: 'shot.png', type: 'image/png' })).toBe('image');
    expect(kindOf({ name: 'photo.JPG', type: 'image/jpeg' })).toBe('image');
    expect(kindOf({ name: 'paper.pdf', type: 'application/pdf' })).toBe('pdf');
    expect(kindOf({ name: 'paper.pdf', type: '' })).toBe('pdf');
    expect(kindOf({ name: 'notes.txt', type: 'text/plain' })).toBe('text');
    expect(kindOf({ name: 'notes.md', type: '' })).toBe('text');
    expect(kindOf({ name: 'virus.exe', type: 'application/octet-stream' })).toBeNull();
    expect(kindOf({ name: 'deck.pptx', type: '' })).toBeNull();
  });
});

describe('what the agents are told', () => {
  const ctx = {
    subject: 'physics' as const,
    level: 'school' as const,
    topic: 'x',
    sandbox: true,
    wiki: false,
  };

  it('the reader restates everything, because the solver cannot see the upload', () => {
    const prompt = readerPrompt(ctx);
    expect(prompt).toMatch(/will NOT see/);
    expect(prompt).toMatch(/"problem"/);
    expect(prompt).toMatch(/ask_learner only if/);
  });

  it('the reader is told when the question is only in the attachment', () => {
    expect(readerSeed('', 1)).toMatch(/nothing typed/);
    expect(readerSeed('', 2)).toMatch(/2 files/);
    expect(readerSeed('Find x.', 0)).not.toMatch(/attached/);
  });

  it('the solver does not quiz, and finishes with a checked answer', () => {
    const prompt = solverPrompt(ctx);
    expect(prompt).toMatch(/DO NOT QUIZ/);
    expect(prompt).toMatch(/units/);
    expect(prompt).toMatch(/Check that it is sensible/);
    for (const gone of ['check_understanding', 'ask_learner', 'recall_learner', 'update_learner']) {
      expect(prompt).not.toContain(gone);
    }
  });

  it('the solver is told what is unavailable, so it does not offer it', () => {
    const prompt = solverPrompt({ ...ctx, sandbox: false, sandboxReason: 'blocked' });
    expect(prompt).toMatch(/Running code is not available/);
  });

  it('the solver is handed the restated question, not just the learner’s words', () => {
    const seed = solverSeed(
      {
        id: 'p',
        createdAt: 0,
        title: 'Range of a projectile',
        level: 'school',
        problem: 'A ball leaves the ground at 20 m/s, 40 degrees above horizontal. Find the range.',
        objectives: [{ id: 'obj-1', text: 'Find the time in the air' }],
        prerequisites: [],
        steps: [{ objective: 'obj-1', representation: 'derivation', note: 'Vertical motion' }],
        estimatedMinutes: 6,
      },
      'solve q4',
    );
    expect(seed).toContain('20 m/s, 40 degrees above horizontal');
    expect(seed).toContain('solve q4');
  });
});

describe('the demo examples', () => {
  it('are each a real question with a prepared walkthrough behind it', () => {
    expect(DEMO_EXAMPLES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(DEMO_EXAMPLES.map((e) => e.subject)).size).toBe(DEMO_EXAMPLES.length);
    for (const e of DEMO_EXAMPLES) {
      expect(e.question).toMatch(/\?|\.$/);
      expect(fixtureFor(e.subject), e.subject).toBeTruthy();
    }
  });
});

describe('choosing a voice', () => {
  const voice = (name: string, lang: string): SpeechSynthesisVoice =>
    ({ name, lang, localService: true, default: false, voiceURI: name }) as SpeechSynthesisVoice;

  const robot = voice('Microsoft David - English (United States)', 'en-US');
  const neural = voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US');
  const google = voice('Google UK English Female', 'en-GB');
  const german = voice('Microsoft Katja Online (Natural) - German (Germany)', 'de-DE');
  const novelty = voice('Zarvox', 'en-US');
  const all = [robot, novelty, german, google, neural];

  it('prefers a neural voice in the learner’s language over the robotic default', () => {
    expect(voiceQuality(neural, 'en-US')).toBeGreaterThan(voiceQuality(robot, 'en-US'));
    expect(bestVoices(all, 8, 'en-US')[0]).toBe(neural);
    expect(bestVoices(all, 8, 'en-US')[1]).toBe(google);
  });

  it('never offers another language’s voice, however good, or a novelty one first', () => {
    const offered = bestVoices(all, 8, 'en-US');
    expect(offered).not.toContain(german);
    expect(offered.at(-1)).toBe(novelty);
  });

  it('keeps the learner’s own choice when they made one', () => {
    expect(pickVoice(all, robot.name)).toBe(robot);
    expect(pickVoice([], null)).toBeNull();
  });

  it('labels a voice in a few words', () => {
    expect(voiceLabel(neural)).toBe('Aria · en-US');
    expect(voiceLabel(google)).toBe('UK English Female · en-GB');
  });
});

describe('the golden set', () => {
  it('is well formed: every case has a question, an answer and things to check', async () => {
    const { readFileSync } = await import('node:fs');
    const golden = JSON.parse(readFileSync('evals/golden.json', 'utf8')) as {
      cases: { id: string; subject: string; question: string; answer: string; mustShow: string[] }[];
    };
    expect(golden.cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(golden.cases.map((c) => c.id)).size).toBe(golden.cases.length);
    for (const c of golden.cases) {
      expect(c.question.length, c.id).toBeGreaterThan(15);
      expect(c.answer.length, c.id).toBeGreaterThan(0);
      expect(c.mustShow.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('the skills document', () => {
  it('is in the solver prompt, versioned, and small enough to pay for every turn', async () => {
    const { SKILLS_VERSION, SOLVER_SKILLS, skillsBlock } = await import('../agents/skills');
    const prompt = solverPrompt({
      subject: 'math',
      level: 'school',
      topic: 'x',
      sandbox: true,
      wiki: false,
    });
    expect(prompt).toContain(skillsBlock());
    expect(prompt).toContain(`v${SKILLS_VERSION}`);
    expect(SOLVER_SKILLS.length).toBeLessThanOrEqual(12);
    expect(skillsBlock().length).toBeLessThan(2400);
  });
});
