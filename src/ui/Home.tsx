/**
 * Home (§15.2).
 *
 * Five subject cards, what is due for review, recent lessons, materials.
 * Due-for-review comes first when there is anything in it: the whole point of
 * keeping a record is that it changes what the learner is offered next.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  SUBJECT_ACCENTS,
  SUBJECT_IDS,
  SUBJECT_LABELS,
  type SubjectId,
} from '../core/types';
import { learnerStore } from '../memory/store';
import { materialsStore } from '../materials/store';
import type { DueItem } from '../memory/scheduling';
import type { LessonRecord, MaterialDoc } from '../memory/types';
import { allLessons } from '../storage/db';
import type { Settings } from '../storage/settings';
import { adapterFor } from '../providers';
import { Materials } from './Materials';

export function Home({
  settings,
  onPickSubject,
  onReview,
  onOpenSettings,
  onOpenKnowledge,
}: {
  settings: Settings;
  onPickSubject: (s: SubjectId) => void;
  onReview: (concepts: string[], subject: SubjectId) => void;
  onOpenSettings: () => void;
  onOpenKnowledge: () => void;
}): JSX.Element {
  const [due, setDue] = useState<DueItem[]>([]);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [docs, setDocs] = useState<MaterialDoc[]>([]);

  const refresh = useCallback(() => {
    void learnerStore.due().then(setDue);
    void allLessons().then((l) => setLessons(l.slice(0, 5)));
    void materialsStore.list().then(setDocs);
  }, []);

  useEffect(refresh, [refresh]);
  useEffect(() => materialsStore.subscribe(refresh), [refresh]);

  return (
    <div className="screen">
      <div className="wide">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 28 }}>
          <h1 style={{ marginBottom: 0 }}>What shall we work on?</h1>
          <div className="row">
            <button className="btn-quiet" onClick={onOpenKnowledge}>
              What I know
            </button>
            <button className="btn-quiet" onClick={onOpenSettings}>
              Settings
            </button>
          </div>
        </div>

        {adapterFor(settings.provider).demo && (
          <div className="notice">
            <strong>Replay mode.</strong>{' '}
            <span className="dim">
              You are seeing a bundled lesson. Add a key in Settings for a lesson that responds to
              you.
            </span>
          </div>
        )}

        {due.length > 0 && (
          <section style={{ marginBottom: 34 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Due for review</h2>
              <button
                className="btn"
                onClick={() =>
                  onReview(
                    due.slice(0, 5).map((d) => d.concept),
                    due[0]?.record.subject ?? 'math',
                  )
                }
              >
                Review these
              </button>
            </div>
            <div className="list">
              {due.slice(0, 5).map((d) => (
                <div key={d.concept} className="list-item">
                  <div style={{ minWidth: 0 }}>
                    <div>{d.concept.replace(/-/g, ' ')}</div>
                    <div className="dim small">
                      {SUBJECT_LABELS[d.record.subject]} ·{' '}
                      {d.overdueDays === 0
                        ? 'due today'
                        : `${d.overdueDays} day${d.overdueDays === 1 ? '' : 's'} overdue`}
                    </div>
                  </div>
                  <div className="bar" style={{ width: 80 }}>
                    <span style={{ width: `${Math.round(d.mastery * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 34 }}>
          <div className="grid">
            {SUBJECT_IDS.map((id) => (
              <button key={id} className="card" onClick={() => onPickSubject(id)}>
                <span
                  className="subject-mark"
                  style={{ background: SUBJECT_ACCENTS[id] }}
                  aria-hidden="true"
                />
                <strong>{SUBJECT_LABELS[id]}</strong>
              </button>
            ))}
          </div>
        </section>

        {lessons.length > 0 && (
          <section style={{ marginBottom: 34 }}>
            <h2>Recent lessons</h2>
            <div className="list">
              {lessons.map((l) => (
                <div key={l.id} className="list-item">
                  <div style={{ minWidth: 0 }}>
                    <div>{l.title}</div>
                    <div className="dim small">
                      {SUBJECT_LABELS[l.subject]} · {relativeDay(l.startedAt)}
                      {l.exam ? ` · scored ${Math.round(l.exam.score * 100)}%` : ''}
                    </div>
                  </div>
                  <button className="btn-quiet small" onClick={() => onPickSubject(l.subject)}>
                    More of this
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>Your material</h2>
          <p className="dim small" style={{ maxWidth: '60ch' }}>
            Drop in your own notes, a syllabus, or a chapter, and lessons will use your course’s
            wording and ordering instead of a generic treatment. Files stay in this browser.
          </p>
          <Materials docs={docs} onChange={refresh} />
        </section>
      </div>
    </div>
  );
}

function relativeDay(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
