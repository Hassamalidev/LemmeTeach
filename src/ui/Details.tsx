/**
 * The Details drawer (§15).
 *
 * The real trace, for anyone who wants it: turn number, tool calls, arguments,
 * results, token usage. It is a drawer rather than the main view because raw
 * tool JSON in front of a learner is noise — but hiding a failure inside a
 * spinner is worse, so nothing here is filtered out.
 */
import { useEffect, useState } from 'react';
import type { Trace, TraceEntry } from '../runtime/trace';

export function Details({ trace, onClose }: { trace: Trace; onClose: () => void }): JSX.Element {
  const [entries, setEntries] = useState<readonly TraceEntry[]>(() => trace.all());

  useEffect(() => trace.subscribe(() => setEntries([...trace.all()])), [trace]);

  const download = (): void => {
    // Scrubbed on the way out: no key, in any form (§19).
    const blob = new Blob([trace.toExport()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chalk-trace-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="drawer">
      <header>
        <strong>Details</strong>
        <div className="row">
          <button className="btn-quiet small" onClick={download}>
            Export trace
          </button>
          <button className="btn-quiet" onClick={onClose} aria-label="Close details">
            ✕
          </button>
        </div>
      </header>
      <div className="body">
        {entries.length === 0 && <p className="dim small">Nothing has happened yet.</p>}
        {[...entries].reverse().map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: TraceEntry }): JSX.Element {
  const bad = entry.t === 'error' || (entry.t === 'tool_result' && !entry.ok);
  return (
    <div className={`trace-entry ${bad ? 'bad' : ''}`}>
      <span className="tag">{label(entry)}</span>
      <span>{body(entry)}</span>
    </div>
  );
}

function label(e: TraceEntry): string {
  switch (e.t) {
    case 'turn':
      return `turn ${e.turn}`;
    case 'tool_call':
      return '→';
    case 'tool_result':
      return e.ok ? '←' : '← failed';
    case 'phase':
      return 'phase';
    case 'usage':
      return 'tokens';
    case 'error':
      return e.error.kind;
    case 'text':
      return 'said';
    case 'note':
      return 'note';
  }
}

function body(e: TraceEntry): string {
  switch (e.t) {
    case 'turn':
      return `${e.agent} · ${e.model}`;
    case 'tool_call':
      return `${e.name} ${preview(e.input)}`;
    case 'tool_result':
      return `${e.name} · ${e.ms}ms · ${e.content.slice(0, 220)}`;
    case 'phase':
      return `${e.from} → ${e.to}`;
    case 'usage':
      return `${e.inputTokens} in, ${e.outputTokens} out`;
    case 'error':
      return e.error.message + (e.error.detail ? ` — ${e.error.detail.slice(0, 200)}` : '');
    case 'text':
      return e.text.slice(0, 200);
    case 'note':
      return e.message;
  }
}

function preview(input: unknown): string {
  try {
    const json = JSON.stringify(input);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return '';
  }
}
