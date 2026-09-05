/**
 * The transcript (§14).
 *
 * Carries the narration as text, which is what makes muted mode fully usable
 * rather than a degraded one — and what a screen reader reads while the board
 * is being drawn.
 */
import { useEffect, useRef } from 'react';

export function Transcript({
  lines,
  currentStepId,
  onClose,
}: {
  lines: { stepId: string; say: string; at: number }[];
  currentStepId: string | null;
  onClose: () => void;
}): JSX.Element {
  const currentRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentStepId]);

  return (
    <div className="drawer">
      <header>
        <strong>Transcript</strong>
        <button className="btn-quiet" onClick={onClose} aria-label="Close transcript">
          ✕
        </button>
      </header>
      <div className="body">
        {lines.length === 0 && <p className="dim small">Nothing has been said yet.</p>}
        {lines.map((line) => (
          <p
            key={line.stepId}
            ref={line.stepId === currentStepId ? currentRef : undefined}
            className={`transcript-line ${line.stepId === currentStepId ? 'current' : ''}`}
          >
            {line.say}
          </p>
        ))}
      </div>
    </div>
  );
}
