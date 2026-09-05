/**
 * Setup (§15.1).
 *
 * The first thing anyone sees. One job: get them to a lesson, having read
 * nothing. The key explanation is one line, said plainly and once — where it
 * is stored and where it goes.
 */
import { useEffect, useState } from 'react';
import { adapterFor, PROVIDER_ORDER } from '../providers';
import { isInsecureRemote } from '../providers/openrouter';
import { typicalLessonCost } from '../providers/pricing';
import type { ProviderId } from '../core/types';
import { getKey, setKey, type Settings } from '../storage/settings';
import type { ModelInfo } from '../providers/types';

export function Setup({
  settings,
  onUpdate,
  onDone,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onDone: () => void;
}): JSX.Element {
  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const [key, setKeyValue] = useState(() => getKey(settings.provider));
  const [remember, setRemember] = useState(settings.rememberKey);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const adapter = adapterFor(provider);
  const model = settings.model[provider] || adapter.defaultModel;

  useEffect(() => {
    setKeyValue(getKey(provider));
  }, [provider]);

  useEffect(() => {
    let live = true;
    setLoadingModels(true);
    adapter
      .models({ apiKey: key, baseUrl: settings.compatibleBaseUrl })
      .then((list) => {
        if (live) setModels(list);
      })
      .finally(() => {
        if (live) setLoadingModels(false);
      });
    return () => {
      live = false;
    };
  }, [adapter, key, settings.compatibleBaseUrl]);

  const ready = adapter.demo || adapter.keyOptional || key.trim().length > 0;
  const cost = typicalLessonCost(provider, model);
  // Which provider this is stays inside the adapter layer (§25): the screen
  // only asks whether a key is needed and what the adapter wants said.
  const needsKey = !adapter.demo;
  const demoAdapter = PROVIDER_ORDER.map(adapterFor).find((a) => a.demo);

  const submit = (): void => {
    setKey(provider, key.trim(), remember);
    onUpdate({ provider, rememberKey: remember });
    onDone();
  };

  return (
    <div className="screen">
      <div className="centered">
        <h1>Chalk</h1>
        <p className="lede">
          An AI tutor that plans a lesson, teaches it on a whiteboard while it talks, runs code to
          work things out, and asks you questions it actually waits for. Everything runs in this
          browser tab.
        </p>

        <label className="field">
          <span>Where should it get its model from?</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            {PROVIDER_ORDER.map((id) => (
              <option key={id} value={id}>
                {adapterFor(id).label}
              </option>
            ))}
          </select>
          <span className="hint">{adapter.keyHint}</span>
        </label>

        {adapter.needsBaseUrl && (
          <label className="field">
            <span>Base URL</span>
            <input
              type="text"
              value={settings.compatibleBaseUrl}
              onChange={(e) => onUpdate({ compatibleBaseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
            />
            {isInsecureRemote(settings.compatibleBaseUrl) && (
              <span className="hint" style={{ color: '#d9a441' }}>
                That address is plain http and not on this machine, so your key and the lesson
                would travel unencrypted. Use https unless the server is on your own network and
                you know what is on it.
              </span>
            )}
          </label>
        )}

        {needsKey && (
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              value={key}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder={adapter.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready) submit();
              }}
            />
            <span className="hint">
              The key is yours. It is stored in this browser and sent only to{' '}
              {adapter.label} — it reaches no other host, and Chalk has no server to send it to.{' '}
              {adapter.keyHelpUrl && (
                <a href={adapter.keyHelpUrl} target="_blank" rel="noopener noreferrer">
                  Where to get one
                </a>
              )}
            </span>
          </label>
        )}

        {needsKey && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!remember}
              onChange={(e) => setRemember(!e.target.checked)}
            />
            <span>
              Don’t remember on this device
              <br />
              <span className="dim small">
                The key stays in memory only and is gone when you close the tab.
              </span>
            </span>
          </label>
        )}

        <label className="field">
          <span>Model</span>
          <select
            value={model}
            onChange={(e) =>
              onUpdate({ model: { ...settings.model, [provider]: e.target.value } })
            }
          >
            {models.length === 0 && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="hint">
            {loadingModels
              ? 'Fetching the model list…'
              : (adapter.modelNote?.(models.length) ??
                (cost
                  ? `A typical twelve-minute lesson costs ${cost} on this model. That is an estimate, not a quote.`
                  : 'Cost for this model is unknown, so no estimate is shown.'))}
          </span>
        </label>

        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" onClick={submit} disabled={!ready}>
            {adapter.demo ? 'Try it' : 'Start'}
          </button>
          {needsKey && (
            <button
              className="btn"
              onClick={() => {
                if (!demoAdapter) return;
                onUpdate({ provider: demoAdapter.id });
                setProvider(demoAdapter.id);
              }}
            >
              Try it without a key
            </button>
          )}
        </div>

        {adapter.demoNote && (
          <p className="dim small" style={{ marginTop: 20 }}>
            {adapter.demoNote}
          </p>
        )}
      </div>
    </div>
  );
}
