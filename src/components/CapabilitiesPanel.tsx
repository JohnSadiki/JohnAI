import type { SkillInfo, ToolsetInfo } from '../lib/types';

type Props = {
  open: boolean;
  loading: boolean;
  error?: string;
  skills: SkillInfo[];
  toolsets: ToolsetInfo[];
  capabilities?: unknown;
  onClose: () => void;
  onRefresh: () => void;
};

export function CapabilitiesPanel({
  open,
  loading,
  error,
  skills,
  toolsets,
  capabilities,
  onClose,
  onRefresh,
}: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Hermes capabilities</h2>
          <button className="ghost-btn" onClick={onRefresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <section>
          <h3>Toolsets</h3>
          <div className="chip-grid">
            {toolsets.map((t) => (
              <div key={t.name} className={`chip ${t.enabled === false ? 'dim' : ''}`}>
                <strong>{t.label || t.name}</strong>
                <span>{t.tools?.length ?? 0} tools</span>
              </div>
            ))}
            {!loading && toolsets.length === 0 && <p className="muted">No toolsets loaded</p>}
          </div>
        </section>
        <section>
          <h3>Skills</h3>
          <div className="chip-grid">
            {skills.map((s) => (
              <div key={s.name} className="chip">
                <strong>{s.name}</strong>
                <span>{s.description || s.category || 'skill'}</span>
              </div>
            ))}
            {!loading && skills.length === 0 && <p className="muted">No skills listed</p>}
          </div>
        </section>
        {capabilities != null && (
          <section>
            <h3>Raw capabilities</h3>
            <pre className="code-block small">{JSON.stringify(capabilities, null, 2)}</pre>
          </section>
        )}
        <div className="modal-actions">
          <button className="primary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
