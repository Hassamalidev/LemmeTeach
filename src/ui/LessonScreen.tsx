/**
 * The lesson (§15.4).
 *
 * The board fills the screen; a thin rail holds the plan and the meter, and a
 * transport bar sits underneath. Everything else — questions, the transcript,
 * the trace — appears over the board only when it is wanted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../board/Board';
import { prefersReducedMotion, useReveal } from '../board/reveal';
import { cancelSpeech, loadVoices } from '../voice/speech';
import type { Session, SessionState } from '../orchestrator/session';
import { isRunning, PHASE_LABELS } from '../orchestrator/machine';
import type { Settings } from '../storage/settings';
import { SUBJECT_ACCENTS } from '../core/types';
import { AskPanel } from './AskPanel';
import { QuizPanel } from './QuizPanel';
import { RaiseHand } from './RaiseHand';
import { Meter } from './Meter';
import { Details } from './Details';
import { Transcript } from './Transcript';
import { Shortcuts } from './Shortcuts';

export function LessonScreen({
  session,
  settings,
  onUpdateSettings,
  onFinished,
  onExit,
}: {
  session: Session;
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onFinished: () => void;
  onExit: () => void;
}): JSX.Element {
  const state = useSessionState(session);
  const [paused, setPaused] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [drawer, setDrawer] = useState<'none' | 'transcript' | 'details' | 'shortcuts'>('none');
  const [raising, setRaising] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [manualStep, setManualStep] = useState<string | null>(null);

  const reducedMotion = useMemo(
    () => settings.reducedMotion === 'always' || prefersReducedMotion(),
    [settings.reducedMotion],
  );

  useEffect(() => {
    void loadVoices().then(setVoices);
  }, []);

  const steps = useMemo(() => state.pages.flatMap((p) => p.steps), [state.pages]);
  const latest = steps.at(-1) ?? null;

  // The step being narrated is the newest one, unless the learner has stepped
  // back deliberately — in which case they are replaying, and stay there.
  const narrating = manualStep ? (steps.find((s) => s.id === manualStep) ?? latest) : latest;

  const { reveal, progress } = useReveal(narrating, {
    rate: settings.rate,
    voiceName: settings.voiceName,
    muted: settings.muted,
    paused: paused || state.pending !== null,
    reducedMotion,
    onStepDone: () => setManualStep(null),
  });

  // Follow the newest page unless the learner has scrolled back.
  useEffect(() => {
    if (!manualStep) setPageIndex(state.pages.length - 1);
  }, [state.pages.length, manualStep]);

  useEffect(() => {
    if (state.phase === 'REVIEW') {
      cancelSpeech();
      onFinished();
    }
  }, [state.phase, onFinished]);

  // Speech must never outlive this screen (§14).
  useEffect(() => cancelSpeech, []);

  const stepTo = useCallback(
    (delta: number) => {
      const index = steps.findIndex((s) => s.id === (narrating?.id ?? ''));
      const next = steps[Math.max(0, Math.min(steps.length - 1, index + delta))];
      if (next) {
        setManualStep(next.id);
        const page = state.pages.findIndex((p) => p.steps.some((s) => s.id === next.id));
        if (page >= 0) setPageIndex(page);
      }
    },
    [steps, narrating, state.pages],
  );

  const replay = useCallback(() => {
    if (narrating) setManualStep(narrating.id);
  }, [narrating]);

  const raiseHand = useCallback(() => {
    cancelSpeech();
    setRaising(true);
  }, []);

  useKeyboard({
    enabled: state.pending === null && !raising && drawer === 'none',
    onSpace: () => setPaused((p) => !p),
    onPrev: () => stepTo(-1),
    onNext: () => stepTo(1),
    onReplay: replay,
    onRaise: raiseHand,
    onMute: () => onUpdateSettings({ muted: !settings.muted }),
    onHelp: () => setDrawer('shortcuts'),
    onStop: () => session.abort(),
  });

  const accent = SUBJECT_ACCENTS[session.subject];
  const status = state.status ?? PHASE_LABELS[state.phase];

  return (
    <div className="lesson">
      <aside className="rail">
        <div className="rail-section rail-essential">
          <h3>Lesson</h3>
          <div style={{ fontWeight: 600 }}>{state.plan?.title ?? 'Planning…'}</div>
          {state.plan && (
            <div className="dim small">about {state.plan.estimatedMinutes} minutes</div>
          )}
        </div>

        {state.plan && (
          <div className="rail-section">
            <h3>Objectives</h3>
            {state.plan.objectives.map((o) => {
              const done = state.ending?.objectivesMet.includes(o.id);
              const active = narrating?.objective === o.id;
              return (
                <div
                  key={o.id}
                  className={`objective ${active ? 'active' : ''} ${done ? 'done' : ''}`}
                >
                  <span className="dot" aria-hidden="true" />
                  <span>{o.text}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="rail-section">
          <h3>Budget</h3>
          <Meter budget={state.budget} />
        </div>

        <div className="rail-section rail-essential" style={{ marginTop: 'auto' }}>
          <button className="btn-quiet" onClick={() => setDrawer('details')}>
            Details
          </button>
          <button className="btn-quiet" onClick={onExit}>
            Stop and leave
          </button>
        </div>
      </aside>

      <main className="stage">
        <div className="status-bar">
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: isRunning(state.phase) ? accent : 'var(--chrome-line)',
              flex: 'none',
            }}
          />
          <span className="status-text" role="status" aria-live="polite">
            {status}
          </span>
          {state.scriptedMode && <span className="pill">Reduced mode</span>}
        </div>

        {state.error && (
          <div className="notice notice-error" style={{ margin: '12px 16px 0' }}>
            <strong>{state.error.message}</strong>
            {state.error.kind === 'AuthError' && (
              <div className="small dim" style={{ marginTop: 6 }}>
                Open Settings and check the key.
              </div>
            )}
          </div>
        )}

        {state.scriptedOffered && !state.scriptedMode && (
          <div className="notice notice-warn" style={{ margin: '12px 16px 0' }}>
            <strong>This model is struggling to run a lesson.</strong>
            <p className="small dim" style={{ marginTop: 6 }}>
              It has not managed a valid tool call in three turns, which usually means it cannot
              use tools reliably. Chalk can fall back to a reduced mode: it asks for the whole
              lesson in one go and plays it through. You still get the board and the voice, but
              there are no questions, no adapting to your answers, and you cannot interrupt — so
              it is a lesson, not tutoring.
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => void session.runScripted()}>
                Use the reduced mode
              </button>
              <button className="btn-quiet" onClick={onExit}>
                Stop and pick a different model
              </button>
            </div>
          </div>
        )}

        <div className="board-frame">
          <Board
            pages={state.pages}
            pageIndex={pageIndex}
            theme={settings.theme}
            subject={session.subject}
            reveal={reveal}
            onPageChange={setPageIndex}
          />

          {state.pending?.kind === 'ask' && (
            <AskPanel
              question={state.pending.question}
              onAnswer={(a) => session.answerAsk(a)}
              onSkip={() => session.answerAsk('', true)}
            />
          )}

          {state.pending?.kind === 'quiz' && (
            <QuizPanel
              questions={state.pending.questions}
              onSubmit={(chosen) => session.answerQuiz(chosen)}
            />
          )}

          {raising && (
            <RaiseHand
              onAsk={(q) => {
                session.raiseHand(q);
                setRaising(false);
              }}
              onCancel={() => setRaising(false)}
            />
          )}

          {drawer === 'details' && (
            <Details trace={session.trace} onClose={() => setDrawer('none')} />
          )}
          {drawer === 'transcript' && (
            <Transcript
              lines={state.transcript}
              currentStepId={narrating?.id ?? null}
              onClose={() => setDrawer('none')}
            />
          )}
          {drawer === 'shortcuts' && <Shortcuts onClose={() => setDrawer('none')} />}
        </div>

        <div className="transport">
          <button
            className="btn-quiet"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume' : 'Pause'}
            title="Space"
          >
            {paused ? '▶ Play' : '❚❚ Pause'}
          </button>
          <button className="btn-quiet" onClick={() => stepTo(-1)} aria-label="Previous step" title="←">
            ‹
          </button>
          <button className="btn-quiet" onClick={() => stepTo(1)} aria-label="Next step" title="→">
            ›
          </button>
          <button className="btn-quiet" onClick={replay} title="R">
            Replay step
          </button>

          <div className="spacer" />

          <button
            className="btn-quiet"
            onClick={() => onUpdateSettings({ muted: !settings.muted })}
            title="M"
          >
            {settings.muted ? '🔇 Muted' : '🔊 Voice'}
          </button>

          <label className="row" style={{ gap: 6 }}>
            <span className="dim small">Speed</span>
            <input
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={settings.rate}
              onChange={(e) => onUpdateSettings({ rate: Number(e.target.value) })}
              aria-label="Speech and reveal speed"
            />
            <span className="dim small mono">{settings.rate.toFixed(2)}×</span>
          </label>

          {voices.length > 0 && !settings.muted && (
            <select
              value={settings.voiceName ?? ''}
              onChange={(e) => onUpdateSettings({ voiceName: e.target.value || null })}
              aria-label="Voice"
            >
              <option value="">Default voice</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          )}

          <button className="btn-quiet" onClick={() => setDrawer('transcript')}>
            Transcript
          </button>
          <button className="btn" onClick={raiseHand} title="H">
            ✋ Raise hand
          </button>
        </div>

        {settings.muted && (
          <div className="dim small" style={{ padding: '0 16px 8px' }}>
            Voice is off, so the board advances on a timer. Open the transcript to read along.
            {progress > 0 && ` ${Math.round(progress * 100)}% through this step.`}
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

function useSessionState(session: Session): SessionState {
  const [state, setState] = useState<SessionState>(() => session.state);
  useEffect(() => {
    setState(session.state);
    return session.subscribe(setState);
  }, [session]);
  return state;
}

/** Keyboard shortcuts (§15). All controls are reachable by tab as well. */
function useKeyboard(opts: {
  enabled: boolean;
  onSpace: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onRaise: () => void;
  onMute: () => void;
  onHelp: () => void;
  onStop: () => void;
}): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const o = ref.current;
      if (!o.enabled) return;

      // Never steal a key from someone typing.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          o.onSpace();
          break;
        case 'ArrowLeft':
          o.onPrev();
          break;
        case 'ArrowRight':
          o.onNext();
          break;
        case 'r':
        case 'R':
          o.onReplay();
          break;
        case 'h':
        case 'H':
          o.onRaise();
          break;
        case 'm':
        case 'M':
          o.onMute();
          break;
        case '?':
          o.onHelp();
          break;
        case 'Escape':
          o.onStop();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
