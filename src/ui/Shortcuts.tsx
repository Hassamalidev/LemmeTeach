/**
 * The shortcut sheet, opened with "?".
 */
const KEYS: [string, string][] = [
  ['Space', 'Pause or resume'],
  ['←  →', 'Previous or next step'],
  ['R', 'Replay this step'],
  ['H', 'Stop and ask a question'],
  ['M', 'Mute or unmute the voice'],
  ['?', 'This list'],
  ['Esc', 'Stop altogether'],
];

export function Shortcuts({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="ask-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="ask-panel" style={{ maxWidth: 420 }}>
        <h2>Keyboard</h2>
        <div className="shortcuts">
          {KEYS.map(([key, what]) => (
            <div key={key} style={{ display: 'contents' }}>
              <kbd>{key}</kbd>
              <span>{what}</span>
            </div>
          ))}
        </div>
        <p className="dim small" style={{ marginTop: 18 }}>
          Every control is also reachable with Tab.
        </p>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  );
}
