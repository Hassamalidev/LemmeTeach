/**
 * The landing page (§29).
 *
 * The first thing every visit shows. The board is the pitch,
 * so the hero holds a real one that writes itself out the way it does in a
 * lesson, and every number on the page comes from shared/plans.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLANS, formatUsd, type PlanId } from '../../shared/plans';
import { Board } from '../board/Board';
import { BoardModel, revealUnits, type BoardStep } from '../board/page';
import { prefersReducedMotion } from '../board/reveal';
import { validateOps } from '../board/validate';
import { SHOWCASES } from './showcase';
import { OWN_KEY_PROVIDERS } from '../providers/own-key';
import type { SubjectId } from '../core/types';
import { filesFrom } from '../solve/attachments';
import { PlanCards } from './Plans';
import { track } from '../growth/track';
import type { BoardTheme } from '../storage/settings';
import { SubjectExplorer, type ExplorerBoard } from './SubjectExplorer';

const HOW_IT_GOES: { title: string; text: string }[] = [
  {
    title: 'You bring the question',
    text: 'Type it, paste a screenshot, or attach a photo or a PDF. There is no subject to pick and no level to set.',
  },
  {
    title: 'It reads it properly',
    text: 'It sets out what is given and what is asked. If part of your upload cannot be read, it asks you instead of guessing.',
  },
  {
    title: 'It solves it on a board',
    text: 'One move per step, with the reason for it, and the diagram or graph drawn rather than described.',
  },
  {
    title: 'It explains aloud',
    text: 'Each step is spoken in a clear voice you choose, and shown as text if you would rather read.',
  },
  {
    title: 'You can interrupt',
    text: 'Stop it at any point and ask your own question. It answers, then carries on where it left off.',
  },
];

/** What each way of getting help does, said as fairly as one line allows. */
const COMPARISON: { what: string; video: string; chat: string; us: string }[] = [
  { what: 'Solves your exact question', video: 'No', chat: 'Yes', us: 'Yes' },
  { what: 'Works from a screenshot or a file', video: 'No', chat: 'Often', us: 'Yes' },
  { what: 'Writes it out on a board, step by step', video: 'A different question', chat: 'A page of text', us: 'Yes' },
  { what: 'Explains each step aloud', video: 'Yes', chat: 'Rarely', us: 'Yes' },
  { what: 'Draws the diagram or the graph', video: 'Yes', chat: 'Sometimes', us: 'Yes' },
  { what: 'Lets you stop it and ask', video: 'No', chat: 'Yes', us: 'Yes' },
];

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Can I use it without subscribing?',
    a: 'Yes, if you already have an API key from an AI service — Anthropic, OpenAI, Google, Mistral, Groq, DeepSeek, xAI, OpenRouter and several others. Paste it and you pay that service directly for what you use; we charge nothing. The key is stored in your browser and sent only to the provider it belongs to. A plan is for people who would rather not deal with keys.',
  },
  {
    q: 'What counts as one question?',
    a: 'One problem worked through from start to finish, usually five to ten steps on the board. The counts on each plan are estimates for that. A sheet of several questions, a long multi-part problem and the deeper tutor use them up faster.',
  },
  {
    q: 'What can I upload?',
    a: 'A screenshot, a photo of a page, a PDF or a text file, up to four at once. Or just type the question. If part of an upload cannot be read, it asks you about that part rather than guessing.',
  },
  {
    q: 'What happens when my questions run out?',
    a: 'New questions pause until your next payment, or until you move to a bigger plan. Everything already solved stays readable.',
  },
  {
    q: 'Where does my data live?',
    a: 'On your device. Your solved questions and their notes are stored in your browser. Questions and uploads travel from your browser straight to the AI service that runs the model; they do not pass through our servers. The exception is one you choose: a solution you share as a link is stored until you stop sharing it. We count how often things happen, like a question being solved, with no names and nothing you typed. Payment is handled by Paddle, so we never see your card.',
  },
  {
    q: 'Can I use it on two devices?',
    a: 'Yes, with the access code you are shown after paying, one device at a time. Your history is kept on each device separately and is not synced between them.',
  },
  {
    q: 'How do I cancel?',
    a: 'From the link in the receipt email Paddle sends you, or from Manage subscription in Settings. You keep access until the end of the month you paid for.',
  },
];

