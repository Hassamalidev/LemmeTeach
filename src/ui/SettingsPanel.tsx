/**
 * Settings.
 *
 * Includes the plain answer to the question a careful person will ask about
 * the Anthropic browser header, because "dangerous" in that header's name
 * deserves an explanation rather than a shrug.
 */
import { useState } from 'react';
import { adapterFor, PROVIDER_ORDER } from '../providers';
import type { ProviderId } from '../core/types';
import { forgetAllKeys, type BoardTheme, type Settings } from '../storage/settings';

export function SettingsPanel({
  settings,
  onUpdate,
  onClose,
  onForgetKey,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onForgetKey: () => void;
}): JSX.Element {
  const [showKeyNote, setShowKeyNote] = useState(false);
  const adapter = adapterFor(settings.provider);

  return (
    <div className="ask-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="ask-panel" style={{ maxWidth: 560 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ marginBottom: 0 }}>Settings</h2>
          <button className="btn-quiet" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <label className="field">
          <span>Provider</span>
          <select
            value={settings.provider}
            onChange={(e) => onUpdate({ provider: e.target.value as ProviderId })}
          >
            {PROVIDER_ORDER.map((id) => (
              <option key={id} value={id}>
                {adapterFor(id).label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Model</span>
          <input
            type="text"
            value={settings.model[settings.provider] ?? adapter.defaultModel}
            onChange={(e) =>
              onUpdate({ model: { ...settings.model, [settings.provider]: e.target.value } })
            }
          />
          <span className="hint">
            Planning and the closing check use a fast model, teaching uses the strong one, and
            repairs use the cheapest. Override any of them below.
          </span>
        </label>

        <details style={{ marginBottom: 18 }}>
          <summary className="dim small" style={{ cursor: 'pointer' }}>
            Per-role models
          </summary>
          <div style={{ marginTop: 10 }}>
            {(['planner', 'tutor', 'examiner', 'repairer'] as const).map((role) => (
              <label key={role} className="field" style={{ marginBottom: 10 }}>
                <span style={{ textTransform: 'capitalize' }}>{role}</span>
                <input
                  type="text"
                  value={settings.roleModels[role] ?? ''}
                  placeholder="same as above"
                  onChange={(e) =>
                    onUpdate({
                      roleModels: { ...settings.roleModels, [role]: e.target.value || undefined },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>

        <label className="field">
          <span>Board</span>
          <select
            value={settings.theme}
            onChange={(e) => onUpdate({ theme: e.target.value as BoardTheme })}
          >
            <option value="slate">Slate — a dark green board</option>
            <option value="paper">Paper — warm white with a faint rule</option>
          </select>
        </label>

        <label className="field">
          <span>Token budget per lesson</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              type="number"
              min={10_000}
              step={10_000}
              value={settings.budget.inputTokens}
              onChange={(e) =>
                onUpdate({
                  budget: { ...settings.budget, inputTokens: Number(e.target.value) },
                })
              }
              aria-label="Input token budget"
            />
            <input
              type="number"
              min={5_000}
              step={5_000}
              value={settings.budget.outputTokens}
              onChange={(e) =>
                onUpdate({
                  budget: { ...settings.budget, outputTokens: Number(e.target.value) },
                })
              }
              aria-label="Output token budget"
            />
          </div>
          <span className="hint">
            In and out. At 80% the tutor starts wrapping up; at 100% the lesson closes properly
            rather than stopping mid-sentence.
          </span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.sandboxEnabled}
            onChange={(e) => onUpdate({ sandboxEnabled: e.target.checked })}
          />
          <span>
            Let lessons run code
            <br />
            <span className="dim small">
              Runs in an isolated frame with no network and no access to anything else in this
              tab. Python loads from a CDN the first time it is used.
            </span>
          </span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.wikiEnabled}
            onChange={(e) => onUpdate({ wikiEnabled: e.target.checked })}
          />
          <span>
            Let lessons look things up on Wikipedia
            <br />
            <span className="dim small">
              Off by default. Turn it on if you would rather the tutor checked a date or a
              constant than relied on memory.
            </span>
          </span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.reducedMotion === 'always'}
            onChange={(e) => onUpdate({ reducedMotion: e.target.checked ? 'always' : 'system' })}
          />
          <span>
            Write everything instantly
            <br />
            <span className="dim small">
              Skips the drawing animation. Narration and pacing are unchanged.
            </span>
          </span>
        </label>

        <hr />

        <div className="row">
          <button
            className="btn btn-danger"
            onClick={() => {
              forgetAllKeys();
              onForgetKey();
            }}
          >
            Forget key
          </button>
          <button className="btn-quiet" onClick={() => setShowKeyNote((s) => !s)}>
            Where does my key go?
          </button>
        </div>

        {showKeyNote && (
          <div className="notice" style={{ marginTop: 14 }}>
            <p className="small">
              Your key is stored in this browser and sent directly to {adapter.label}, over HTTPS,
              from this tab. Chalk has no server, so there is nowhere else it could go. It is
              never written into a saved lesson, a trace export, or a log.
            </p>
            {adapter.keyNote && (
              <p className="small" style={{ marginBottom: 0 }}>
                {adapter.keyNote}
              </p>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
