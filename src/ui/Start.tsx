/**
 * How to get a question solved (§30).
 *
 * Solving a real question costs real money, so a visitor with no plan and no
 * key of their own lands here: a plan, their own API key, or the free demo.
 * Whatever they typed is kept and waiting in the question box afterwards.
 */
import { useEffect, useState } from 'react';
import type { PlanId } from '../../shared/plans';
import { allLessons } from '../storage/db';
import type { SolutionRecord } from '../storage/records';
import { track } from '../growth/track';
import { canReplay } from '../providers/replay';
import { OWN_KEY_PROVIDERS } from '../providers/own-key';
import { PlanCards } from './Plans';

export function Start({
  question,
  onChoose,
  onOwnKey,
  onHome,
  onActivate,
  onDemo,
  onReplay,
}: {
  /** What they asked on the home page, if anything. */
  question: string | null;
  onChoose: (plan: PlanId) => void;
  onOwnKey: () => void;
  onHome: () => void;
  onActivate: () => void;
  onDemo: () => void;
  onReplay: (record: SolutionRecord) => void;
}): JSX.Element {
  const [solved, setSolved] = useState<SolutionRecord[]>([]);

  useEffect(() => {
    track('paywall_seen');
    void allLessons().then((l) => setSolved(l.filter(canReplay).slice(0, 3)));
  }, []);

  return (
    <div className="screen">
      <div className="wide">
        <button className="btn-quiet" onClick={onHome} style={{ marginBottom: 16 }}>
          ← Home
        </button>

        <h1>Choose how to solve it</h1>
        <p className="lede">
          {question
            ? 'Your question is saved. Pick a plan or use your own API key, and it will be waiting for you.'
            : 'Pick a plan, or use your own API key.'}
        </p>

        <PlanCards onChoose={onChoose} />

        <section className="own-key-offer" style={{ marginTop: 24 }}>
          <div>
            <h3>Already have an API key?</h3>
            <p className="dim" style={{ marginBottom: 0 }}>
              Paste a key from {OWN_KEY_PROVIDERS}. You pay your provider for what you use, and we
              charge nothing.
            </p>
          </div>
          <button className="btn" onClick={onOwnKey}>
            Use my own API key
          </button>
        </section>

        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn-quiet" onClick={onDemo}>
            Try the demo
          </button>
          <button className="btn-quiet" onClick={onActivate}>
            I have an access code
          </button>
        </div>

        {solved.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <h2>Already solved</h2>
            <p className="dim small">These are yours, and replaying them is free.</p>
            <div className="list">
              {solved.map((l) => (
                <div key={l.id} className="list-item">
                  <div style={{ minWidth: 0 }}>{l.title}</div>
                  <button
                    className="btn-quiet small"
                    onClick={() => onReplay(l)}
                    aria-label={`Replay ${l.title}, free`}
                  >
                    Replay, free
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
