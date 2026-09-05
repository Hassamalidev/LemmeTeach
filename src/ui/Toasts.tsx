/**
 * Short-lived notices.
 *
 * Used only for things the learner must be told but need not act on: a
 * document evicted to stay under the cap, Pyodide loading, storage
 * unavailable. Never for errors that need a decision — those go inline where
 * the decision is made.
 */
import { useCallback, useState } from 'react';
import { uid } from '../core/types';

export interface Toast {
  id: string;
  message: string;
}

export function useToasts(): {
  items: Toast[];
  push: (message: string) => void;
  dismiss: (id: string) => void;
} {
  const [items, setItems] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string) => {
      const id = uid('toast');
      setItems((list) => [...list.slice(-3), { id, message }]);
      window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  return { items, push, dismiss };
}

export function Toasts({
  items,
  dismiss,
}: {
  items: Toast[];
  dismiss: (id: string) => void;
}): JSX.Element | null {
  if (!items.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(560px, calc(100vw - 32px))',
      }}
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div key={t.id} className="notice" style={{ marginBottom: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span className="small">{t.message}</span>
            <button className="btn-quiet small" onClick={() => dismiss(t.id)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
