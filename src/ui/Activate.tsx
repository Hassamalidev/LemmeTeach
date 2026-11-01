/**
 * Activate (§15.2).
 *
 * Two ways in. Straight after paying, the access code arrives from Paddle and
 * this screen sets the plan up by itself, then shows the code once so the
 * learner can keep it. On another device, they paste the code here.
 */
import { useEffect, useRef, useState } from 'react';
import { activate, looksLikeCode } from '../billing/license';
import type { Plan } from '../../shared/plans';

export function Activate({
  paidCode,
  onDone,
  onBack,
  onOwnKey,
}: {
  /** The access code from a checkout that has just been paid, if there was one. */
  paidCode: string | null;
  onOwnKey: () => void;
  onDone: (plan: Plan) => void;
  onBack: () => void;
}): JSX.Element {
  const [code, setCode] = useState(paidCode ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Set once a code from checkout has worked: shown so it can be kept. */
  const [ready, setReady] = useState<Plan | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const run = (value: string, fromCheckout: boolean): void => {
    setBusy(true);
    setProblem(null);
    // Straight after checkout Paddle can take a few seconds to finish; wait
    // for it rather than reporting a problem that is about to go away.
    void activate(value, fromCheckout ? 45_000 : 0).then((result) => {
      setBusy(false);
      if (!result.ok) setProblem(result.message);
      else if (fromCheckout) setReady(result.plan);
      else onDone(result.plan);
    });
  };

  useEffect(() => {
    if (paidCode && !started.current) {
      started.current = true;
      run(paidCode, true);
    }
    // Runs once, for the code checkout handed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidCode]);

  const copy = (): void => {
    void navigator.clipboard?.writeText(code.trim()).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  if (ready) {
    return (
      <div className="screen">
        <div className="centered">
          <h1>Your {ready.name} plan is ready</h1>
          <p className="lede">
            About {ready.lessons} questions a month, starting now. This is your access code:
          </p>
          <div className="code-box">
            <span className="mono">{code.trim()}</span>
            <button className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="dim small">
            Keep it somewhere safe. You need it to use your plan on another device or browser.
            It is already saved in this one.
          </p>
          <div className="row" style={{ marginTop: 24 }}>
            <button className="btn btn-primary btn-lg" onClick={() => onDone(ready)}>
              Start solving
            </button>
          </div>
        </div>
      </div>
    );
  }

  const submit = (): void => {
    if (busy || !looksLikeCode(code)) return;
    run(code, false);
  };

  return (
    <div className="screen">
      <div className="centered">
        <button className="btn-quiet" onClick={onBack} style={{ marginBottom: 16 }}>
          ← Back
        </button>

        {paidCode && busy ? (
          <>
            <h1>Setting up your plan</h1>
            <p className="lede" role="status">
              Your payment went through. Setting up your questions, which takes a few seconds.
            </p>
          </>
        ) : (
          <>
            <h1>Use your plan on this device</h1>
            <p className="lede">
              Paste the access code you were shown after paying. It starts with{' '}
              <span className="mono">txn_</span>. You only do this once on each device.
            </p>

            <label className="field">
              <span>Access code</span>
              <input
                type="text"
                value={code}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder="txn_01h…"
                autoComplete="off"
                spellCheck={false}
                className="mono"
              />
              <span className="hint">
                The code is stored in this browser and sent only to LemmeTeach, to set up your
                questions. Using it here signs out any other device using it.
              </span>
            </label>
          </>
        )}

        {problem && (
          <div className="notice notice-error" role="alert">
            {problem}
          </div>
        )}

        {!(paidCode && busy) && (
          <div className="row" style={{ marginTop: 24 }}>
            <button className="btn btn-primary" onClick={submit} disabled={busy || !looksLikeCode(code)}>
              Activate
            </button>
            <button className="btn-quiet" onClick={onOwnKey}>
              Use my own API key instead
            </button>
            {busy && (
              <span className="dim small" role="status">
                Checking your code and setting up your questions…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
