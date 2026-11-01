/**
 * The board screen (§15).
 *
 * The board is the screen. Above it is one thin line saying what is happening;
 * under it is one box to ask from, with the playback controls inside it. The
 * plan and the meter, the transcript and the trace are a press away and take
 * no room until they are wanted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardScroll } from '../board/Board';
import type { BoardStep } from '../board/page';
import { prefersReducedMotion, useReveal } from '../board/reveal';
import { bestVoices, cancelSpeech, loadVoices, voiceLabel } from '../voice/speech';
import type { Session, SessionState } from '../orchestrator/session';
import { isRunning, PHASE_LABELS } from '../orchestrator/machine';
import type { Settings } from '../storage/settings';
import { SUBJECT_ACCENTS } from '../core/types';
import { track } from '../growth/track';
import { AskPanel } from './AskPanel';
import { Composer } from './Composer';
import { Meter } from './Meter';
import { Details } from './Details';
import { Transcript } from './Transcript';
import { Shortcuts } from './Shortcuts';

/** How the learner got here, which decides what a rejected key means. */
export type Access = 'plan' | 'own-key' | 'demo' | 'replay' | 'shared';

export function LessonScreen({
  session,
  settings,
  onUpdateSettings,
  onFinished,
  onExit,
  access,
  onReconnect,
  onSeePlans,
}: {
  access: Access;
  session: Session;
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onFinished: () => void;
  onExit: () => void;
  /** Re-activates the plan on this device; resolves to what to tell the learner. */
  onReconnect: () => Promise<string>;
  onSeePlans: () => void;
}): JSX.Element {
  const state = useSessionState(session);
  const [reconnect, setReconnect] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [drawer, setDrawer] = useState<'none' | 'transcript' | 'details' | 'shortcuts'>('none');
  const [raising, setRaising] = useState<'no' | 'typing' | 'speaking'>('no');
  const [planOpen, setPlanOpen] = useState(false);
  const [focusAsk, setFocusAsk] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [manualStep, setManualStep] = useState<string | null>(null);
  /** Bumped to explain a step again from its start. */
  const [replayNonce, setReplayNonce] = useState(0);

  const reducedMotion = useMemo(
    () => settings.reducedMotion === 'always' || prefersReducedMotion(),
    [settings.reducedMotion],
  );

  useEffect(() => {
    void loadVoices().then((all) => setVoices(bestVoices(all)));
  }, []);

  // The board model adds steps to a page in place, so the pages array can be
  // the very same object with more in it. Keying on the count as well is what
  // makes a newly written step visible here.
  const stepCount = state.pages.reduce((n, p) => n + p.steps.length, 0);
  const steps = useMemo(
    () => state.pages.flatMap((p) => p.steps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.pages, stepCount],
  );
  const stepById = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const pageOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const page of state.pages) for (const s of page.steps) map.set(s.id, page.index);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pages, stepCount]);

  const asideKey = state.asideStepIds.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const asides = useMemo(() => new Set(state.asideStepIds), [asideKey]);

  /* ---------------------------------------------------------------- *
   * Playback
   *
   * Steps are spoken strictly one after another. The model writes faster than
   * a voice can speak, so "narrate whatever is newest" would skip steps
   * mid-sentence; instead there is a playlist, and `pos` is the first entry
   * not yet spoken.
   *
   * The playlist is not simply the order the steps were written in. An answer
   * to a raised hand jumps the queue: it is slotted in at `pos`, ahead of the
   * step it interrupted, so the learner hears their answer next rather than
   * after whatever the model had already written. The interrupted step is
   * then explained again from the start — that is "picking up where it left
   * off".
   * ---------------------------------------------------------------- */

  const [order, setOrder] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  posRef.current = pos;

  useEffect(() => {
    setOrder((prev) => {
      const known = new Set(prev);
      let next = prev;
      let insertAt = Math.min(posRef.current, prev.length);
      for (const s of steps) {
        if (known.has(s.id)) continue;
        if (next === prev) next = [...prev];
        if (asides.has(s.id)) {
          next.splice(insertAt, 0, s.id);
          insertAt += 1;
        } else {
          next.push(s.id);
        }
      }
      return next;
    });
  }, [steps, asides]);

  const queued = stepById.get(order[pos] ?? '') ?? null;

  // The learner can step back and replay something, which takes over until
  // it finishes, then the playlist carries on from where it was.
  const manual = manualStep ? (stepById.get(manualStep) ?? null) : null;
  const narrating = manual ?? queued;
  const caughtUp = pos >= order.length && order.length === steps.length && !manual;

  // What is on the board, top to bottom: every step in the order it was first
  // explained. A step that has not been reached yet is not on the board yet.
  const [shown, setShown] = useState<string[]>([]);
  useEffect(() => {
    const id = queued?.id;
    if (id) setShown((list) => (list.includes(id) ? list : [...list, id]));
  }, [queued?.id]);

  // A raised hand holds the solution. While the answer is being written, and
  // after it has been spoken until the learner says whether it made sense,
  // only an answer may be spoken.
  const queuedIsAnswer = queued !== null && asides.has(queued.id);
  const heldForAnswer = state.aside !== 'none' && !queuedIsAnswer && !manual;
  const askIfClear = state.aside === 'waiting' && heldForAnswer;

  // Steps the learner interrupted are explained again without being rubbed
  // out and rewritten: the writing is already there.
  const interrupted = useRef(new Set<string>());
  const acknowledged = useRef(new Set<string>());

  const { reveal: spoken, progress } = useReveal(narrating, {
    rate: settings.rate,
    voiceName: settings.voiceName,
    muted: settings.muted,
    paused: paused || state.pending !== null || raising !== 'no' || heldForAnswer,
    reducedMotion,
    nonce: replayNonce,
    onStepDone: (id) => {
      if (manualStep) {
        setManualStep(null);
        return;
      }
      if (id !== queued?.id) return;
      setPos((p) => p + 1);
      // Tell the session, which is holding the model one step ahead (§14).
      if (!acknowledged.current.has(id)) {
        acknowledged.current.add(id);
        session.stepNarrated();
      }
    },
  });

  const reveal = useMemo(() => {
    const map = new Map(spoken);
    for (const id of interrupted.current) map.delete(id);
    // The step about to be spoken starts blank rather than flashing up whole.
    if (queued && !manual && !map.has(queued.id) && !interrupted.current.has(queued.id)) {
      map.set(queued.id, 0);
    }
    return map;
  }, [spoken, queued, manual]);

  const boardSteps = useMemo(
    () => shown.map((id) => stepById.get(id)).filter((s): s is BoardStep => s !== undefined),
    [shown, stepById],
  );

  // Where the solver started a fresh page, the board draws a rule.
  const breaks = useMemo(() => {
    const out = new Set<string>();
    let last: number | undefined;
    for (const step of boardSteps) {
      if (asides.has(step.id)) continue;
      const page = pageOf.get(step.id);
      if (last !== undefined && page !== undefined && page !== last) out.add(step.id);
      last = page ?? last;
    }
    return out;
  }, [boardSteps, asides, pageOf]);

  // The solution is not over until the last step has been explained.
  const finished = state.phase === 'REVIEW' && caughtUp && state.aside === 'none';

  // Speech must never outlive this screen (§14).
  useEffect(() => cancelSpeech, []);

  /**
   * Explain a step from its start. The step the playlist is on is simply
   * restarted; any other is played as an aside to the playlist, which then
   * carries on where it was. (Setting the playlist's own step as the aside
   * would change nothing the narration can see, and playback would stall.)
   */
  const playFromStart = useCallback(
    (id: string) => {
      setManualStep(id === queued?.id ? null : id);
      setReplayNonce((n) => n + 1);
    },
    [queued],
  );

  const stepTo = useCallback(
    (delta: number) => {
      const index = shown.indexOf(narrating?.id ?? shown.at(-1) ?? '');
      const next = shown[Math.max(0, Math.min(shown.length - 1, index + delta))];
      if (next) playFromStart(next);
    },
    [shown, narrating, playFromStart],
  );

  const replay = useCallback(() => {
    const id = narrating?.id ?? shown.at(-1);
    if (id) playFromStart(id);
  }, [narrating, shown, playFromStart]);

  /** Stop the explanation at once, so the learner can ask (§15). */
  const stopAndAsk = useCallback(
    (how: 'typing' | 'speaking') => {
      cancelSpeech();
      if (queued && !asides.has(queued.id)) interrupted.current.add(queued.id);
      setManualStep(null);
      setRaising(how);
    },
    [queued, asides],
  );

  const canAsk = state.phase !== 'PLANNING' && state.phase !== 'CHECKING' && state.error === null;

  useKeyboard({
    enabled: state.pending === null && raising === 'no' && drawer === 'none',
    onSpace: () => setPaused((p) => !p),
    onPrev: () => stepTo(-1),
    onNext: () => stepTo(1),
    onReplay: replay,
    onRaise: () => {
      if (!canAsk) return;
      stopAndAsk('typing');
      setFocusAsk((n) => n + 1);
    },
    onMute: () => onUpdateSettings({ muted: !settings.muted }),
    onHelp: () => setDrawer('shortcuts'),
    onStop: () => session.abort(),
  });

  const accent = SUBJECT_ACCENTS[session.subject];
  const status = finished
    ? 'Done'
    : askIfClear
      ? 'Waiting to hear whether that made sense'
      : state.aside === 'answering' && heldForAnswer
        ? 'Working out an answer to your question'
        : queued && !heldForAnswer
          ? queuedIsAnswer
            ? 'Answering your question'
            : 'Explaining this step'
          : (state.status ?? PHASE_LABELS[state.phase]);

  const rates = [0.75, 1, 1.25, 1.5];

  return (
    <div className="lesson">
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
        <span className="status-text">
          <span role="status" aria-live="polite">
            {status}
          </span>
          {state.plan && <span className="dim"> · {state.plan.title}</span>}
        </span>
        {access === 'replay' && <span className="pill pill-accent">Replay · free</span>}
        {access === 'shared' && <span className="pill pill-accent">Shared solution</span>}
        {access === 'demo' && (
          <>
            <span className="pill">Demo</span>
            <button className="btn-quiet small" onClick={onSeePlans}>
              See plans
            </button>
          </>
        )}
        <button
          className="btn-quiet small"
          onClick={() => setPlanOpen((o) => !o)}
          aria-expanded={planOpen}
        >
          Plan
        </button>
        <button className="btn-quiet small" onClick={() => setDrawer('transcript')}>
          Transcript
        </button>
        <button className="btn-quiet small" onClick={() => setDrawer('details')}>
          Details
        </button>
        <button className="btn-quiet small" onClick={onExit}>
          Stop and leave
        </button>
      </div>

      <div className="lesson-body">
        <main className="stage">
          {state.error && (
            <div className="notice notice-error" style={{ margin: '12px 16px 0' }} role="alert">
              {/* A rejected key on a plan means the plan is no longer connected
                  here, which the learner can fix in one press (§17.1). */}
              {state.error.kind === 'AuthError' && state.error.status !== 404 && access === 'plan' ? (
                <>
                  <strong>Your plan is no longer connected on this device.</strong>
                  <div className="small dim" style={{ marginTop: 6 }}>
                    {reconnect ??
                      'This happens when your access code is used on another device, or when the subscription has ended. What was written so far is saved.'}
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      onClick={() => {
                        setReconnect('Reconnecting your plan…');
                        void onReconnect().then(setReconnect);
                      }}
                    >
                      Reconnect
                    </button>
                    <button className="btn-quiet" onClick={onExit}>
                      Back
                    </button>
                  </div>
                </>
              ) : state.error.kind === 'CreditError' && access === 'own-key' ? (
                <strong>
                  Your provider says this key has no credit left. Add credit with them, or use a
                  different key. What was written so far is saved.
                </strong>
              ) : (
                <strong>{state.error.message}</strong>
              )}
              {state.error.kind === 'AuthError' && access === 'own-key' && (
                <div className="small dim" style={{ marginTop: 6 }}>
                  Your own key was refused by its provider. Go back, open Settings, remove it and
                  paste a working one. What was written so far is saved.
                </div>
              )}
              {state.error.kind === 'CreditError' && access === 'plan' && (
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="small dim">What was written so far is saved.</span>
                  <button className="btn" onClick={onSeePlans}>
                    See bigger plans
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="board-frame">
            <BoardScroll
              steps={boardSteps}
              breaks={breaks}
              asides={asides}
              questions={state.asideQuestions}
              followId={narrating?.id ?? null}
              theme={settings.theme}
              subject={session.subject}
              reveal={reveal}
              reducedMotion={reducedMotion}
            />

            {state.pending && (
              <AskPanel
                question={state.pending.question}
                onAnswer={(a) => session.answerAsk(a)}
                onSkip={() => session.answerAsk('', true)}
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

          <Composer
            disabled={!canAsk}
            engaged={raising !== 'no'}
            focusSignal={focusAsk}
            placeholder={
              state.error
                ? 'Stopped. What was written so far is saved.'
                : !canAsk
                  ? 'Reading your question…'
                  : finished
                    ? 'Ask a question about this solution'
                    : 'Ask anything. It stops, answers, then carries on where it left off.'
            }
            note={
              access === 'demo'
                ? 'The demo plays a prepared walkthrough, so it cannot really answer you: it will carry on with its next step. With a plan or your own key, it answers what you ask.'
                : access === 'replay'
                  ? 'This is a replay of a question you already had solved, so it cannot answer something new: it will carry on with its next step. To ask about it, go back and solve it again.'
                  : access === 'shared'
                    ? 'This is a solution someone shared, so it cannot answer you: it will carry on with its next step. To ask about it, solve the question yourself.'
                    : undefined
            }
            onEngage={() => stopAndAsk('typing')}
            onRelease={() => setRaising('no')}
            onAsk={(q) => {
              track('hand_raised');
              session.raiseHand(q);
              setRaising('no');
            }}
            prompt={
              /* The learner decides whether their question was answered. The
                 solver is not allowed to decide that for them, or to quiz them. */
              askIfClear ? (
                <div role="group" aria-label="Did that answer your question?" className="row">
                  <strong>Did that answer your question?</strong>
                  <button className="btn btn-primary" onClick={() => session.resumeAfterAside(true)}>
                    Yes, carry on
                  </button>
                  <button className="btn" onClick={() => session.resumeAfterAside(false)}>
                    Explain it another way
                  </button>
                </div>
              ) : finished ? (
                <div role="group" aria-label="The solution is finished" className="row">
                  <strong>That is the whole solution.</strong>
                  <button className="btn btn-primary" onClick={onFinished}>
                    See the summary
                  </button>
                </div>
              ) : undefined
            }
            controls={
              <>
                <button
                  className="icon-btn"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? 'Resume' : 'Pause'}
                  title={paused ? 'Resume (Space)' : 'Pause (Space)'}
                >
                  {paused ? '▶' : '❚❚'}
                </button>
                <button className="icon-btn" onClick={() => stepTo(-1)} aria-label="Previous step" title="Previous step (←)">
                  ‹
                </button>
                <button className="icon-btn" onClick={() => stepTo(1)} aria-label="Next step" title="Next step (→)">
                  ›
                </button>
                <button className="icon-btn" onClick={replay} aria-label="Replay step" title="Replay step (R)">
                  ↻
                </button>
                <button
                  className="icon-btn"
                  onClick={() => onUpdateSettings({ muted: !settings.muted })}
                  aria-label={settings.muted ? 'Turn the voice on' : 'Turn the voice off'}
                  title={settings.muted ? 'Voice is off (M)' : 'Voice is on (M)'}
                >
                  {settings.muted ? '🔇' : '🔊'}
                </button>
                <select
                  className="composer-select"
                  value={String(rates.reduce((a, b) => (Math.abs(b - settings.rate) < Math.abs(a - settings.rate) ? b : a)))}
                  onChange={(e) => onUpdateSettings({ rate: Number(e.target.value) })}
                  aria-label="Speech and reveal speed"
                >
                  {rates.map((r) => (
                    <option key={r} value={String(r)}>
                      {r}×
                    </option>
                  ))}
                </select>
                {voices.length > 0 && !settings.muted && (
                  <select
                    className="composer-select composer-voice"
                    value={settings.voiceName ?? ''}
                    onChange={(e) => onUpdateSettings({ voiceName: e.target.value || null })}
                    aria-label="Voice"
                  >
                    <option value="">Best voice</option>
                    {voices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {voiceLabel(v)}
                      </option>
                    ))}
                  </select>
                )}
                {settings.muted && progress > 0 && (
                  <span className="dim small mono">{Math.round(progress * 100)}%</span>
                )}
              </>
            }
          />
        </main>

        {planOpen && (
          <aside className="rail" aria-label="The plan">
            <div className="rail-section">
              <h3>Solving</h3>
              <div style={{ fontWeight: 600 }}>{state.plan?.title ?? 'Reading your question…'}</div>
              {state.plan && (
                <div className="dim small">about {state.plan.estimatedMinutes} minutes</div>
              )}
            </div>

            {state.plan && (
              <div className="rail-section">
                <h3>The plan</h3>
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

            <button className="btn-quiet small" style={{ marginTop: 'auto' }} onClick={() => setPlanOpen(false)}>
              Close
            </button>
          </aside>
        )}
      </div>
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
