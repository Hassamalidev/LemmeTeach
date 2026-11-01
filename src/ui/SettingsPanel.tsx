/**
 * Settings.
 *
 * A subscriber never picks a provider or types a model id (§5): the only
 * teaching choice is which tutor tier to use, and it says plainly what that
 * costs. The rest is the board, the lesson budget, and the plan itself.
 */
import { useState } from 'react';
import { formatUsd, type Plan } from '../../shared/plans';
import { DEEP_COST_MULTIPLE, type Credit, type Quality } from '../providers/managed';
import { billingPortalUrl, NO_PORTAL } from '../billing/links';
import { storedCode } from '../billing/license';
import type { BoardTheme, Settings } from '../storage/settings';

export function SettingsPanel({
  settings,
  plan,
  credit,
  onUpdate,
  onClose,
  onSeePlans,
  onSignOut,
}: {
  settings: Settings;
  /** Null in the demo. */
  plan: Plan | null;
  credit: Credit | null;
  onUpdate: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onSeePlans: () => void;
  onSignOut: () => void;
}): JSX.Element {
  const [showDataNote, setShowDataNote] = useState(false);

  return (
    <div className="ask-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="ask-panel" style={{ maxWidth: 560 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ marginBottom: 0 }}>Settings</h2>
          <button className="btn-quiet" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        {plan ? (
          <div className="notice">
            <strong>{plan.name} plan</strong>
            <span className="dim">
              {' '}
              · {formatUsd(plan.priceUsd)} a month · about {plan.lessons} questions
            </span>
            {credit && (
              <div className="dim small" style={{ marginTop: 4 }}>
                ${Math.min(credit.remainingUsd, plan.creditUsd).toFixed(2)} of this month’s $
                {plan.creditUsd.toFixed(2)} credit is left.
              </div>
            )}
            {storedCode() && (
              <div className="dim small" style={{ marginTop: 6 }}>
                Access code, for your other devices: <span className="mono">{storedCode()}</span>
              </div>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              {billingPortalUrl() ? (
                <a
                  className="btn"
                  href={billingPortalUrl() ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Manage subscription
                </a>
              ) : (
                <span className="dim small">{NO_PORTAL}</span>
              )}
            </div>
          </div>
        ) : settings.ownKey ? (
          <div className="notice">
            <strong>Using your own {settings.ownKey.label} key.</strong>
            <div className="dim small" style={{ marginTop: 4 }}>
              You pay {settings.ownKey.label} directly. Questions are solved on{' '}
              <span className="mono">{settings.ownKey.models.tutor}</span>.
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-danger" onClick={onSignOut}>
                Remove my key from this device
              </button>
            </div>
          </div>
        ) : (
          <div className="notice">
            <strong>You are using the demo.</strong>{' '}
            <span className="dim">A plan solves your own questions, in any subject.</span>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={onSeePlans}>
                See plans
              </button>
            </div>
          </div>
        )}

        {plan && (
          <label className="field">
            <span>Tutor</span>
            <select
              value={settings.quality}
              onChange={(e) => onUpdate({ quality: e.target.value as Quality })}
            >
              <option value="standard">Standard — right for most questions</option>
              <option value="deep">Deeper — for hard derivations and proofs</option>
            </select>
            <span className="hint">
              The deeper tutor uses your questions about {DEEP_COST_MULTIPLE} times as fast.
            </span>
          </label>
        )}

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

        {plan && (
          <label className="field">
            <span>Longest solution</span>
            <select
              value={String(settings.budget.inputTokens)}
              onChange={(e) => {
                const inputTokens = Number(e.target.value);
                onUpdate({ budget: { inputTokens, outputTokens: inputTokens * 0.15 } });
              }}
            >
              <option value="100000">Short — about six minutes</option>
              <option value="200000">Normal — about twelve minutes</option>
              <option value="400000">Long — about twenty-five minutes</option>
              {![100_000, 200_000, 400_000].includes(settings.budget.inputTokens) && (
                <option value={String(settings.budget.inputTokens)}>Custom</option>
              )}
            </select>
            <span className="hint">
              Near the limit the tutor starts wrapping up, so a solution closes properly rather
              than stopping mid-sentence. Longer solutions use more of your month.
            </span>
          </label>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.sandboxEnabled}
            onChange={(e) => onUpdate({ sandboxEnabled: e.target.checked })}
          />
          <span>
            Let solutions run code
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
            Let solutions look things up on Wikipedia
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
          {plan && (
            <button className="btn btn-danger" onClick={onSignOut}>
              Sign out of this device
            </button>
          )}
          <button className="btn-quiet" onClick={() => setShowDataNote((s) => !s)}>
            Where does my data go?
          </button>
        </div>

        {showDataNote && (
          <div className="notice" style={{ marginTop: 14 }}>
            <p className="small">
              Your solved questions and notes are stored in this browser. Questions and uploads
              go from this tab straight to the AI service that runs the model, over HTTPS; they do
              not pass through LemmeTeach’s servers. A solution you choose to share is stored until
              you stop sharing it, without your uploads. We count how often things happen, with no
              names and nothing you typed.
            </p>
            <p className="small">
              If you use your own API key, it is stored in this browser and sent only to the
              provider that issued it. It never reaches LemmeTeach’s servers.
            </p>
            <p className="small" style={{ marginBottom: 0 }}>
              Your access code is stored in this browser and sent only to LemmeTeach, to connect
              your plan. Signing out removes it from this device and leaves your subscription
              untouched.
            </p>
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
