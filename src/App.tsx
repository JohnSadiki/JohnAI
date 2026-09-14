import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './components/Markdown';
import {
  loadSettings,
  loadRuntimeConfig,
  saveSettings,
  type JohnAISettings,
} from './lib/settings';
import {
  approveRun,
  checkHealth,
  createRemoteSession,
  deleteRemoteSession,
  fetchCapabilities,
  fetchModelOptions,
  fetchSkills,
  fetchToolsets,
  forkSession,
  healthDetailed,
  listRemoteSessions,
  lockSessionModel,
  sessionMessages,
  steerRun,
  stopRun,
  streamChatCompletions,
  streamSessionChat,
} from './lib/hermes';
import './App.css';

type Page = 'chat' | 'models' | 'skills' | 'tools' | 'sessions' | 'status' | 'settings';

type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: number };
type ToolEvent = { id: string; name: string; status: string; detail?: string; at: number };
type LocalSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  toolEvents: ToolEvent[];
  updatedAt: number;
  hermesSessionId?: string;
};

const SESSIONS_KEY = 'johnai.sessions.v1';
const MODEL_KEY = 'johnai.model.v1';

function uid() {
  return crypto.randomUUID();
}

function loadLocalSessions(): LocalSession[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function titleFrom(text: string) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || 'New chat';
}

type PickedModel = { provider: string; model: string };

