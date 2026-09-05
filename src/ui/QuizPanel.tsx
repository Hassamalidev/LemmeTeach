/**
 * A scored check (§9.3).
 *
 * Answers are shown with the reason once the check is submitted, because the
 * moment right after committing to an answer is when an explanation actually
 * lands. The score is not shown as a mark out of ten — what matters is which
 * one they got wrong and why, not the number.
 */
import { useState } from 'react';
import type { QuizQuestion } from '../tools/context';

export function QuizPanel({
  questions,
  onSubmit,
}: {
  questions: QuizQuestion[];
  onSubmit: (chosen: number[]) => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<number[]>(() => questions.map(() => -1));
  const [revealed, setRevealed] = useState(false);

  const answeredCount = chosen.filter((c) => c >= 0).length;

  return (
    <div className="ask-overlay" role="dialog" aria-modal="true" aria-label="A quick check">
      <div className="ask-panel">
        <h2>
          {revealed
            ? 'Here is how that went'
            : `A quick check — ${questions.length} question${questions.length === 1 ? '' : 's'}`}
        </h2>

        {questions.map((q, qi) => (
          <div key={qi} className="quiz-question">
            <p style={{ fontWeight: 600 }}>{q.q}</p>

            {q.options.map((option, oi) => {
              const picked = chosen[qi] === oi;
              const isCorrect = q.answer === oi;
              const className = revealed
                ? isCorrect
                  ? 'option correct'
                  : picked
                    ? 'option wrong'
                    : 'option'
                : picked
                  ? 'option selected'
                  : 'option';

              return (
                <button
                  key={oi}
                  className={className}
                  disabled={revealed}
                  onClick={() =>
                    setChosen((prev) => prev.map((c, i) => (i === qi ? oi : c)))
                  }
                >
                  <span className="key" aria-hidden="true">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}

            {revealed && <div className="why">{q.why}</div>}
          </div>
        ))}

        <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}>
          {revealed ? (
            <button className="btn btn-primary" onClick={() => onSubmit(chosen)} autoFocus>
              Carry on
            </button>
          ) : (
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={() => setRevealed(true)}
                disabled={answeredCount === 0}
              >
                Check
              </button>
              <button
                className="btn-quiet"
                onClick={() => onSubmit(questions.map(() => -1))}
              >
                Skip all
              </button>
            </div>
          )}
          {!revealed && (
            <span className="dim small">
              {answeredCount} of {questions.length} answered
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
