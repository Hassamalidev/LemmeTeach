/**
 * Material upload (§13).
 *
 * The privacy line is on the screen where the decision is made, not buried in
 * settings: this is the moment someone hands over their own notes, and it is
 * the moment they deserve to be told where those notes go.
 */
import { useRef, useState } from 'react';
import { materialsStore } from '../materials/store';
import type { MaterialDoc } from '../memory/types';

export function Materials({
  docs,
  onChange,
}: {
  docs: MaterialDoc[];
  onChange: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const ingest = async (file: File | { name: string; text: string }): Promise<void> => {
    setError(null);
    setBusy('Reading…');
    try {
      await materialsStore.ingest(file, (p) => setBusy(p.message));
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {error && (
        <div className="notice notice-error">
          <span className="small">{error}</span>
        </div>
      )}

      {docs.length > 0 && (
        <div className="list" style={{ marginBottom: 16 }}>
          {docs.map((d) => (
            <div key={d.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <div>{d.title}</div>
                <div className="dim small">
                  {d.pageCount} page{d.pageCount === 1 ? '' : 's'} · {d.chunks.length} passages ·{' '}
                  {(d.bytes / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                className="btn-quiet small"
                onClick={async () => {
                  await materialsStore.remove(d.id);
                  onChange();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void ingest(file);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          {busy ?? 'Add a file'}
        </button>
        <button className="btn" onClick={() => setPasting((p) => !p)} disabled={busy !== null}>
          Paste text
        </button>
        <span className="dim small">
          .txt, .md or .pdf. Nothing is uploaded — parsing happens in this tab, and only the
          passages a lesson actually retrieves are sent to the model your key pays for.
        </span>
      </div>

      {pasting && (
        <div style={{ marginTop: 14 }}>
          <textarea
            rows={7}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste your notes here"
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary"
              disabled={pasted.trim().length < 40 || busy !== null}
              onClick={async () => {
                await ingest({ name: 'Pasted notes', text: pasted });
                setPasted('');
                setPasting(false);
              }}
            >
              Add
            </button>
            <button className="btn-quiet" onClick={() => setPasting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