export function Landing({
  theme,
  startAtPricing,
  onDemo,
  onActivate,
  onOwnKey,
  connected,
  onStart,
  onChoose,
  onAsk,
  onAttach,
}: {
  /** Solve what was typed in the box on this page. */
  onAsk: (question: string) => void;
  /** Files were pasted or dropped: carry on from the question screen. */
  onAttach: (question: string, files: File[]) => void;
  /** Open checkout for a plan. */
  onChoose: (plan: PlanId) => void;
  /** Set when a plan or an own key is ready on this device: says which. */
  connected: string | null;
  /** Straight to the question box, for someone who can already solve. */
  onStart: () => void;
  onOwnKey: () => void;
  theme: BoardTheme;
  /** Open scrolled to the plans, for someone who pressed "See plans" in the demo. */
  startAtPricing: boolean;
  onDemo: () => void;
  onActivate: () => void;
}): JSX.Element {
  const pricing = useRef<HTMLElement>(null);
  useEffect(() => track('landing_view'), []);
  const previews = useMemo(buildPreviews, []);
  const { preview, reveal } = useShowcase(previews);
  // One example board per subject for the explorer: the first in the rotation.
  const explorerBoards = useMemo(() => {
    const out: Partial<Record<SubjectId, ExplorerBoard>> = {};
    for (const p of previews) {
      out[p.subject] ??= { model: p.model, field: p.field, topic: p.topic };
    }
    return out;
  }, [previews]);

  const toPricing = (): void => {
    pricing.current?.scrollIntoView?.({ block: 'start' });
    pricing.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (startAtPricing) toPricing();
  }, [startAtPricing]);

  const cheapest = PLANS[0];
  const [question, setQuestion] = useState('');
  const ready = question.trim().length >= 3;
  const ask = (): void => {
    if (ready) onAsk(question.trim());
  };

  return (
    <div className="screen landing">
      <header className="landing-header">
        <div className="landing-header-inner">
          <span className="wordmark">
            <span className="wordmark-mark" aria-hidden="true" />
            LemmeTeach
          </span>
          <nav className="row" aria-label="Site">
            {connected ? (
              <>
                <button className="btn btn-primary" onClick={onStart}>
                  Start solving
                </button>
              </>
            ) : (
              <>
                <button className="btn-quiet" onClick={onOwnKey}>
                  Use my own API key
                </button>
                <button className="btn-quiet" onClick={onActivate}>
                  I have an access code
                </button>
                <button className="btn btn-primary" onClick={toPricing}>
                  See plans
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">An AI tutor for all subjects</p>
            <h1>
              Stuck on a question? Watch it <em>solved step by step</em>.
            </h1>
            <div
              className="ask-box hero-ask"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const files = filesFrom(e.dataTransfer);
                if (files.length) onAttach(question, files);
              }}
            >
              <textarea
                value={question}
                rows={3}
                aria-label="Your question"
                placeholder="Type your question, or paste a screenshot of it"
                onChange={(e) => setQuestion(e.target.value)}
                onPaste={(e) => {
                  const files = filesFrom(e.clipboardData);
                  if (files.length) {
                    e.preventDefault();
                    onAttach(question, files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask();
                }}
              />
              <div className="ask-actions">
                <button className="btn-quiet small" onClick={onStart}>
                  Attach a file
                </button>
                <span className="dim small ask-hint">
                  {connected ?? 'Any subject, any level. With a plan or your own API key.'}
                </span>
                <button className="btn btn-primary btn-lg" onClick={ask} disabled={!ready}>
                  Solve it
                </button>
              </div>
            </div>
            <div className="row">
              {!connected && (
                <button className="btn-quiet" onClick={onDemo}>
                  Try the demo
                </button>
              )}
              <button className="btn-quiet" onClick={toPricing}>
                See plans
              </button>
            </div>
            <p className="lede">
              Type it, paste a screenshot, or attach the file. LemmeTeach works through it on a
              whiteboard one step at a time and explains each step aloud, the way a teacher
              would. Stop it whenever you want to ask something.
            </p>
            <ul className="assurances">
              <li>Free demo, no sign-up</li>
              {cheapest && (
                <li>
                  From {formatUsd(cheapest.priceUsd)} a month for about {cheapest.lessons} questions
                </li>
              )}
              <li>Cancel any time</li>
            </ul>
          </div>

          {preview && (
            <figure className="hero-figure">
              <div className="hero-board">
                <Board
                  key={preview.key}
                  pages={preview.model.pages}
                  pageIndex={0}
                  theme={theme}
                  subject={preview.subject}
                  reveal={reveal}
                />
              </div>
              <figcaption className="small">
                <strong>{preview.field}</strong>
                <span className="dim"> · {preview.topic}</span>
                <span className="dim hero-note">
                  Example boards, written out the way it writes them while solving.
                </span>
              </figcaption>
            </figure>
          )}
        </section>

        <section className="band" aria-labelledby="how-heading">
          <div className="wide">
            <p className="eyebrow">How it works</p>
            <h2 id="how-heading">From your question to a worked solution</h2>
            <ol className="steps">
              {HOW_IT_GOES.map((item, i) => (
                <li key={item.title}>
                  <span className="step-number mono" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{item.title}</h3>
                  <p className="dim">{item.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="band" aria-labelledby="compare-heading">
          <div className="wide">
            <p className="eyebrow">Why not a video or a chatbot</p>
            <h2 id="compare-heading">A video solves someone else’s question. A chatbot hands you a page of text.</h2>
            <div className="compare-scroll">
              <table className="compare">
                <thead>
                  <tr>
                    <td />
                    <th scope="col">Video course</th>
                    <th scope="col">AI chatbot</th>
                    <th scope="col" className="compare-us">
                      LemmeTeach
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.what}>
                      <th scope="row">{row.what}</th>
                      <td className="dim">{row.video}</td>
                      <td className="dim">{row.chat}</td>
                      <td className="compare-us">{row.us}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="band" aria-labelledby="subjects-heading">
          <div className="wide">
            <p className="eyebrow">Subjects</p>
            <h2 id="subjects-heading">Pick a subject. See how it is taught.</h2>
            <p className="dim" style={{ maxWidth: '62ch' }}>
              A good tutor does not teach chemistry the way they teach history. Neither does this
              one: each subject has its own way of working, and its own kind of board.
            </p>
            <SubjectExplorer boards={explorerBoards} theme={theme} />
            <p className="aside">
              Not on the list? History, geography, English, art, physical education and anything
              else are covered too. You never have to choose: it works out the subject from your
              question.
            </p>
          </div>
        </section>

        <section className="band" aria-labelledby="pricing-heading" ref={pricing} tabIndex={-1}>
          <div className="wide">
            <p className="eyebrow">Plans</p>
            <h2 id="pricing-heading">Pick how much you want to learn</h2>
            <p className="dim" style={{ maxWidth: '62ch' }}>
              Every plan includes every subject, screenshots and file uploads, the voice, and the
              worked solution to keep. They differ only in how many questions a month they cover.
            </p>
            <PlanCards onChoose={onChoose} />
            <div className="own-key-offer">
              <div>
                <h3>Already have an API key?</h3>
                <p className="dim" style={{ marginBottom: 0 }}>
                  Paste a key from {OWN_KEY_PROVIDERS} and use LemmeTeach
                  without a subscription. You pay your provider for what you use, and we charge
                  nothing.
                </p>
              </div>
              <button className="btn" onClick={onOwnKey}>
                Use my own API key
              </button>
            </div>
            <p className="dim small" style={{ marginTop: 18, maxWidth: '70ch' }}>
              Question counts are estimates for a typical worked solution. Unused questions do not
              roll over to the next month. Cancel any time and keep access until the month you paid for
              ends. Tax may be added at checkout, depending on where you live.
            </p>
          </div>
        </section>

        <section className="band" aria-labelledby="questions-heading">
          <div className="wide">
            <p className="eyebrow">Questions</p>
            <h2 id="questions-heading">Before you decide</h2>
            <div className="faq">
              {QUESTIONS.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p className="dim">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="band closing" aria-labelledby="closing-heading">
          <div className="wide">
            <h2 id="closing-heading">See a question solved before you pay for one.</h2>
            <p className="dim">The demo uses the real board, voice and controls. It is free.</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              <button className="btn btn-primary btn-lg" onClick={onDemo}>
                Try the demo
              </button>
              <button className="btn btn-lg" onClick={toPricing}>
                See plans
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="band">
        <div className="wide landing-footer">
          <span className="wordmark">
            <span className="wordmark-mark" aria-hidden="true" />
            LemmeTeach
          </span>
          <span className="dim small">Payments are handled by Paddle, our merchant of record.</span>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The hero board
 * ------------------------------------------------------------------ */

interface Preview {
  key: string;
  model: BoardModel;
  steps: BoardStep[];
  subject: SubjectId;
  field: string;
  topic: string;
}

/** One board per showcase, built the way the tool bus builds one. */
function buildPreviews(): Preview[] {
  const out: Preview[] = [];
  for (const show of SHOWCASES) {
    const model = new BoardModel();
    const result = validateOps(show.board, { knownIds: model.knownIds() });
    if (!result.ok) continue; // A test holds every showcase to the validator.
    model.write({ say: '', ops: result.ops, clear: false });
    const first = model.pages[0];
    if (!first) continue;
    out.push({
      key: `${show.field}:${show.topic}`,
      model,
      steps: first.steps,
      subject: show.subject,
      field: show.field,
      topic: show.topic,
    });
  }
  return out;
}

const WRITE_MS = 480;
const REST_MS = 3200;

/**
 * Write one board out a unit at a time, rest, then move to the next field.
 *
 * The same reveal map the lesson screen drives from narration, driven here
 * from a clock. With reduced motion nothing is animated and nothing rotates:
 * the first board is simply there, fully written.
 */
function useShowcase(previews: Preview[]): { preview: Preview | null; reveal: Map<string, number> } {
  const still = useMemo(() => prefersReducedMotion() || previews.length === 0, [previews]);
  // A board starts with its heading already up, so the frame is never empty.
  const [at, setAt] = useState({ index: 0, written: 1 });

  const preview = previews[at.index % Math.max(1, previews.length)] ?? null;
  const totals = useMemo(
    () => (preview?.steps ?? []).map((s) => s.ops.reduce((n, op) => n + revealUnits(op), 0)),
    [preview],
  );
  const total = totals.reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (still) return;
    const done = at.written >= total;
    const timer = window.setTimeout(
      () =>
        setAt(
          done
            ? { index: (at.index + 1) % previews.length, written: 1 }
            : { index: at.index, written: at.written + 1 },
        ),
      done ? REST_MS : WRITE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [still, at, total, previews.length]);

  const reveal = useMemo(() => {
    const map = new Map<string, number>();
    if (still || !preview) return map;
    let left = at.written;
    preview.steps.forEach((step, i) => {
      const units = totals[i] ?? 0;
      map.set(step.id, Math.min(left, units));
      left = Math.max(0, left - units);
    });
    return map;
  }, [still, preview, at.written, totals]);

  return { preview, reveal };
}
