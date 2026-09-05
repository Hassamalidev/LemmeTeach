/**
 * Raise hand (§15).
 *
 * Speech is already cancelled by the caller before this mounts, so the
 * interruption is immediate rather than waiting for a sentence to finish.
 * Voice input appears where the browser supports it and is silently absent
 * where it does not.
 */
import { useEffect, useRef, useState } from 'react';
import { listenOnce, recognitionAvailable } from '../voice/recognition';

export function RaiseHand({
  onAsk,
  onCancel,
}: {
  onAsk: (question: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    <div className="ask-overlay" role="dialog" aria-modal="true" aria-label="Ask a question">
      <div className="ask-panel">
        <h2>What would you like to ask?</h2>
        <textarea
          ref={inputRef}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault();
              onAsk(text.trim());
            }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Anything — go back a step, explain that differently, why does that work…"
        />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <div className="row">
            <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onAsk(text.trim())}>
              Ask
            </button>
            {recognitionAvailable() && (
              <button className="btn" onClick={dictate}>
                {listening ? '● Listening — stop' : '🎤 Speak'}
              </button>
            )}
          </div>
          <button className="btn-quiet" onClick={onCancel}>
            Never mind
          </button>
        </div>
        <p className="dim small" style={{ marginTop: 12, marginBottom: 0 }}>
          The tutor will answer this as an aside and then pick up where it left off.
        </p>
      </div>
    </div>
  );
}
