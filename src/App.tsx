/**
 * The app shell (§15).
 *
 * A handful of screens held in React state. No router — that is what keeps the
 * build working at any path, and it costs nothing at this size. The only thing
 * read from the URL is the `?activate` flag that the post-purchase redirect
 * carries.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Plan } from '../shared/plans';
import { adapterFor, configFor } from './providers';
import {
  DEMO_PROVIDER_ID,
  MANAGED_PROVIDER_ID,
  fetchCredit,
  managedModels,
  type Credit,
} from './providers/managed';
import { setMockLesson } from './providers/mock';
import { adapterConfigFor, type OwnKey as OwnKeyChoice } from './providers/own-key';
import { fixtureFor } from './fixtures';
import { replayAdapter, savedFigureIds } from './providers/replay';
import type { SolutionRecord } from './storage/records';
import { currentPlan, modelKey, reactivate, signOut } from './billing/license';
import { billingPortalUrl } from './billing/links';
import { getKey, loadSettings, saveSettings, setKey, type Settings } from './storage/settings';
import { setStorageNotifier } from './storage/db';
import { DisabledSandbox, SandboxHost } from './sandbox/host';
import { Session } from './orchestrator/session';
import { Landing } from './ui/Landing';
import { Activate } from './ui/Activate';
import { OwnKey } from './ui/OwnKey';
import { Solve, type SolveRequest } from './ui/Solve';
import { LessonScreen } from './ui/LessonScreen';
import { Review } from './ui/Review';
import { SettingsPanel } from './ui/SettingsPanel';
import { Toasts, useToasts } from './ui/Toasts';

type Screen = 'landing' | 'activate' | 'own-key' | 'solve' | 'lesson' | 'review';

/** A stored own key only counts if the key itself is still in the vault. */
function storedOwnKey(settings: Settings): OwnKeyChoice | null {
  const own = settings.ownKey;
  return own && getKey(own.providerId) ? own : null;
}

