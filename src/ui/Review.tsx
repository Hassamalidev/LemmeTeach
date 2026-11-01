/**
 * Review (§15).
 *
 * No model calls here: the summary of what was solved, the worked solution to
 * copy or download, and the way back to the question box.
 */
import { useState } from 'react';
import type { Session } from '../orchestrator/session';
import type { SubjectId } from '../core/types';
import { SUBJECT_ACCENTS } from '../core/types';
import { ShareBox } from './ShareBox';

export function Review({
  session,
  subject,
  onHome,
  onAgain,
  canShare,
  againLabel,
}: {
  /** A solution of their own that finished. Not a demo, and not someone else's link. */
  canShare: boolean;
  againLabel: string;
  session: Session;
  subject: SubjectId;
  onHome: () => void;
  onAgain: () => void;
}): JSX.Element {
  const state = session.state;
  const [copied, setCopied] = useState(false);

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
              Everything written before that point was saved.
            </div>
          </div>
        )}

        {canShare && state.ending && <ShareBox record={session.solution()} />}

        {state.notes.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>The worked solution</h2>
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
                <button className="btn" onClick={() => download(markdown, state.plan?.title ?? 'solution')}>
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
          <button className="btn btn-primary" onClick={onAgain}>
            {againLabel}
          </button>
          <button className="btn" onClick={onHome}>
            Done
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
