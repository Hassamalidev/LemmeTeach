/**
 * Activate (§15.2).
 *
 * One field. The learner pastes the license key from their receipt, and the
 * next thing they see is the subject picker. Where the key is kept and where
 * it goes is said once, on the screen where it is entered.
 */
import { useState } from 'react';
import { activate } from '../billing/license';
import type { Plan } from '../../shared/plans';

export function Activate({
  onDone,
  onBack,
  onOwnKey,
}: {
  onOwnKey: () => void;
  onDone: (plan: Plan) => void;
  onBack: () => void;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = key.trim().length >= 8 && !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    void activate(key).then((result) => {
      setBusy(false);
      if (result.ok) onDone(result.plan);
      else setProblem(result.message);
    });
  };

  return (
    <div className="screen">
      <div className="centered">
        <button className="btn-quiet" onClick={onBack} style={{ marginBottom: 16 }}>
          ← Back
        </button>

        <h1>Activate your plan</h1>
        <p className="lede">
          Paste the license key from your receipt email. You only do this once on each device.
        </p>

        <label className="field">
          <span>License key</span>
          <input
            type="text"
            value={key}
            autoFocus
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            autoComplete="off"
            spellCheck={false}
            className="mono"
          />
          <span className="hint">
            The key is stored in this browser and sent only to LemmeTeach, to set up your lessons.
          </span>
        </label>

        {problem && (
          <div className="notice notice-error" role="alert">
            {problem}
          </div>
        )}

        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" onClick={submit} disabled={!ready}>
            Activate
          </button>
          <button className="btn-quiet" onClick={onOwnKey}>
            Use my own API key instead
          </button>
          {busy && (
            <span className="dim small" role="status">
              Checking your license and setting up your lessons…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
