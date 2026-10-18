/**
 * Choosing the voice (§14).
 *
 * A device can list a hundred voices, most of them for other languages and
 * several of them robotic. This shows the handful worth choosing between —
 * the clearest ones for the learner's language, best first — and lets them
 * hear one before a lesson starts rather than discovering it mid-explanation.
 */
import { useEffect, useMemo, useState } from 'react';
import { bestVoices, loadVoices, previewVoice, speechAvailable, voiceLabel } from '../voice/speech';

export function VoicePicker({
  voiceName,
  rate,
  muted,
  onChange,
}: {
  voiceName: string | null;
  rate: number;
  muted: boolean;
  onChange: (patch: { voiceName?: string | null; muted?: boolean }) => void;
}): JSX.Element | null {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    let live = true;
    void loadVoices().then((v) => {
      if (live) setVoices(v);
    });
    return () => {
      live = false;
    };
  }, []);

  const choices = useMemo(() => bestVoices(voices), [voices]);
  const current = choices.find((v) => v.name === voiceName) ?? choices[0] ?? null;

  if (!speechAvailable()) {
    return (
      <p className="dim small" style={{ marginBottom: 0 }}>
        This browser cannot speak, so each step will be shown as text beside the board instead.
      </p>
    );
  }

  return (
    <div className="voice-picker">
      <label className="voice-field">
        <span className="dim small">Voice</span>
        <select
          value={muted ? '__off' : (current?.name ?? '')}
          onChange={(e) => {
            if (e.target.value === '__off') onChange({ muted: true });
            else onChange({ muted: false, voiceName: e.target.value || null });
          }}
        >
          {choices.length === 0 && <option value="">Default voice</option>}
          {choices.map((v) => (
            <option key={v.name} value={v.name}>
              {voiceLabel(v)}
            </option>
          ))}
          <option value="__off">No voice, text only</option>
        </select>
      </label>
      <button
        className="btn"
        disabled={muted}
        onClick={() => previewVoice(current, rate)}
      >
        Hear it
      </button>
    </div>
  );
}
