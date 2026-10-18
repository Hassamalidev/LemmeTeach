/**
 * The box under the board (§15).
 *
 * One place to ask from, always there: type a question or say it. The moment
 * the learner starts, the explanation stops, and it stays stopped until they
 * send the question or empty the box. The playback controls sit in the same
 * box so the board keeps the rest of the screen.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { listenOnce, recognitionAvailable } from '../voice/recognition';

export function Composer({
  disabled,
  engaged,
  placeholder,
  note,
  prompt,
  controls,
  focusSignal,
  onEngage,
  onRelease,
  onAsk,
}: {
  /** Nothing can be asked right now: still reading, or stopped on an error. */
  disabled: boolean;
  /** The explanation is being held for this box. */
  engaged: boolean;
  placeholder: string;
  /** Something the learner should know before asking, shown while they write. */
  note?: string;
  /** A choice the learner is being offered, shown above the box. */
  prompt?: ReactNode;
  /** The playback controls, on the left of the bottom row. */
  controls: ReactNode;
  /** Changes when something outside wants the box focused. */
  focusSignal: number;
  onEngage: () => void;
  onRelease: () => void;
  onAsk: (question: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef<{ stop: () => void } | null>(null);
  const textRef = useRef('');
  textRef.current = text;

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  // A microphone must never outlive the screen.
  useEffect(() => () => stopRef.current?.stop(), []);

  // The box grows with what is written, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const change = (value: string): void => {
    setText(value);
    if (value.trim() && !engaged) onEngage();
    if (!value.trim() && engaged && !listening) onRelease();
  };

  const send = (): void => {
    const question = text.trim();
    if (!question || disabled) return;
    stopRef.current?.stop();
    setListening(false);
    setText('');
    onAsk(question);
  };

  const dictate = (): void => {
    if (listening) {
      stopRef.current?.stop();
      setListening(false);
      return;
    }
    const handle = listenOnce(
      (heard) => setText(heard),
      () => {
        setListening(false);
        // Nothing was heard: let the explanation carry on.
        if (!textRef.current.trim()) onRelease();
      },
    );
    if (handle) {
      stopRef.current = handle;
      setListening(true);
      onEngage();
      inputRef.current?.focus();
    }
  };

  return (
    <div className="dock">
      {prompt && !engaged && <div className="dock-prompt">{prompt}</div>}
      {engaged && (
        <p className="dock-hint small" role="status">
          {listening
            ? 'Listening. Say your question, then send it.'
            : (note ?? 'The explanation is paused. Send your question, or clear the box to carry on.')}
        </p>
      )}
      <div className={`composer ${engaged ? 'engaged' : ''}`}>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          disabled={disabled}
          aria-label="Ask a question"
          placeholder={placeholder}
          onChange={(e) => change(e.target.value)}
          onBlur={() => {
            if (!textRef.current.trim() && engaged && !listening) onRelease();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === 'Escape') {
              stopRef.current?.stop();
              setListening(false);
              setText('');
              onRelease();
              e.currentTarget.blur();
            }
          }}
        />
        <div className="composer-row">
          <div className="composer-controls">{controls}</div>
          <div className="composer-send">
            {recognitionAvailable() && (
              <button
                className={`icon-btn ${listening ? 'on' : ''}`}
                onClick={dictate}
                disabled={disabled}
                aria-label={listening ? 'Stop listening' : 'Ask by voice'}
                title={listening ? 'Stop listening' : 'Ask by voice'}
              >
                {listening ? '●' : '🎤'}
              </button>
            )}
            <button
              className="icon-btn send"
              onClick={send}
              disabled={disabled || !text.trim()}
              aria-label="Send question"
              title="Send (Enter)"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
