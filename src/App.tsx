/**
 * The app shell (§15).
 *
 * A handful of screens held in React state. No router — that is what keeps the
 * build working at any path, and it costs nothing at this size. From the URL
 * it reads only `?activate`, `?s=` for a shared solution, and Paddle's `_ptxn`.
 *
 * Who is asking decides what a question runs on: a plan first, then the
 * learner's own key. Anyone with neither is shown how to get one, and the
 * prepared demo costs nothing and is open to everyone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, PlanId } from '../shared/plans';
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
import { allLessons } from './storage/db';
import { findSolved } from './providers/replay';
import { openShared, sharedIdInUrl } from './growth/share';
import { track } from './growth/track';
import { replayAdapter, savedFigureIds } from './providers/replay';
import type { SolutionRecord } from './storage/records';
import { currentPlan, modelKey, reactivate, signOut } from './billing/license';
import { billingPortalUrl, NO_PORTAL } from './billing/links';
import { closeCheckout, openCheckout, resumeLinkedCheckout } from './billing/paddle';
import { getKey, loadSettings, saveSettings, setKey, type Settings } from './storage/settings';
import { setStorageNotifier } from './storage/db';
import { DisabledSandbox, SandboxHost } from './sandbox/host';
import { Session } from './orchestrator/session';
import { Landing } from './ui/Landing';
import { Activate } from './ui/Activate';
import { OwnKey } from './ui/OwnKey';
import { Solve, type SolveRequest } from './ui/Solve';
import { LessonScreen, type Access } from './ui/LessonScreen';
import { Start } from './ui/Start';
import { Review } from './ui/Review';
import { SettingsPanel } from './ui/SettingsPanel';
import { Toasts, useToasts } from './ui/Toasts';

type Screen = 'landing' | 'activate' | 'own-key' | 'solve' | 'lesson' | 'review' | 'start';

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
  // Everyone opens on the home page, including a subscriber or someone with
  // their own key: it has a button straight to solving. The one exception is
  // arriving from checkout, which opens on activation.
  const [screen, setScreen] = useState<Screen>(() => (cameFromCheckout() ? 'activate' : 'landing'));
  /** What the session on screen runs on, which decides what its screens offer. */
  const [access, setAccess] = useState<Access>('demo');
  /** A question started from the home page, carried to the question screen. */
  const [draft, setDraft] = useState<{ question: string; files: File[] } | null>(null);
  const counted = useRef(new Set<string>());
  const [toPricing, setToPricing] = useState(false);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toasts = useToasts();

  /** The access code from a checkout that has just been paid (§28.2). */
  const [paidCode, setPaidCode] = useState<string | null>(null);

  // Paddle hands over the access code the moment a checkout is paid. Close
  // its window and set the plan up here.
  const paid = useCallback((code: string) => {
    closeCheckout();
    setPaidCode(code);
    setScreen('activate');
  }, []);

  // A Paddle payment link brings the buyer back here to pay; Paddle.js opens
  // that checkout itself once it is loaded.
  useEffect(() => {
    resumeLinkedCheckout(paid);
  }, [paid]);

  const openDemo = useCallback(() => {
    setSettings((current) => ({ ...current, provider: DEMO_PROVIDER_ID }));
    setDraft(null);
    setScreen('solve');
  }, []);

  const choosePlan = useCallback(
    (planId: PlanId) => {
      track('checkout_opened');
      void openCheckout(planId, paid).then((opened) => {
        if (!opened) toasts.push('Checkout could not be opened. Check your connection and try again.');
      });
    },
    [paid, toasts.push],
  );

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

      setAccess(plan ? 'plan' : own ? 'own-key' : 'demo');
      track(provider.demo ? 'demo_started' : 'question_started');
      setDraft(null);
      setSession(next);
      setScreen('lesson');
      void next.start();
    },
    [plan, settings, sandbox, toasts.push],
  );

  /** To the question box, or to the choice of how to pay if there is no way to ask yet. */
  const toQuestion = useCallback(() => {
    setScreen(plan || storedOwnKey(settings) ? 'solve' : 'start');
  }, [plan, settings]);

  /**
   * Asked from the box on the home page. Someone who can already solve goes
   * straight on; anyone else chooses how, and the question waits for them.
   */
  const askFromHome = useCallback(
    (question: string) => {
      if (!plan && !storedOwnKey(settings)) {
        setDraft({ question, files: [] });
        setScreen('start');
        return;
      }
      void allLessons().then((history) => {
        // Solved here before: offer it free rather than spending anything.
        if (findSolved(question, history)) {
          setDraft({ question, files: [] });
          setScreen('solve');
        } else {
          solve({ question, attachments: [] });
        }
      });
    },
    [plan, settings, solve],
  );

  // Count a question once, when it finishes or fails.
  useEffect(() => {
    if (!session) return;
    const settle = (): void => {
      const state = session.state;
      if (counted.current.has(session.id)) return;
      if (state.ending && state.phase === 'REVIEW') {
        counted.current.add(session.id);
        if (access !== 'replay' && access !== 'shared') track('question_solved');
      } else if (state.phase === 'ABORTED' && state.error && state.error.kind !== 'AbortError') {
        counted.current.add(session.id);
        track('question_failed');
      }
    };
    settle();
    return session.subscribe(settle);
  }, [session, access]);

  // Opened from a shared link: play it, or say why it cannot be.
  const sharedOpened = useRef(false);

  /**
   * Play back a question that has already been solved. Nothing is sent to a
   * model and no credit is used: the saved board and narration go through the
   * same session, voice and pacing as the first time (§18).
   */
  const replay = useCallback(
    (record: SolutionRecord, kind: Access = 'replay') => {
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
      setAccess(kind);
      setSession(next);
      setScreen('lesson');
      void next.start();
    },
    [settings],
  );

  useEffect(() => {
    const id = sharedIdInUrl();
    if (!id || sharedOpened.current) return;
    sharedOpened.current = true;
    void openShared(id).then((result) => {
      clearSharedLink();
      if (result.ok) {
        track('share_opened');
        replay(result.record, 'shared');
      } else {
        toasts.push(result.message);
      }
    });
  }, [replay, toasts.push]);

  const backToQuestion = useCallback(() => {
    session?.abort();
    setSession(null);
    if (access === 'shared') setScreen('landing');
    else if (access === 'demo') setScreen('solve');
    else toQuestion();
  }, [session, access, toQuestion]);

  /**
   * A subscriber changes plan in the billing portal — a second checkout would
   * be a second subscription. Everyone else goes to the pricing table.
   */
  const seePlans = useCallback(() => {
    const portal = billingPortalUrl();
    if (plan && portal) {
      window.open(portal, '_blank', 'noopener,noreferrer');
      return;
    }
    if (plan) {
      toasts.push(NO_PORTAL);
      return;
    }
    session?.abort();
    setSession(null);
    setToPricing(true);
    setScreen('landing');
  }, [plan, session, toasts.push]);

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
          connected={
            plan
              ? `Your ${plan.name} plan is connected on this device.`
              : storedOwnKey(settings)
                ? `Your own ${storedOwnKey(settings)?.label ?? ''} key is connected on this device.`
                : null
          }
          onStart={toQuestion}
          onChoose={choosePlan}
          onAsk={askFromHome}
          onAttach={(question, files) => {
            setDraft({ question, files });
            toQuestion();
          }}
          theme={settings.theme}
          startAtPricing={toPricing}
          onDemo={openDemo}
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
            track('own_key_connected');
            setScreen('solve');
            toasts.push(`Your ${own.label} key is connected. Ask it anything.`);
          }}
        />
      )}

      {screen === 'activate' && (
        <Activate
          paidCode={paidCode}
          onBack={() => {
            setToPricing(false);
            setScreen('landing');
          }}
          onOwnKey={() => setScreen('own-key')}
          onDone={(activated) => {
            clearCheckoutFlag();
            setPaidCode(null);
            setPlan(activated);
            update({ provider: MANAGED_PROVIDER_ID });
            track('plan_activated');
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
          draft={draft}
          onSolve={solve}
          onReplay={(record) => replay(record)}
          onHome={() => setScreen('landing')}
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
          access={access}
          onReconnect={reconnect}
          onSeePlans={seePlans}
        />
      )}

      {screen === 'review' && session && (
        <Review
          session={session}
          subject={session.subject}
          canShare={access !== 'demo' && access !== 'shared'}
          againLabel={access === 'shared' ? 'Solve your own question' : 'Solve another question'}
          onHome={() => {
            setSession(null);
            setScreen('landing');
          }}
          onAgain={() => {
            setSession(null);
            if (access === 'shared') setScreen('landing');
            else if (access === 'demo') setScreen('solve');
            else toQuestion();
          }}
        />
      )}

      {screen === 'start' && (
        <Start
          question={draft?.question ?? null}
          onChoose={choosePlan}
          onOwnKey={() => setScreen('own-key')}
          onActivate={() => setScreen('activate')}
          onHome={() => setScreen('landing')}
          onDemo={openDemo}
          onReplay={(record) => replay(record)}
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

/** True when a link meant for activating brought the learner here (§24). */
function cameFromCheckout(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('activate');
  } catch {
    return false;
  }
}

/** Take the shared id out of the address, so leaving the solution does not reopen it. */
function clearSharedLink(): void {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  } catch {
    /* Harmless if it stays. */
  }
}

/** Drop the checkout flags once they have done their job, so a reload does not repeat them. */
function clearCheckoutFlag(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('activate') || params.has('_ptxn')) {
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