export function App(): JSX.Element {
  const [plan, setPlan] = useState<Plan | null>(() => currentPlan());
  const [settings, setSettings] = useState<Settings>(() => ({
    ...loadSettings(),
    // A subscriber's questions run on their plan; everyone else gets the demo.
    provider: currentPlan() ? MANAGED_PROVIDER_ID : DEMO_PROVIDER_ID,
  }));
  const [screen, setScreen] = useState<Screen>(() =>
    currentPlan() || storedOwnKey(loadSettings())
      ? 'solve'
      : cameFromCheckout()
        ? 'activate'
        : 'landing',
  );
  const [toPricing, setToPricing] = useState(false);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toasts = useToasts();

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    // Eviction and storage failures reach the learner rather than happening
    // silently (§20).
    setStorageNotifier(toasts.push);
  }, [toasts.push]);

  useEffect(() => {
    document.documentElement.dataset.motion =
      settings.reducedMotion === 'always' ? 'reduced' : '';
  }, [settings.reducedMotion]);

  // What is left on the plan, re-read whenever the learner is back at the
  // question box — which is after every solution (§18).
  useEffect(() => {
    if (!plan || screen !== 'solve') return;
    const controller = new AbortController();
    void fetchCredit(modelKey(), controller.signal).then((c) => {
      if (!controller.signal.aborted) setCredit(c);
    });
    return () => controller.abort();
  }, [plan, screen]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const sandbox = useMemo(
    () =>
      settings.sandboxEnabled
        ? new SandboxHost(settings.pyodideBaseUrl)
        : new DisabledSandbox(),
    [settings.sandboxEnabled, settings.pyodideBaseUrl],
  );

  useEffect(() => {
    return () => {
      if (sandbox instanceof SandboxHost) sandbox.dispose();
    };
  }, [sandbox]);

  const solve = useCallback(
    (request: SolveRequest) => {
      // A plan first, then the learner's own key, and the demo for anyone
      // with neither — whatever the settings blob says.
      const own = plan ? null : storedOwnKey(settings);
      const providerId = plan ? MANAGED_PROVIDER_ID : own ? own.providerId : DEMO_PROVIDER_ID;
      const provider = adapterFor(providerId);

      // The demo replays a prepared walkthrough, chosen by the example picked.
      const walkthrough = provider.demo ? fixtureFor(request.demoSubject ?? 'physics') : undefined;
      if (walkthrough) setMockLesson(walkthrough.meta.subject);

      const demoModel = provider.defaultModel;
      const models = provider.demo
        ? { planner: demoModel, tutor: demoModel, repairer: demoModel }
        : own
          ? own.models
          : managedModels(settings.quality);

      const next = new Session({
        pacing: true,
        // Placeholders: the reader settles both from the question. The demo
        // knows its subject up front.
        subject: walkthrough?.meta.subject ?? 'general',
        level: walkthrough?.meta.level ?? 'school',
        topic: request.question,
        attachments: request.attachments,
        provider,
        adapterConfig: own
          ? adapterConfigFor(own, getKey(providerId))
          : configFor(providerId, getKey(providerId)),
        settings: { ...settings, provider: providerId },
        sandbox,
        models,
        // Compaction starts at 60% of this, so at about 8,000 tokens of
        // conversation. Far below any model's real window, on purpose: the
        // whole conversation is re-sent on every turn, and on a service with
        // no prompt cache that is paid in full each time. Older steps are
        // replaced by a short summary of what is already on the board.
        contextWindow: 14_000,
      });

      if (sandbox instanceof SandboxHost) {
        sandbox.setSeed(hashSeed(request.question));
        sandbox.setProgressHandler(toasts.push);
      }

      setReplaying(false);
      setSession(next);
      setScreen('lesson');
      void next.start();
    },
    [plan, settings, sandbox, toasts.push],
  );

  /**
   * Play back a question that has already been solved. Nothing is sent to a
   * model and no credit is used: the saved board and narration go through the
   * same session, voice and pacing as the first time (§18).
   */
  const [replaying, setReplaying] = useState(false);
  const replay = useCallback(
    (record: SolutionRecord) => {
      const next = new Session({
        pacing: true,
        ephemeral: true,
        subject: record.subject,
        level: record.level,
        topic: record.topic,
        provider: replayAdapter(record),
        adapterConfig: { apiKey: '' },
        settings,
        sandbox: new DisabledSandbox(),
        knownFigures: savedFigureIds(record),
        models: { planner: 'replay', tutor: 'replay', repairer: 'replay' },
        contextWindow: 1_000_000,
      });
      setReplaying(true);
      setSession(next);
      setScreen('lesson');
      void next.start();
    },
    [settings],
  );

  const backToQuestion = useCallback(() => {
    session?.abort();
    setSession(null);
    setScreen('solve');
  }, [session]);

  /**
   * A subscriber changes plan in the billing portal — a second checkout would
   * be a second subscription. Everyone else goes to the pricing table.
   */
  const seePlans = useCallback(() => {
    if (plan) {
      window.open(billingPortalUrl(), '_blank', 'noopener,noreferrer');
      return;
    }
    session?.abort();
    setSession(null);
    setToPricing(true);
    setScreen('landing');
  }, [plan, session]);

  const reconnect = useCallback(async (): Promise<string> => {
    const result = await reactivate();
    if (!result.ok) return result.message;
    setPlan(result.plan);
    return 'Reconnected. Go back and ask your question again.';
  }, []);

  return (
    <div className="app">
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />

      {screen === 'landing' && (
        <Landing
          theme={settings.theme}
          startAtPricing={toPricing}
          onDemo={() => {
            update({ provider: DEMO_PROVIDER_ID });
            setScreen('solve');
          }}
          onActivate={() => setScreen('activate')}
          onOwnKey={() => setScreen('own-key')}
        />
      )}

      {screen === 'own-key' && (
        <OwnKey
          onBack={() => setScreen(plan ? 'solve' : 'landing')}
          onDone={(key, own) => {
            setKey(own.providerId, key, true);
            update({ ownKey: own, provider: own.providerId });
            setScreen('solve');
            toasts.push(`Your ${own.label} key is connected. Ask it anything.`);
          }}
        />
      )}

      {screen === 'activate' && (
        <Activate
          onBack={() => {
            setToPricing(false);
            setScreen('landing');
          }}
          onOwnKey={() => setScreen('own-key')}
          onDone={(activated) => {
            clearCheckoutFlag();
            setPlan(activated);
            update({ provider: MANAGED_PROVIDER_ID });
            setScreen('solve');
            toasts.push(
              `Your ${activated.name} plan is active: about ${activated.lessons} questions a month.`,
            );
          }}
        />
      )}

      {screen === 'solve' && (
        <Solve
          settings={settings}
          plan={plan}
          credit={credit}
          onUpdateSettings={update}
          onSolve={solve}
          onReplay={replay}
          onSeePlans={seePlans}
          onOwnKey={() => setScreen('own-key')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {screen === 'lesson' && session && (
        <LessonScreen
          session={session}
          settings={settings}
          onUpdateSettings={update}
          onFinished={() => setScreen('review')}
          onExit={backToQuestion}
          access={replaying ? 'replay' : plan ? 'plan' : storedOwnKey(settings) ? 'own-key' : 'demo'}
          onReconnect={reconnect}
          onSeePlans={seePlans}
        />
      )}

      {screen === 'review' && session && (
        <Review
          session={session}
          subject={session.subject}
          onHome={() => {
            setSession(null);
            setScreen('solve');
          }}
          onAgain={() => {
            setSession(null);
            setScreen('solve');
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          plan={plan}
          credit={credit}
          onUpdate={update}
          onClose={() => setSettingsOpen(false)}
          onSeePlans={() => {
            setSettingsOpen(false);
            seePlans();
          }}
          onSignOut={() => {
            signOut();
            setPlan(null);
            setCredit(null);
            update({ provider: DEMO_PROVIDER_ID, ownKey: null });
            setSettingsOpen(false);
            setToPricing(false);
            setScreen('landing');
          }}
        />
      )}
    </div>
  );
}

/** True when the post-purchase redirect brought the learner here (§24). */
function cameFromCheckout(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('activate');
  } catch {
    return false;
  }
}

/** Drop the flag once it has done its job, so a reload does not repeat it. */
function clearCheckoutFlag(): void {
  try {
    if (cameFromCheckout()) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  } catch {
    /* A sandboxed frame may refuse; the flag is harmless if it stays. */
  }
}

/** A stable seed per question, so a repeated one draws the same figures. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
