/**
 * The subject explorer on the landing page (§29).
 *
 * Pick a subject and see three things about it: how the tutor approaches it,
 * what one of its boards looks like, and the kind of topics people bring. The
 * approach lines are the subject packs' own rules (§10.4) in a sentence, so
 * the page promises only what the tutor is actually told to do.
 */
import { useState } from 'react';
import { Board } from '../board/Board';
import type { BoardModel } from '../board/page';
import { packFor } from '../agents/prompts/subjects';
import {
  SUBJECT_ACCENTS,
  SUBJECT_IDS,
  SUBJECT_LABELS,
  type SubjectId,
} from '../core/types';
import type { BoardTheme } from '../storage/settings';
import { SubjectGlyph } from './SubjectGlyph';

const APPROACH: Record<SubjectId, string> = {
  math: 'It works one concrete case before stating the general rule, and draws the graph instead of describing it.',
  physics:
    'It names the system and its assumptions, keeps units on every number, and checks at the end that the answer is a sensible size.',
  chemistry:
    'It balances equations one step at a time, never in a single jump, and says what the electrons are doing.',
  cs: 'It traces a small input by hand first, then actually runs the code so you see the real output.',
  biology: 'Structure first, then function, then how the structure explains the function.',
  finance:
    'Real figures before any formula, with the currency and the period on every number. It teaches the idea, not what to buy.',
  psychology:
    'It starts from a classic study, and keeps what was observed apart from how it is explained.',
  general:
    'It picks the picture the topic needs: a flow for a process, a table for a comparison, a tree for a hierarchy.',
};

/** What the board for this subject is an example of, for the caption. */
export interface ExplorerBoard {
  model: BoardModel;
  field: string;
  topic: string;
}

export function SubjectExplorer({
  boards,
  theme,
}: {
  boards: Partial<Record<SubjectId, ExplorerBoard>>;
  theme: BoardTheme;
}): JSX.Element {
  const [subject, setSubject] = useState<SubjectId>('math');
  const board = boards[subject];
  const accent = SUBJECT_ACCENTS[subject];

  return (
    <div className="explorer">
      <div className="explorer-tabs" role="group" aria-label="Subjects">
        {SUBJECT_IDS.map((id) => (
          <button
            key={id}
            className={`explorer-tab ${id === subject ? 'active' : ''}`}
            aria-pressed={id === subject}
            onClick={() => setSubject(id)}
            style={id === subject ? { borderColor: SUBJECT_ACCENTS[id] } : undefined}
          >
            <SubjectGlyph subject={id} size={22} />
            <span>{SUBJECT_LABELS[id]}</span>
          </button>
        ))}
      </div>

      <div className="explorer-panel" aria-live="polite" style={{ borderTopColor: accent }}>
        <div className="explorer-text">
          <h3>How it handles {subject === 'general' ? 'everything else' : SUBJECT_LABELS[subject].toLowerCase()}</h3>
          <p className="dim">{APPROACH[subject]}</p>

          <h4>The kind of thing people ask</h4>
          <ul className="topic-chips">
            {sampleTopics(subject).map((topic) => (
              <li key={topic} className="pill">
                {topic}
              </li>
            ))}
            <li className="pill pill-open">or type your own</li>
          </ul>
        </div>

        {board && (
          <figure className="explorer-figure">
            <div className="explorer-board">
              <Board
                key={subject}
                pages={board.model.pages}
                pageIndex={0}
                theme={theme}
                subject={subject}
                reveal={ALL_WRITTEN}
              />
            </div>
            <figcaption className="dim small">
              An example board: {board.field === SUBJECT_LABELS[subject] ? '' : `${board.field}, `}
              {board.topic.toLowerCase()}.
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

/** Steps missing from the reveal map are fully written. */
const ALL_WRITTEN = new Map<string, number>();

/** Two from each group of the subject's starter tree, so the range shows. */
function sampleTopics(subject: SubjectId): string[] {
  return packFor(subject)
    .topics.flatMap((group) => group.items.slice(0, 2))
    .slice(0, 8);
}