export default function App() {
  const [settings, setSettings] = useState<JohnAISettings>(() => loadSettings());
  const [page, setPage] = useState<Page>('chat');
  const [sessions, setSessions] = useState<LocalSession[]>(() => loadLocalSessions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [health, setHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [skills, setSkills] = useState<any[]>([]);
  const [toolsets, setToolsets] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>();
  const [detailed, setDetailed] = useState<any>();
  const [modelOptions, setModelOptions] = useState<any>();
  const [remoteSessions, setRemoteSessions] = useState<any[]>([]);
  const [picked, setPicked] = useState<PickedModel>(() => {
    try {
      return JSON.parse(localStorage.getItem(MODEL_KEY) || 'null') || { provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' };
    } catch {
      return { provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' };
    }
  });
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; message: string; raw?: unknown } | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [steerText, setSteerText] = useState('');
  const [loadingPanel, setLoadingPanel] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

  useEffect(() => {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem(MODEL_KEY, JSON.stringify(picked));
  }, [picked]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages, active?.toolEvents, busy]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4200);
  };

  const refreshHealth = useCallback(async () => {
    const res = await checkHealth(settings.baseUrl);
    setHealth(res.ok ? 'ok' : 'error');
  }, [settings.baseUrl]);

  useEffect(() => {
    void refreshHealth();
    const t = window.setInterval(() => void refreshHealth(), 20000);
    return () => window.clearInterval(t);
  }, [refreshHealth]);

  useEffect(() => {
    void loadRuntimeConfig().then((cfg) => {
      if (!cfg.baseUrl) return;
      setSettings((prev) => {
        const next = { ...prev, baseUrl: cfg.baseUrl! };
        saveSettings(next);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (!settings.apiKey) setPage('settings');
  }, []);

  const updateSession = (id: string, patch: Partial<LocalSession> | ((s: LocalSession) => LocalSession)) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return typeof patch === 'function' ? patch(s) : { ...s, ...patch, updatedAt: Date.now() };
      }),
    );
  };

  const ensureSession = (): LocalSession => {
    if (active) return active;
    const s: LocalSession = { id: uid(), title: 'New chat', messages: [], toolEvents: [], updatedAt: Date.now() };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    return s;
  };

  const newChat = () => {
    const s: LocalSession = { id: uid(), title: 'New chat', messages: [], toolEvents: [], updatedAt: Date.now() };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setPage('chat');
    setSidebarOpen(false);
  };

  const deleteChat = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const loadManagement = async (which: Page) => {
    if (!settings.apiKey) {
      setPage('settings');
      showToast('Add your Hermes API key in Settings');
      return;
    }
    setLoadingPanel(true);
    try {
      if (which === 'skills') setSkills(await fetchSkills(settings.baseUrl, settings.apiKey));
      if (which === 'tools') setToolsets(await fetchToolsets(settings.baseUrl, settings.apiKey));
      if (which === 'models') setModelOptions(await fetchModelOptions(settings.baseUrl, settings.apiKey));
      if (which === 'status') {
        setCapabilities(await fetchCapabilities(settings.baseUrl, settings.apiKey));
        setDetailed(await healthDetailed(settings.baseUrl, settings.apiKey).catch(() => null));
      }
      if (which === 'sessions') {
        const data: any = await listRemoteSessions(settings.baseUrl, settings.apiKey);
        const list = Array.isArray(data) ? data : data.sessions || data.items || [];
        setRemoteSessions(list);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoadingPanel(false);
    }
  };

  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
    if (['skills', 'tools', 'models', 'status', 'sessions'].includes(p)) void loadManagement(p);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (activeRunId) {
      void stopRun(settings.baseUrl, settings.apiKey, activeRunId).catch(() => undefined);
    }
    setBusy(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!settings.apiKey) {
      setPage('settings');
      showToast('Add your Hermes API key in Settings');
      return;
    }
    const session = ensureSession();
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, createdAt: Date.now() };
    const assistantId = uid();
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', createdAt: Date.now() };
    updateSession(session.id, (s) => ({
      ...s,
      title: s.messages.length === 0 ? titleFrom(text) : s.title,
      messages: [...s.messages, userMsg, assistantMsg],
      toolEvents: [],
    }));
    setInput('');
    setBusy(true);
    setPendingApproval(null);
    const controller = new AbortController();
    abortRef.current = controller;

    const onDelta = (delta: string) => {
      updateSession(session.id, (s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
      }));
    };
    const onTool = (evt: { name: string; status: string; detail?: string }) => {
      updateSession(session.id, (s) => ({
        ...s,
        toolEvents: [...s.toolEvents, { id: uid(), name: evt.name, status: evt.status, detail: evt.detail, at: Date.now() }],
      }));
    };
    const onApproval = (evt: { runId?: string; message?: string; raw?: unknown }) => {
      if (evt.runId) setActiveRunId(evt.runId);
      setPendingApproval({ runId: evt.runId || '', message: evt.message || 'Approval required', raw: evt.raw });
    };

    try {
      let hermesSessionId = session.hermesSessionId;
      if (!hermesSessionId) {
        try {
          const created: any = await createRemoteSession(settings.baseUrl, settings.apiKey, titleFrom(text));
          hermesSessionId = created.id || created.session_id;
          if (hermesSessionId) {
            updateSession(session.id, { hermesSessionId });
            try {
              await lockSessionModel(settings.baseUrl, settings.apiKey, hermesSessionId, {
                model: picked.model,
                provider: picked.provider,
              });
            } catch {
              /* optional */
            }
          }
        } catch {
          /* fall back */
        }
      }

      const extras = { model: picked.model, provider: picked.provider };
      if (hermesSessionId) {
        try {
          await streamSessionChat(
            settings.baseUrl,
            settings.apiKey,
            hermesSessionId,
            text,
            { onDelta, onTool, onApproval },
            controller.signal,
            extras,
          );
        } catch {
          await streamChatCompletions(
            settings.baseUrl,
            settings.apiKey,
            [...session.messages, userMsg],
            { onDelta, onTool, onApproval },
            { signal: controller.signal, sessionId: hermesSessionId, ...extras },
          );
        }
      } else {
        await streamChatCompletions(
          settings.baseUrl,
          settings.apiKey,
          [...session.messages, userMsg],
          { onDelta, onTool, onApproval },
          { signal: controller.signal, ...extras },
        );
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : 'Request failed';
        showToast(msg);
        updateSession(session.id, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantId && !m.content ? { ...m, content: `Error: ${msg}` } : m)),
        }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      void refreshHealth();
    }
  };

  const providers: any[] = modelOptions?.providers || [];

  const navBtn = (p: Page, label: string) => (
    <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => go(p)}>
      {label}
    </button>
  );

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? 'show' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="logo-mark">J</div>
          <div>
            <div className="brand-name">JohnAI</div>
            <div className={`health-pill ${health}`}>{health === 'ok' ? 'Hermes connected' : health === 'error' ? 'Hermes offline' : 'Checking…'}</div>
          </div>
        </div>

        <button className="primary-btn full" onClick={newChat}>New chat</button>

        <nav className="nav-stack">
          {navBtn('chat', 'Chat')}
          {navBtn('sessions', 'Hermes sessions')}
          {navBtn('models', 'Models')}
          {navBtn('skills', 'Skills')}
          {navBtn('tools', 'Tools')}
          {navBtn('status', 'Status')}
          {navBtn('settings', 'Settings')}
        </nav>

        {page === 'chat' && (
          <div className="session-list">
            {sessions.map((s) => (
              <div key={s.id} className={`session-item ${s.id === activeId ? 'active' : ''}`} onClick={() => { setActiveId(s.id); setPage('chat'); setSidebarOpen(false); }}>
                <div className="session-title">{s.title || 'New chat'}</div>
                <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); deleteChat(s.id); }}>×</button>
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu" onClick={() => setSidebarOpen(true)} aria-label="Menu">☰</button>
          <div className="topbar-title">
            <span className="brand-inline">JohnAI</span>
            <span className="sep">/</span>
            <span className="chat-name">{page === 'chat' ? (active?.title || 'New chat') : page}</span>
          </div>
          <div className="model-pill" title="Active model" onClick={() => go('models')}>
            {picked.model.split('/').pop()}
          </div>
        </header>

        {page === 'chat' && (
          <>
            <div className="chat-scroll">
              {!active || active.messages.length === 0 ? (
                <div className="empty">
                  <div className="empty-mark">J</div>
                  <h1>JohnAI</h1>
                  <p>Hermes-powered chat with models, skills, tools, sessions, and approvals.</p>
                  <div className="empty-hints">
                    <button className="ghost-btn" onClick={() => go('models')}>Choose model</button>
                    <button className="ghost-btn" onClick={() => go('skills')}>Browse skills</button>
                    <button className="ghost-btn" onClick={() => go('tools')}>Toolsets</button>
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {active.messages.map((m) => (
                    <div key={m.id} className={`bubble-row ${m.role}`}>
                      <div className={`bubble ${m.role}`}>
                        {m.role === 'assistant' ? (m.content ? <Markdown content={m.content} /> : <span className="typing">{busy ? 'Thinking…' : ''}</span>) : <p>{m.content}</p>}
                      </div>
                    </div>
                  ))}
                  {active.toolEvents.length > 0 && (
                    <div className="tool-feed">
                      {active.toolEvents.map((t) => (
                        <div key={t.id} className={`tool-chip ${t.status}`}>
                          <span className="tool-name">{t.name}</span>
                          <span className="tool-status">{t.status}</span>
                          {t.detail && <span className="tool-detail">{t.detail}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {pendingApproval && (
                    <div className="approval-card">
                      <strong>Approval needed</strong>
                      <p>{pendingApproval.message}</p>
                      <div className="modal-actions">
                        <button className="danger-btn" onClick={() => { if (pendingApproval.runId) void approveRun(settings.baseUrl, settings.apiKey, pendingApproval.runId, { approved: false }).then(() => setPendingApproval(null)); }}>Deny</button>
                        <button className="primary-btn" onClick={() => { if (pendingApproval.runId) void approveRun(settings.baseUrl, settings.apiKey, pendingApproval.runId, { approved: true }).then(() => setPendingApproval(null)); }}>Approve</button>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>
            <footer className="composer">
              {busy && activeRunId && (
                <div className="steer-row">
                  <input value={steerText} onChange={(e) => setSteerText(e.target.value)} placeholder="Steer the running turn…" />
                  <button className="ghost-btn" onClick={() => { if (steerText.trim() && activeRunId) void steerRun(settings.baseUrl, settings.apiKey, activeRunId, steerText.trim()).then(() => { showToast('Steer sent'); setSteerText(''); }); }}>Steer</button>
                </div>
              )}
              <div className="composer-box">
                <button className="ghost-btn compact" onClick={() => go('models')} title="Model">{picked.model.split('/').pop()}</button>
                <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message JohnAI…" rows={1} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                <div className="composer-actions">
                  {busy ? <button className="danger-btn" onClick={stop}>Stop</button> : <button className="primary-btn" onClick={() => void send()} disabled={!input.trim()}>Send</button>}
                </div>
              </div>
              <p className="fineprint">{picked.provider} · {picked.model} · {settings.baseUrl}</p>
            </footer>
          </>
        )}

        {page !== 'chat' && (
          <div className="panel-scroll">
            <div className="panel">
              <div className="panel-head">
                <h2>{page[0].toUpperCase() + page.slice(1)}</h2>
                {page !== 'settings' && (
                  <button className="ghost-btn" disabled={loadingPanel} onClick={() => void loadManagement(page)}>{loadingPanel ? 'Loading…' : 'Refresh'}</button>
                )}
              </div>

              {page === 'models' && (
                <div className="stack">
                  <p className="muted">Same provider/model catalog Hermes exposes. Selection sticks for new chats (composer sticky, like Desktop).</p>
                  {providers.map((p) => (
                    <section key={p.slug} className="card">
                      <h3>{p.name || p.slug} {p.is_current ? <span className="badge">current</span> : null} {p.authenticated ? <span className="badge ok">auth</span> : <span className="badge warn">needs auth</span>}</h3>
                      <div className="chip-grid">
                        {(p.models || []).slice(0, 80).map((m: string) => (
                          <button key={m} className={`chip clickable ${picked.model === m && picked.provider === p.slug ? 'selected' : ''}`} onClick={() => { setPicked({ provider: p.slug, model: m }); showToast(`Model set to ${m}`); if (active?.hermesSessionId) void lockSessionModel(settings.baseUrl, settings.apiKey, active.hermesSessionId, { model: m, provider: p.slug }).catch(() => undefined); }}>
                            <strong>{m}</strong>
                          </button>
                        ))}
                      </div>
                      {!(p.models || []).length && <p className="muted small">{p.warning || 'No models listed'}</p>}
                    </section>
                  ))}
                  {!providers.length && <p className="muted">{loadingPanel ? 'Loading…' : 'No model options yet — check API key / connection.'}</p>}
                </div>
              )}

              {page === 'skills' && (
                <div className="chip-grid">
                  {skills.map((s) => (
                    <div key={s.name} className="chip"><strong>{s.name}</strong><span>{s.description || s.category || 'skill'}</span></div>
                  ))}
                  {!skills.length && <p className="muted">{loadingPanel ? 'Loading…' : 'No skills returned'}</p>}
                </div>
              )}

              {page === 'tools' && (
                <div className="chip-grid">
                  {toolsets.map((t) => (
                    <div key={t.name} className={`chip ${t.enabled === false ? 'dim' : ''}`}>
                      <strong>{t.label || t.name}</strong>
                      <span>{(t.tools || []).length} tools · {t.enabled === false ? 'off' : 'on'}</span>
                      {t.description && <span>{t.description}</span>}
                    </div>
                  ))}
                  {!toolsets.length && <p className="muted">{loadingPanel ? 'Loading…' : 'No toolsets returned'}</p>}
                </div>
              )}

              {page === 'sessions' && (
                <div className="stack">
                  <p className="muted">Sessions from the Hermes API (shared with Desktop/CLI).</p>
                  {remoteSessions.map((s: any) => {
                    const id = s.id || s.session_id;
                    return (
                      <div key={id} className="card row">
                        <div>
                          <strong>{s.title || id}</strong>
                          <div className="muted small">{id}</div>
                        </div>
                        <div className="row-actions">
                          <button className="ghost-btn compact" onClick={async () => {
                            try {
                              const msgs: any = await sessionMessages(settings.baseUrl, settings.apiKey, id);
                              const list = Array.isArray(msgs) ? msgs : msgs.messages || [];
                              const mapped: ChatMessage[] = list.map((m: any) => ({
                                id: m.id || uid(),
                                role: (m.role === 'assistant' || m.role === 'user' || m.role === 'system' ? m.role : 'assistant') as ChatMessage['role'],
                                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                                createdAt: Date.now(),
                              }));
                              const local: LocalSession = { id: uid(), title: s.title || 'Hermes session', messages: mapped, toolEvents: [], updatedAt: Date.now(), hermesSessionId: id };
                              setSessions((prev) => [local, ...prev]);
                              setActiveId(local.id);
                              setPage('chat');
                            } catch (e) {
                              showToast(e instanceof Error ? e.message : 'Failed');
                            }
                          }}>Open</button>
                          <button className="ghost-btn compact" onClick={async () => {
                            try {
                              const forked: any = await forkSession(settings.baseUrl, settings.apiKey, id, `${s.title || 'session'} (fork)`);
                              showToast(`Forked ${forked.id || forked.session_id || ''}`);
                              void loadManagement('sessions');
                            } catch (e) {
                              showToast(e instanceof Error ? e.message : 'Fork failed');
                            }
                          }}>Fork</button>
                          <button className="danger-btn compact" onClick={async () => {
                            try {
                              await deleteRemoteSession(settings.baseUrl, settings.apiKey, id);
                              void loadManagement('sessions');
                            } catch (e) {
                              showToast(e instanceof Error ? e.message : 'Delete failed');
                            }
                          }}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                  {!remoteSessions.length && <p className="muted">{loadingPanel ? 'Loading…' : 'No remote sessions'}</p>}
                </div>
              )}

              {page === 'status' && (
                <div className="stack">
                  <section className="card">
                    <h3>Connection</h3>
                    <p className="muted">{settings.baseUrl}</p>
                    <p className={health === 'ok' ? 'ok-text' : 'error-text'}>{health === 'ok' ? 'Healthy' : 'Unreachable'}</p>
                  </section>
                  <section className="card">
                    <h3>Features</h3>
                    <pre className="code-block small">{JSON.stringify(capabilities?.features || capabilities || {}, null, 2)}</pre>
                  </section>
                  <section className="card">
                    <h3>Detailed health</h3>
                    <pre className="code-block small">{JSON.stringify(detailed || {}, null, 2)}</pre>
                  </section>
                  <p className="muted small">Desktop-only surfaces not available in JohnAI web: native terminal, local file browser, Git review/worktrees, HUD, Quick Entry, Bot Mode plugins, microphone voice (API reports audio_api/realtime_voice false).</p>
                </div>
              )}

              {page === 'settings' && (
                <div className="stack settings-form">
                  <label>Display name<input value={settings.displayName} onChange={(e) => setSettings({ ...settings, displayName: e.target.value })} /></label>
                  <label>Hermes base URL<input value={settings.baseUrl} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} /></label>
                  <label>API server key<input type="password" value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} autoComplete="off" /></label>
                  <div className="modal-actions">
                    <button className="primary-btn" onClick={() => { saveSettings(settings); showToast('Settings saved'); void checkHealth(settings.baseUrl).then((r) => setHealth(r.ok ? 'ok' : 'error')); }}>Save</button>
                  </div>
                  <p className="muted small">On Netlify, paste the key from your PC Hermes `api-server-key.txt`. Keep your PC gateway + Cloudflare tunnel running.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
