/**
 * What I know (§12.4).
 *
 * The learner's own record, in plain language, with a reset per concept and
 * export, import and erase for the whole thing. A hidden profile that shapes
 * the teaching without being inspectable would be the wrong thing to build, so
 * everything the tutor reads is on this screen.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  SUBJECT_IDS,
  SUBJECT_LABELS,
  SUBJECT_ACCENTS,
  type SubjectId,
} from '../core/types';
import { learnerStore } from '../memory/store';
import { decayedMastery, masteryLabel, openMisconceptions } from '../memory/concepts';
import type { ConceptRecord } from '../memory/types';
import { eraseEverything, exportAll } from '../storage/db';

export function WhatIKnow({ onBack }: { onBack: () => void }): JSX.Element {
  const [records, setRecords] = useState<ConceptRecord[]>([]);
  const [confirmErase, setConfirmErase] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void learnerStore.concepts().then(setRecords);
  }, []);

  useEffect(refresh, [refresh]);

  const bySubject = (s: SubjectId): ConceptRecord[] =>
    records
      .filter((r) => r.subject === s)
      .sort((a, b) => decayedMastery(b) - decayedMastery(a));

  return (
    <div className="screen">
      <div className="wide">
        <button className="btn-quiet" onClick={onBack} style={{ marginBottom: 16 }}>
          ← Home
        </button>

        <h1>What I know about you</h1>
        <p className="lede">
          This is everything Chalk has recorded, and all of it stays on this device. The tutor
          reads it before every lesson, so if something here is wrong, reset it.
        </p>

        {message && <div className="notice">{message}</div>}

        {records.length === 0 && (
          <p className="dim">Nothing yet. It fills in as you work through lessons.</p>
        )}

        {SUBJECT_IDS.map((s) => {
          const list = bySubject(s);
          if (!list.length) return null;
          return (
            <section key={s} style={{ marginBottom: 30 }}>
              <h2 style={{ color: SUBJECT_ACCENTS[s] }}>{SUBJECT_LABELS[s]}</h2>
              <div className="list">
                {list.map((r) => {
                  const m = decayedMastery(r);
                  const issues = openMisconceptions(r);
                  return (
                    <div key={r.concept} className="list-item" style={{ alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div>{r.concept.replace(/-/g, ' ')}</div>
                        <div className="dim small">
                          {masteryLabel(m)} · seen {r.timesSeen} time
                          {r.timesSeen === 1 ? '' : 's'} · last{' '}
                          {Math.floor((Date.now() - r.lastSeen) / 86_400_000)} days ago
                          {r.dueAt ? ` · review due ${new Date(r.dueAt).toLocaleDateString()}` : ''}
                        </div>
                        {issues.map((issue, i) => (
                          <div key={i} className="dim small" style={{ marginTop: 4 }}>
                            Still tripping on: {issue.text}
                          </div>
                        ))}
                        {r.evidence.length > 0 && (
                          <details style={{ marginTop: 6 }}>
                            <summary className="dim small" style={{ cursor: 'pointer' }}>
                              Why it says that
                            </summary>
                            <div style={{ marginTop: 6 }}>
                              {r.evidence
                                .slice()
                                .reverse()
                                .map((e, i) => (
                                  <div key={i} className="dim small">
                                    {new Date(e.at).toLocaleDateString()} — {e.note}
                                  </div>
                                ))}
                            </div>
                          </details>
                        )}
                      </div>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div className="bar" style={{ width: 80 }}>
                          <span
                            style={{
                              width: `${Math.round(m * 100)}%`,
                              background: SUBJECT_ACCENTS[s],
                            }}
                          />
                        </div>
                        <button
                          className="btn-quiet small"
                          onClick={async () => {
                            await learnerStore.reset(r.concept);
                            refresh();
                          }}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <hr />

        <h2>Your data</h2>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const data = await exportAll();
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'chalk-learner-record.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export everything
          </button>

          {confirmErase ? (
            <>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await eraseEverything();
                  learnerStore.invalidate();
                  setConfirmErase(false);
                  setMessage('Everything has been erased.');
                  refresh();
                }}
              >
                Yes, erase everything
              </button>
              <button className="btn-quiet" onClick={() => setConfirmErase(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirmErase(true)}>
              Erase everything
            </button>
          )}
        </div>
        <p className="dim small" style={{ marginTop: 12 }}>
          Export gives you the whole record as JSON — lessons, concepts, notes. Erase removes all
          of it from this browser immediately, in one action.
        </p>
      </div>
    </div>
  );
}
