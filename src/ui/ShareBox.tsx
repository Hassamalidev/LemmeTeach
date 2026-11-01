/**
 * Share this solution (§30).
 *
 * Nothing leaves the device until the button is pressed, and the screen says
 * what pressing it means. The link can be taken down again from here.
 */
import { useState } from 'react';
import type { SolutionRecord } from '../storage/records';
import { createShare, existingShare, stopSharing } from '../growth/share';
import { track } from '../growth/track';

export function ShareBox({ record }: { record: SolutionRecord }): JSX.Element {
  const [url, setUrl] = useState<string | null>(() => existingShare(record.id));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const share = (): void => {
    setBusy(true);
    setProblem(null);
    void createShare(record).then((result) => {
      setBusy(false);
      if (result.ok) {
        setUrl(result.url);
        track('share_created');
      } else {
        setProblem(result.message);
      }
    });
  };

  const stop = (): void => {
    setBusy(true);
    setProblem(null);
    void stopSharing(record.id).then((done) => {
      setBusy(false);
      if (done) setUrl(null);
      else setProblem('That did not work just now. Try again in a minute.');
    });
  };

  return (
    <section className="notice" style={{ marginBottom: 24 }}>
      <strong>Share this solution</strong>
      {url ? (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <input
              type="text"
              readOnly
              value={url}
              aria-label="Link to this solution"
              className="mono"
              style={{ flex: '1 1 260px' }}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button className="btn-quiet" onClick={stop} disabled={busy}>
              Stop sharing
            </button>
          </div>
          <p className="dim small" style={{ marginTop: 8, marginBottom: 0 }}>
            Anyone with this link can watch the solution, for six months.
          </p>
        </>
      ) : (
        <>
          <p className="dim small" style={{ marginTop: 4 }}>
            Makes a link that plays this solution on the board for anyone who opens it. Your
            question and the solution are stored on our server until you stop sharing, or for six
            months. Uploaded files are not included.
          </p>
          <button className="btn" onClick={share} disabled={busy}>
            {busy ? 'Making a link…' : 'Make a link'}
          </button>
        </>
      )}
      {problem && (
        <p className="small" role="alert" style={{ marginTop: 8, marginBottom: 0 }}>
          {problem}
        </p>
      )}
    </section>
  );
}
