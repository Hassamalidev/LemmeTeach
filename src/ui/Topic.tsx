/**
 * Topic (§15.3).
 *
 * A starter tree plus free text, a level selector, and a peek at what the
 * record already holds for this subject. The empty state invites a topic
 * rather than describing the feature.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  LEVELS,
  LEVEL_LABELS,
  SUBJECT_ACCENTS,
  SUBJECT_LABELS,
  type Level,
  type SubjectId,
} from '../core/types';
import { packFor } from '../agents/prompts/subjects';
import { learnerStore } from '../memory/store';
import { decayedMastery, masteryLabel, openMisconceptions } from '../memory/concepts';
import type { ConceptRecord } from '../memory/types';
import type { Settings } from '../storage/settings';
import { adapterFor } from '../providers';

export function Topic({
  subject,
  settings,
  seededConcepts,
  onBack,
  onStart,
}: {
  subject: SubjectId;
  settings: Settings;
  seededConcepts: string[];
  onBack: () => void;
  onStart: (topic: string, level: Level, concepts: string[]) => void;
}): JSX.Element {
  const pack = packFor(subject);
  const [topic, setTopic] = useState(() =>
    seededConcepts.length ? `Review: ${seededConcepts.map((c) => c.replace(/-/g, ' ')).join(', ')}` : '',
  );
  const [level, setLevel] = useState<Level>('school');
  const [records, setRecords] = useState<ConceptRecord[]>([]);

  useEffect(() => {
    void learnerStore.forSubject(subject).then(setRecords);
    void learnerStore.profile().then((p) => {
      const stored = p.level[subject];
      if (stored) setLevel(stored);
    });
  }, [subject]);

  const known = useMemo(() => records.slice(0, 6), [records]);
  const accent = SUBJECT_ACCENTS[subject];
  const ready = topic.trim().length >= 2;

  const start = (): void => {
    if (!ready) return;
    void learnerStore.updateProfile({
      level: { ...(records.length ? {} : {}), [subject]: level },
    });
    onStart(topic.trim(), level, seededConcepts);
  };

  return (
    <div className="screen">
      <div className="wide">
        <button className="btn-quiet" onClick={onBack} style={{ marginBottom: 16 }}>
          ← All subjects
        </button>

        <h1 style={{ color: accent }}>{SUBJECT_LABELS[subject]}</h1>
        <p className="lede">What would you like to work through?</p>

        <label className="field">
          <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>
            Topic
          </span>
          <input
            type="text"
            value={topic}
            autoFocus
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') start();
            }}
            placeholder="Type anything — “why does ice float”, “the chain rule”, “what a hash table actually is”"
          />
        </label>

        <label className="field" style={{ maxWidth: 320 }}>
          <span>How deep?</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>

        <div className="row" style={{ marginBottom: 34 }}>
          <button className="btn btn-primary" onClick={start} disabled={!ready}>
            Teach me
          </button>
          {adapterFor(settings.provider).demo && (
            <span className="dim small">
              Replay mode plays the bundled {SUBJECT_LABELS[subject].toLowerCase()} lesson,
              whatever you type.
            </span>
          )}
        </div>

        <section style={{ marginBottom: 30 }}>
          <h2>Or pick one</h2>
          {pack.topics.map((group) => (
            <div key={group.group} style={{ marginBottom: 16 }}>
              <h3 className="dim small" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {group.group}
              </h3>
              <div className="row">
                {group.items.map((item) => (
                  <button
                    key={item}
                    className="pill"
                    style={{ cursor: 'pointer', padding: '6px 12px', color: 'inherit' }}
                    onClick={() => setTopic(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {known.length > 0 && (
          <section>
            <h2>What you already know here</h2>
            <div className="list">
              {known.map((r) => {
                const m = decayedMastery(r);
                const issues = openMisconceptions(r);
                return (
                  <div key={r.concept} className="list-item">
                    <div style={{ minWidth: 0 }}>
                      <div>{r.concept.replace(/-/g, ' ')}</div>
                      {issues[0] && <div className="dim small">Still tripping on: {issues[0].text}</div>}
                    </div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="dim small">{masteryLabel(m)}</span>
                      <div className="bar" style={{ width: 70 }}>
                        <span style={{ width: `${Math.round(m * 100)}%`, background: accent }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="dim small" style={{ marginTop: 10 }}>
              The tutor reads this before it plans, so it will not spend your evening on something
              you already hold.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
