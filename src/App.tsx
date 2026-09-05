/**
 * The app shell (§15).
 *
 * Five screens held in React state. No router — that is what keeps the build
 * working at any path, including a GitHub Pages subpath and file://, and it
 * costs nothing at this size.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Level, SubjectId } from './core/types';
import { adapterFor, configFor } from './providers';
import { setMockLesson } from './providers/mock';
import { getKey, loadSettings, saveSettings, type Settings } from './storage/settings';
import { setStorageNotifier } from './storage/db';
import { learnerStore } from './memory/store';
import { materialsStore } from './materials/store';
import { DisabledSandbox, SandboxHost } from './sandbox/host';
import { Session } from './orchestrator/session';
import { Setup } from './ui/Setup';
import { Home } from './ui/Home';
import { Topic } from './ui/Topic';
import { LessonScreen } from './ui/LessonScreen';
import { Review } from './ui/Review';
import { SettingsPanel } from './ui/SettingsPanel';
import { WhatIKnow } from './ui/WhatIKnow';
import { Toasts, useToasts } from './ui/Toasts';

type Screen = 'setup' | 'home' | 'topic' | 'lesson' | 'review' | 'know';

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>(() =>
    getKey(loadSettings().provider) ? 'home' : 'setup',
  );
  const [subject, setSubject] = useState<SubjectId>('math');
  const [session, setSession] = useState<Session | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewConcepts, setReviewConcepts] = useState<string[]>([]);
  const toasts = useToasts();

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    // Eviction and storage failures reach the learner rather than happening
    // silently (§20).
    setStorageNotifier(toasts.push);
    return materialsStore.onNotice(toasts.push);
  }, [toasts.push]);

  useEffect(() => {
    document.documentElement.dataset.motion =
      settings.reducedMotion === 'always' ? 'reduced' : '';
  }, [settings.reducedMotion]);

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

  const startLesson = useCallback(
    (topic: string, level: Level, concepts: string[] = []) => {
      const provider = adapterFor(settings.provider);
      const key = getKey(settings.provider);

      // The replay adapter needs to know which bundled lesson to play.
      if (provider.demo) setMockLesson(subject);

      const model =
        settings.model[settings.provider] || provider.defaultModel;
      const roles = settings.roleModels;

      const next = new Session({
        subject,
        topic,
        level,
        provider,
        adapterConfig: configFor(settings.provider, key, settings.compatibleBaseUrl),
        settings,
        memory: learnerStore,
        materials: materialsStore,
        sandbox,
        reviewConcepts: concepts,
        models: {
          // The split from §18: fast for planning and examining, strong for
          // teaching, cheapest for repair — all overridable in Settings.
          planner: roles.planner || model,
          tutor: roles.tutor || model,
          examiner: roles.examiner || model,
          repairer: roles.repairer || model,
        },
        contextWindow: 128_000,
      });

      if (sandbox instanceof SandboxHost) {
        sandbox.setSeed(hashSeed(`${topic}:${subject}`));
        sandbox.setProgressHandler(toasts.push);
      }

      setSession(next);
      setScreen('lesson');
      void next.start();
    },
    [settings, subject, sandbox, toasts.push],
  );

  const goHome = useCallback(() => {
    session?.abort();
    setSession(null);
    setScreen('home');
  }, [session]);

  return (
    <div className="app">
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />

      {screen === 'setup' && (
        <Setup
          settings={settings}
          onUpdate={update}
          onDone={() => setScreen('home')}
        />
      )}

      {screen === 'home' && (
        <Home
          settings={settings}
          onPickSubject={(s) => {
            setSubject(s);
            setReviewConcepts([]);
            setScreen('topic');
          }}
          onReview={(concepts, s) => {
            setSubject(s);
            setReviewConcepts(concepts);
            setScreen('topic');
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenKnowledge={() => setScreen('know')}
        />
      )}

      {screen === 'topic' && (
        <Topic
          subject={subject}
          settings={settings}
          seededConcepts={reviewConcepts}
          onBack={() => setScreen('home')}
          onStart={startLesson}
        />
      )}

      {screen === 'lesson' && session && (
        <LessonScreen
          session={session}
          settings={settings}
          onUpdateSettings={update}
          onFinished={() => setScreen('review')}
          onExit={goHome}
        />
      )}

      {screen === 'review' && session && (
        <Review
          session={session}
          subject={subject}
          onHome={() => {
            setSession(null);
            setScreen('home');
          }}
          onAgain={() => setScreen('topic')}
        />
      )}

      {screen === 'know' && (
        <WhatIKnow onBack={() => setScreen('home')} />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={update}
          onClose={() => setSettingsOpen(false)}
          onForgetKey={() => {
            setSettingsOpen(false);
            setScreen('setup');
          }}
        />
      )}
    </div>
  );
}

/** A stable seed per topic, so a repeated lesson draws the same figures. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
