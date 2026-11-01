/**
 * The main screen (§15): what do you want solved?
 *
 * One box. Type the question, paste a screenshot of it, or attach the file it
 * is in, and press Solve. There is no subject to pick and no level to set —
 * the question itself says what it is.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Plan } from '../../shared/plans';
import type { Credit } from '../providers/managed';
import type { Attachment } from '../providers/types';
import { SUBJECT_LABELS, type SubjectId } from '../core/types';
import type { SolutionRecord } from '../storage/records';
import { allLessons } from '../storage/db';
import type { Settings } from '../storage/settings';
import { MAX_ATTACHMENTS, filesFrom, readAttachment } from '../solve/attachments';
import { canReplay, findSolved } from '../providers/replay';
import { DEMO_EXAMPLES } from '../solve/examples';
import { TYPICAL_LESSON_USD } from '../../shared/plans';
import { PlanLine } from './PlanLine';
import { SubjectGlyph } from './SubjectGlyph';
import { VoicePicker } from './VoicePicker';

export interface SolveRequest {
  question: string;
  attachments: Attachment[];
  /** Set only in the demo, where the walkthrough is chosen by subject. */
  demoSubject?: SubjectId;
}

export function Solve({
  settings,
  plan,
  credit,
  onUpdateSettings,
  onSolve,
  onReplay,
  onSeePlans,
  onOwnKey,
  onOpenSettings,
  onHome,
  draft,
}: {
  /** Carried over from the home page. */
  draft: { question: string; files: File[] } | null;
  /** Back to the home page. */
  onHome: () => void;
  /** Play back a question that has already been solved, at no cost. */
  onReplay: (record: SolutionRecord) => void;
  onOwnKey: () => void;
  settings: Settings;
  /** The subscriber's plan, or null in the demo. */
  plan: Plan | null;
  credit: Credit | null;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onSolve: (request: SolveRequest) => void;
  onSeePlans: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const ownKey = plan === null ? settings.ownKey : null;
  const demo = plan === null && ownKey === null;
  const [example, setExample] = useState(0);
  const [question, setQuestion] = useState(() =>
    demo ? (DEMO_EXAMPLES[0]?.question ?? '') : (draft?.question ?? ''),
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recent, setRecent] = useState<SolutionRecord[]>([]);
  const [history, setHistory] = useState<SolutionRecord[]>([]);
  /** A saved solution to the question in the box, offered before paying again. */
  const [solvedBefore, setSolvedBefore] = useState<SolutionRecord | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void allLessons().then((l) => {
      setHistory(l);
      setRecent(l.slice(0, 5));
      // Asked from the home page, and solved before: offer it before spending anything.
      if (draft?.question) setSolvedBefore(findSolved(draft.question, l));
    });
    // Runs once, for what was carried over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(
    async (files: File[]) => {
      if (demo || files.length === 0) return;
      setProblem(null);
      const next: Attachment[] = [];
      let extraText = '';
      for (const file of files) {
        const read = await readAttachment(file);
        if (!read.ok) {
          setProblem(read.message);
          continue;
        }
        if ('attachment' in read) next.push(read.attachment);
        else extraText += `\n\n[From ${read.name}]\n${read.text}`;
      }
      if (extraText) setQuestion((q) => (q + extraText).trim());
      setAttachments((current) => {
        const merged = [...current, ...next];
        if (merged.length > MAX_ATTACHMENTS) {
          setProblem(`It reads up to ${MAX_ATTACHMENTS} attachments at once, so the rest were left out.`);
        }
        return merged.slice(0, MAX_ATTACHMENTS);
      });
    },
    [demo],
  );

  const carried = useRef(false);
  useEffect(() => {
    if (draft?.files.length && !carried.current) {
      carried.current = true;
      void add(draft.files);
    }
  }, [draft, add]);

  // The pre-flight check (§18): do not start something that will be cut off.
  const left = !demo && credit ? credit.remainingUsd : null;
  const outOfCredit = left !== null && left <= 0;
  const lowCredit = left !== null && left > 0 && left < TYPICAL_LESSON_USD;

  const ready = (question.trim().length >= 3 || attachments.length > 0) && !outOfCredit;

  const solve = (again = false): void => {
    if (!ready) return;
    // The cheapest question is one that is not sent at all. If this exact
    // question has been solved on this device, offer to play that back first.
    if (!again && !demo && attachments.length === 0) {
      const match = findSolved(question, history);
      if (match) {
        setSolvedBefore(match);
        return;
      }
    }
    setSolvedBefore(null);
    onSolve({
      question: question.trim(),
      attachments,
      demoSubject: demo ? DEMO_EXAMPLES[example]?.subject : undefined,
    });
  };

  return (
    <div className="screen">
      <div className="centered solve">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
          <button className="wordmark wordmark-link" onClick={onHome} aria-label="LemmeTeach home page">
            <span className="wordmark-mark" aria-hidden="true" />
            LemmeTeach
          </button>
          <button className="btn-quiet" onClick={onOpenSettings}>
            Settings
          </button>
        </div>

        <h1>What do you want solved?</h1>
        <p className="lede">
          Type the question, paste a screenshot of it, or attach the file it is in. It is worked
          through on a board, one step at a time, and explained aloud.
        </p>

        {demo ? (
          <div className="notice">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>This is the demo.</strong>{' '}
                <span className="dim">
                  It solves these {DEMO_EXAMPLES.length} prepared questions. With a plan, or your
                  own API key, you bring your own, in any subject.
                </span>
              </span>
              <span className="row">
                <button className="btn" onClick={onSeePlans}>
                  See plans
                </button>
                <button className="btn" onClick={onOwnKey}>
                  Use my own API key
                </button>
              </span>
            </div>
          </div>
        ) : ownKey ? (
          <div className="plan-line">
            <strong>Using your own {ownKey.label} key.</strong>{' '}
            <span className="dim">
              You pay {ownKey.label} directly for what you use. Remove the key in Settings.
            </span>
          </div>
        ) : (
          plan && (
            <PlanLine plan={plan} credit={credit} quality={settings.quality} onSeePlans={onSeePlans} />
          )
        )}

        {demo && (
          <div className="row" role="group" aria-label="Example questions" style={{ marginBottom: 12 }}>
            {DEMO_EXAMPLES.map((e, i) => (
              <button
                key={e.subject}
                className={`explorer-tab example-chip ${i === example ? 'active' : ''}`}
                aria-pressed={i === example}
                onClick={() => {
                  setExample(i);
                  setQuestion(e.question);
                }}
              >
                <SubjectGlyph subject={e.subject} size={18} />
                <span>{e.label}</span>
              </button>
            ))}
          </div>
        )}

        <div
          className={`ask-box ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            if (demo) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (demo) return;
            e.preventDefault();
            setDragging(false);
            void add(filesFrom(e.dataTransfer));
          }}
        >
          <textarea
            value={question}
            readOnly={demo}
            rows={5}
            autoFocus={!demo}
            aria-label="Your question"
            onChange={(e) => {
              setQuestion(e.target.value);
              setSolvedBefore(null);
            }}
            onPaste={(e) => {
              const files = filesFrom(e.clipboardData);
              if (files.length) {
                e.preventDefault();
                void add(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) solve();
            }}
            placeholder="For example: a block slides down a 30 degree slope with friction coefficient 0.2. Find its acceleration."
          />

          {attachments.length > 0 && (
            <ul className="attachments">
              {attachments.map((a, i) => (
                <li key={`${a.name}-${i}`} className="attachment">
                  {a.kind === 'image' ? (
                    <img src={a.dataUrl} alt="" />
                  ) : (
                    <span className="attachment-file mono" aria-hidden="true">
                      PDF
                    </span>
                  )}
                  <span className="attachment-name">{a.name}</span>
                  <button
                    className="btn-quiet small"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="ask-actions">
            <input
              ref={picker}
              type="file"
              hidden
              multiple
              accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.tex"
              aria-label="Attach a file"
              onChange={(e) => {
                void add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button className="btn" disabled={demo} onClick={() => picker.current?.click()}>
              Attach a file
            </button>
            <span className="dim small ask-hint">
              {demo
                ? 'Pasting screenshots and attaching files work with a plan or your own key.'
                : 'Or paste a screenshot with Ctrl+V, or drop a file here. Images, PDFs and text.'}
            </span>
            <button className="btn btn-primary btn-lg" onClick={() => solve()} disabled={!ready}>
              Solve it
            </button>
          </div>
        </div>

        {problem && (
          <div className="notice notice-warn" role="alert">
            {problem}
          </div>
        )}

        {solvedBefore && (
          <div className="notice" role="status">
            <strong>You had this solved {relativeDay(solvedBefore.startedAt)}.</strong>{' '}
            <span className="dim">Playing it back is free. Solving it again uses a question.</span>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={() => onReplay(solvedBefore)}>
                Replay it, free
              </button>
              <button className="btn" onClick={() => solve(true)}>
                Solve it again
              </button>
            </div>
          </div>
        )}

        {(outOfCredit || lowCredit) && (
          <div className="notice notice-warn" role="status">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {outOfCredit
                  ? 'You have used this month’s credit. It renews with your next payment.'
                  : 'There is not much credit left, so a long solution may stop early.'}
              </span>
              <button className="btn" onClick={onSeePlans}>
                See bigger plans
              </button>
            </div>
          </div>
        )}

        <VoicePicker
          voiceName={settings.voiceName}
          rate={settings.rate}
          muted={settings.muted}
          onChange={onUpdateSettings}
        />

        <p className="dim small" style={{ marginTop: 18 }}>
          You can stop it at any point while it is solving and ask your own question. It
          answers, then carries on where it left off.
        </p>

        {recent.length > 0 && (
          <section style={{ marginTop: 36 }}>
            <h2>Recently solved</h2>
            <p className="dim small">Playing one back uses no credit.</p>
            <div className="list">
              {recent.map((l) => (
                <div key={l.id} className="list-item">
                  <div style={{ minWidth: 0 }}>
                    <div>{l.title}</div>
                    <div className="dim small">
                      {SUBJECT_LABELS[l.subject]} · {relativeDay(l.startedAt)}
                    </div>
                  </div>
                  {canReplay(l) && (
                    <button
                      className="btn-quiet small"
                      onClick={() => onReplay(l)}
                      aria-label={`Replay ${l.title}, free`}
                    >
                      Replay, free
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function relativeDay(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
