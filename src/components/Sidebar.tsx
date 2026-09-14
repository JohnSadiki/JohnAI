import type { Session } from '../lib/types';

type Props = {
  open: boolean;
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenCapabilities: () => void;
  onClose: () => void;
  health: 'unknown' | 'ok' | 'error';
};

export function Sidebar({
  open,
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
  onOpenCapabilities,
  onClose,
  health,
}: Props) {
  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="logo-mark">J</div>
          <div>
            <div className="brand-name">JohnAI</div>
            <div className={`health-pill ${health}`}>
              {health === 'ok' ? 'Hermes connected' : health === 'error' ? 'Hermes offline' : 'Checking…'}
            </div>
          </div>
        </div>

        <button className="primary-btn full" onClick={onNew}>
          New chat
        </button>

        <div className="session-list">
          {sessions.length === 0 && <p className="muted small">No chats yet</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => {
                onSelect(s.id);
                onClose();
              }}
            >
              <div className="session-title">{s.title || 'New chat'}</div>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="ghost-btn full" onClick={onOpenCapabilities}>
            Capabilities
          </button>
          <button className="ghost-btn full" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </aside>
    </>
  );
}
