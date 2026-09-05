/**
 * One question, waiting for a real answer (§9.2).
 *
 * The lesson is genuinely stopped behind this panel. Skip is offered plainly
 * rather than hidden, because a learner who cannot answer and cannot move on
 * will close the tab, and a skip is honest data where a guess is not.
 */
import { useEffect, useRef, useState } from 'react';
import type { AskQuestion } from '../tools/context';
import { listenOnce, recognitionAvailable } from '../voice/recognition';

export function AskPanel({
  question,
  onAnswer,
  onSkip,
}: {
  question: AskQuestion;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => stopRef.current?.stop();
  }, []);

  const dictate = (): void => {
    if (listening) {
      stopRef.current?.stop();
      setListening(false);
      return;
    }
    const handle = listenOnce(
      (heard) => setText(heard),
      () => setListening(false),
    );
    if (handle) {
      stopRef.current = handle;
      setListening(true);
    }
  };

  return (
    <div className="ask-overlay" role="dialog" aria-modal="true" aria-label="A question for you">
      <div className="ask-panel">
        <h2>{question.question}</h2>

        {question.kind === 'choice' && question.options ? (
          <div>
            {question.options.map((option, i) => (
              <button
                key={i}
                className="option"
                onClick={() => onAnswer(option)}
                autoFocus={i === 0}
              >
                <span className="key" aria-hidden="true">
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{option}</span>
              </button>
            ))}
          </div>
        ) : question.kind === 'confirm' ? (
          <div className="row">
            <button className="btn btn-primary" onClick={() => onAnswer('yes')} autoFocus>
              Yes
            </button>
            <button className="btn" onClick={() => onAnswer('no')}>
              No
            </button>
          </div>
        ) : (
          <div>
            <input
              ref={inputRef}
              type={question.kind === 'number' ? 'number' : 'text'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim()) onAnswer(text.trim());
              }}
              placeholder={
                question.kind === 'number' ? 'A number' : 'In your own words — a guess is fine'
              }
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                onClick={() => onAnswer(text.trim())}
                disabled={!text.trim()}
              >
                Answer
              </button>
              {recognitionAvailable() && (
                <button className="btn" onClick={dictate}>
                  {listening ? '● Listening — stop' : '🎤 Speak'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
          <button className="btn-quiet" onClick={onSkip}>
            Skip this one
          </button>
          <span className="dim small">
            {question.kind === 'free'
              ? 'There is no time limit. Say what you actually think.'
              : 'No time limit.'}
          </span>
        </div>
      </div>
    </div>
  );
}
