/**
 * Review (§15.5).
 *
 * No model calls here — the exam result, what actually moved in the record and
 * why, the notes, and the exports. The mastery diff is the part worth getting
 * right: it is the only place a learner sees that the system's picture of them
 * changed, and why.
 */
import { useEffect, useState } from 'react';
import type { Session } from '../orchestrator/session';
import type { SubjectId } from '../core/types';
import { SUBJECT_ACCENTS } from '../core/types';
import { masteryLabel } from '../memory/concepts';

export function Review({
  session,
  subject,
  onHome,
  onAgain,
}: {
  session: Session;
  subject: SubjectId;
  onHome: () => void;
  onAgain: () => void;
}): JSX.Element {
  const state = session.state;
  const [diff, setDiff] = useState<{ concept: string; before: number; after: number }[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void session.masteryDiff().then(setDiff);
  }, [session]);

  const accent = SUBJECT_ACCENTS[subject];
  const markdown = notesMarkdown(state.plan?.title ?? session.topic, state.notes);

  return (
    <div className="screen">
      <div className="wide">
        <h1 style={{ color: accent }}>{state.plan?.title ?? session.topic}</h1>

        {state.ending && <p className="lede">{state.ending.summary}</p>}

        {state.error && state.error.kind !== 'AbortError' && (
          <div className="notice notice-error">
            <strong>{state.error.message}</strong>
            <div className="small dim" style={{ marginTop: 6 }}>
              Everything taught before that point was saved.
            </div>
          </div>
        )}

        {state.exam && (
          <section style={{ marginBottom: 32 }}>
            <h2>The check</h2>
            <p style={{ fontSize: 18 }}>{state.exam.verdict}</p>
            <div className="row" style={{ alignItems: 'flex-start', gap: 32 }}>
              {state.exam.strengths.length > 0 && (
                <div style={{ flex: 1, minWidth: 220 }}>
                  <h3>Solid</h3>
                  <ul style={{ paddingLeft: 18 }}>
                    {state.exam.strengths.map((s, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {state.exam.gaps.length > 0 && (
                <div style={{ flex: 1, minWidth: 220 }}>
                  <h3>Worth another look</h3>
                  <ul style={{ paddingLeft: 18 }}>
                    {state.exam.gaps.map((g, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {diff.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <h2>What moved</h2>
            <div>
              {diff.map((d) => {
                const delta = d.after - d.before;
                return (
                  <div key={d.concept} className="diff-row">
                    <span>{d.concept.replace(/-/g, ' ')}</span>
                    <div className="bar">
                      <span style={{ width: `${Math.round(d.after * 100)}%`, background: accent }} />
                    </div>
                    <span className={delta >= 0 ? 'delta-up' : 'delta-down'}>
                      {delta >= 0 ? '+' : ''}
                      {Math.round(delta * 100)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="dim small" style={{ marginTop: 10 }}>
              These are blended with what was already on record, not overwritten — one lesson
              moves a concept part of the way, never all of it. Now at{' '}
              {diff.map((d) => `${d.concept.replace(/-/g, ' ')} ${masteryLabel(d.after)}`).join(', ')}.
            </p>
          </section>
        )}

        {state.notes.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Your notes</h2>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(markdown).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? 'Copied' : 'Copy as Markdown'}
                </button>
                <button className="btn" onClick={() => download(markdown, state.plan?.title ?? 'lesson')}>
                  Download
                </button>
              </div>
            </div>
            {state.notes.map((n, i) => (
              <div key={i} className="note-block">
                <h3>{n.title}</h3>
                <pre>{n.markdown}</pre>
              </div>
            ))}
          </section>
        )}

        {state.ending && state.ending.nextTopics.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <h2>Where to go next</h2>
            <div className="row">
              {state.ending.nextTopics.map((t) => (
                <span key={t} className="pill">
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        <hr />

        <div className="row">
          <button className="btn btn-primary" onClick={onHome}>
            Done
          </button>
          <button className="btn" onClick={onAgain}>
            Another lesson
          </button>
          <button
            className="btn-quiet"
            onClick={() =>
              download(
                session.trace.toExport({ topic: session.topic, subject }),
                'chalk-trace',
                'json',
              )
            }
          >
            Export trace
          </button>
        </div>
      </div>
    </div>
  );
}

function notesMarkdown(
  title: string,
  notes: { title: string; markdown: string; tags?: string[] }[],
): string {
  const parts = [`# ${title}`, ''];
  for (const n of notes) {
    parts.push(`## ${n.title}`, '', n.markdown, '');
    if (n.tags?.length) parts.push(`*${n.tags.join(' · ')}*`, '');
  }
  return parts.join('\n');
}

function download(content: string, name: string, ext = 'md'): void {
  const blob = new Blob([content], {
    type: ext === 'json' ? 'application/json' : 'text/markdown',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}
