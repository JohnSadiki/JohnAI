import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { CapabilitiesPanel } from './components/CapabilitiesPanel';
import { Markdown } from './components/Markdown';
import { loadSettings, saveSettings, type JohnAISettings } from './lib/settings';
import type { ChatMessage, HealthState, Session, SkillInfo, ToolsetInfo } from './lib/types';
import {
  checkHealth,
  createRemoteSession,
  fetchCapabilities,
  fetchSkills,
  fetchToolsets,
  streamChatCompletions,
  streamSessionChat,
} from './lib/hermes';
import './App.css';

const SESSIONS_KEY = 'johnai.sessions.v1';

function uid() {
  return crypto.randomUUID();
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function persistSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function titleFrom(text: string) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || 'New chat';
}

export default function App() {
  const [settings, setSettings] = useState<JohnAISettings>(() => loadSettings());
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>('unknown');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [capabilities, setCapabilities] = useState<unknown>();
  const [capsLoading, setCapsLoading] = useState(false);
  const [capsError, setCapsError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

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
    if (!settings.apiKey) setSettingsOpen(true);
  }, []);

  const ensureSession = (): Session => {
    if (active) return active;
    const s: Session = {
      id: uid(),
      title: 'New chat',
      messages: [],
      toolEvents: [],
      updatedAt: Date.now(),
    };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    return s;
  };

  const updateSession = (id: string, patch: Partial<Session> | ((s: Session) => Session)) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return typeof patch === 'function' ? patch(s) : { ...s, ...patch, updatedAt: Date.now() };
      }),
    );
  };

  const newChat = () => {
    const s: Session = {
      id: uid(),
      title: 'New chat',
      messages: [],
      toolEvents: [],
      updatedAt: Date.now(),
    };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setSidebarOpen(false);
  };

  const deleteChat = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const loadCapabilities = async () => {
    setCapsLoading(true);
    setCapsError(undefined);
    try {
      const [caps, sk, ts] = await Promise.all([
        fetchCapabilities(settings.baseUrl, settings.apiKey).catch(() => null),
        fetchSkills(settings.baseUrl, settings.apiKey).catch(() => []),
        fetchToolsets(settings.baseUrl, settings.apiKey).catch(() => []),
      ]);
      setCapabilities(caps);
      setSkills(sk);
      setToolsets(ts);
      if (!caps && sk.length === 0 && ts.length === 0) {
        setCapsError('Could not load capabilities — check API key and that hermes gateway is running.');
      }
    } catch (e) {
      setCapsError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setCapsLoading(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!settings.apiKey) {
      setSettingsOpen(true);
      showToast('Add your Hermes API_SERVER_KEY in Settings');
      return;
    }

    const session = ensureSession();
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };

    updateSession(session.id, (s) => ({
      ...s,
      title: s.messages.length === 0 ? titleFrom(text) : s.title,
      messages: [...s.messages, userMsg, assistantMsg],
      toolEvents: [],
    }));
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const onDelta = (delta: string) => {
      updateSession(session.id, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + delta } : m,
        ),
      }));
    };
    const onTool = (evt: { name: string; status: string; detail?: string }) => {
      updateSession(session.id, (s) => ({
        ...s,
        toolEvents: [
          ...s.toolEvents,
          {
            id: uid(),
            name: evt.name,
            status: (evt.status as 'started' | 'progress' | 'completed' | 'error') || 'progress',
            detail: evt.detail,
            at: Date.now(),
          },
        ],
      }));
    };

    try {
      let hermesSessionId = session.hermesSessionId;
      if (!hermesSessionId) {
        try {
          const created = await createRemoteSession(settings.baseUrl, settings.apiKey, titleFrom(text));
          hermesSessionId = created.id || created.session_id;
          if (hermesSessionId) updateSession(session.id, { hermesSessionId });
        } catch {
          // fall back to chat completions
        }
      }

      if (hermesSessionId) {
        try {
          await streamSessionChat(
            settings.baseUrl,
            settings.apiKey,
            hermesSessionId,
            text,
            { onDelta, onTool, onDone: () => undefined },
            controller.signal,
          );
        } catch {
          const history = [...session.messages, userMsg];
          await streamChatCompletions(
            settings.baseUrl,
            settings.apiKey,
            history,
            { onDelta, onTool },
            { signal: controller.signal, sessionId: hermesSessionId },
          );
        }
      } else {
        const history = [...session.messages, userMsg];
        await streamChatCompletions(
          settings.baseUrl,
          settings.apiKey,
          history,
          { onDelta, onTool },
          { signal: controller.signal },
        );
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        showToast('Stopped');
      } else {
        const msg = e instanceof Error ? e.message : 'Request failed';
        showToast(msg);
        updateSession(session.id, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === assistantId && !m.content ? { ...m, content: `Error: ${msg}` } : m,
          ),
        }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      void refreshHealth();
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newChat}
        onDelete={deleteChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCapabilities={() => {
          setCapsOpen(true);
          void loadCapabilities();
        }}
        onClose={() => setSidebarOpen(false)}
        health={health}
      />

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <div className="topbar-title">
            <span className="brand-inline">JohnAI</span>
            <span className="sep">/</span>
            <span className="chat-name">{active?.title || 'New chat'}</span>
          </div>
          <button className="ghost-btn compact" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </header>

        <div className="chat-scroll">
          {!active || active.messages.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">J</div>
              <h1>JohnAI</h1>
              <p>
                Chat with your local Hermes agent — tools, skills, and sessions — from any screen.
              </p>
              <div className="empty-hints">
                <button className="ghost-btn" onClick={() => setSettingsOpen(true)}>
                  Connect Hermes
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setCapsOpen(true);
                    void loadCapabilities();
                  }}
                >
                  View capabilities
                </button>
              </div>
            </div>
          ) : (
            <div className="messages">
              {active.messages.map((m) => (
                <div key={m.id} className={`bubble-row ${m.role}`}>
                  <div className={`bubble ${m.role}`}>
                    {m.role === 'assistant' ? (
                      m.content ? (
                        <Markdown content={m.content} />
                      ) : (
                        <span className="typing">{busy ? 'Thinking…' : ''}</span>
                      )
                    ) : (
                      <p>{m.content}</p>
                    )}
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
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <footer className="composer">
          <div className="composer-box">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message JohnAI…"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-actions">
              {busy ? (
                <button className="danger-btn" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="primary-btn" onClick={() => void send()} disabled={!input.trim()}>
                  Send
                </button>
              )}
            </div>
          </div>
          <p className="fineprint">JohnAI → Hermes at {settings.baseUrl}</p>
        </footer>
      </main>

      <SettingsModal
        open={settingsOpen}
        value={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
          void checkHealth(s.baseUrl).then((r) => setHealth(r.ok ? 'ok' : 'error'));
          showToast('Settings saved');
        }}
      />

      <CapabilitiesPanel
        open={capsOpen}
        loading={capsLoading}
        error={capsError}
        skills={skills}
        toolsets={toolsets}
        capabilities={capabilities}
        onClose={() => setCapsOpen(false)}
        onRefresh={() => void loadCapabilities()}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
