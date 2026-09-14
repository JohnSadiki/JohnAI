import { useState } from 'react';
import type { JohnAISettings } from '../lib/settings';

type Props = {
  open: boolean;
  value: JohnAISettings;
  onClose: () => void;
  onSave: (s: JohnAISettings) => void;
};

export function SettingsModal({ open, value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(value);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="muted">JohnAI talks to your local Hermes agent. Keys stay in this browser only.</p>

        <label>
          Display name
          <input
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            placeholder="You"
          />
        </label>

        <label>
          Hermes base URL
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="http://127.0.0.1:8642"
          />
        </label>

        <label>
          API server key
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="API_SERVER_KEY from Hermes .env"
            autoComplete="off"
          />
        </label>

        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
