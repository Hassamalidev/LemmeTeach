/**
 * Use your own API key (§15).
 *
 * One field. Which service the key belongs to is worked out from the key
 * itself, so usually there is nothing else to do. Some services' keys look
 * alike, and a few have no recognisable shape at all, so there is a list to
 * say which one it is — used only when the guess is wrong.
 *
 * Where the key is kept, where it goes, and who gets paid are said here, once,
 * on the screen where it is entered.
 */
import { useState } from 'react';
import {
  connectOwnKey,
  OWN_KEY_PROVIDERS,
  OWN_KEY_SERVICES,
  type OwnKey as OwnKeyChoice,
} from '../providers/own-key';

export function OwnKey({
  onDone,
  onBack,
}: {
  onDone: (key: string, ownKey: OwnKeyChoice) => void;
  onBack: () => void;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [service, setService] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = key.trim().length >= 12 && !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    void connectOwnKey(key, service || undefined).then((result) => {
      setBusy(false);
      if (result.ok) onDone(key.trim(), result.ownKey);
      else setProblem(result.message);
    });
  };

  return (
    <div className="screen">
      <div className="centered">
        <button className="btn-quiet" onClick={onBack} style={{ marginBottom: 16 }}>
          ← Back
        </button>

        <h1>Use your own API key</h1>
        <p className="lede">
          If you already have a key from {OWN_KEY_PROVIDERS}, paste it and start. No
          subscription. You pay that service for what you use, and LemmeTeach charges you
          nothing.
        </p>

        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={key}
            autoFocus
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="Paste your key"
            autoComplete="off"
            spellCheck={false}
            className="mono"
          />
          <span className="hint">
            The key is stored in this browser and sent only to the service it belongs to. It never
            reaches LemmeTeach’s servers.
          </span>
        </label>

        <label className="field" style={{ maxWidth: 360 }}>
          <span>Which service is it from?</span>
          <select value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Work it out from the key</option>
            {OWN_KEY_SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="hint">
            Leave this alone unless the key is not recognised. Some services’ keys look the same,
            and the key is only ever sent to the one service named here.
          </span>
        </label>

        {problem && (
          <div className="notice notice-error" role="alert">
            {problem}
          </div>
        )}

        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" onClick={submit} disabled={!ready}>
            Connect my key
          </button>
          {busy && (
            <span className="dim small" role="status">
              Checking the key with its service…
            </span>
          )}
        </div>

        <p className="dim small" style={{ marginTop: 24, maxWidth: '62ch' }}>
          A model is chosen for you: a small, capable one that your key can use. Your service’s
          own dashboard shows exactly what you have spent.
        </p>
      </div>
    </div>
  );
}
