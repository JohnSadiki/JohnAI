export type StreamHandlers = {
  onDelta: (text: string) => void;
  onTool?: (evt: { name: string; status: string; detail?: string }) => void;
  onApproval?: (evt: { runId?: string; message?: string; raw?: unknown }) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
};

function authHeaders(apiKey: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

export function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function api<T = unknown>(
  baseUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(joinUrl(baseUrl, path), {
    ...init,
    headers: { ...authHeaders(apiKey), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(res.status === 401 ? 'Unauthorized — check API key' : `HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as T;
}

export async function checkHealth(baseUrl: string) {
  try {
    const res = await fetch(joinUrl(baseUrl, '/health'));
    if (!res.ok) return { ok: false as const };
    return { ok: true as const, body: await res.json() };
  } catch {
    return { ok: false as const };
  }
}

export async function healthDetailed(baseUrl: string, apiKey: string) {
  return api(baseUrl, apiKey, '/health/detailed');
}

export async function fetchCapabilities(baseUrl: string, apiKey: string) {
  return api(baseUrl, apiKey, '/v1/capabilities');
}

export async function fetchSkills(baseUrl: string, apiKey: string) {
  const data = await api<any>(baseUrl, apiKey, '/v1/skills');
  return Array.isArray(data) ? data : data.skills ?? [];
}

export async function fetchToolsets(baseUrl: string, apiKey: string) {
  const data = await api<any>(baseUrl, apiKey, '/v1/toolsets');
  return Array.isArray(data) ? data : data.toolsets ?? [];
}

export async function fetchModels(baseUrl: string, apiKey: string) {
  return api(baseUrl, apiKey, '/v1/models');
}

export async function fetchModelOptions(baseUrl: string, apiKey: string, refresh = false) {
  return api(baseUrl, apiKey, `/api/model/options${refresh ? '?refresh=1' : ''}`);
}

export async function listRemoteSessions(baseUrl: string, apiKey: string) {
  return api(baseUrl, apiKey, '/api/sessions?limit=100&include_children=true');
}

export async function createRemoteSession(baseUrl: string, apiKey: string, title?: string) {
  return api(baseUrl, apiKey, '/api/sessions', {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  });
}

export async function updateRemoteSession(baseUrl: string, apiKey: string, id: string, patch: Record<string, unknown>) {
  return api(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteRemoteSession(baseUrl: string, apiKey: string, id: string) {
  return api(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function sessionMessages(baseUrl: string, apiKey: string, id: string) {
  return api(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(id)}/messages`);
}

export async function forkSession(baseUrl: string, apiKey: string, id: string, title?: string) {
  return api(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(id)}/fork`, {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  });
}

export async function lockSessionModel(
  baseUrl: string,
  apiKey: string,
  sessionId: string,
  body: { model?: string; provider?: string; model_options?: Record<string, unknown> },
) {
  return api(baseUrl, apiKey, `/api/sessions/${encodeURIComponent(sessionId)}/model`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function stopRun(baseUrl: string, apiKey: string, runId: string) {
  return api(baseUrl, apiKey, `/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: '{}' });
}

export async function approveRun(baseUrl: string, apiKey: string, runId: string, decision: Record<string, unknown>) {
  return api(baseUrl, apiKey, `/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

export async function steerRun(baseUrl: string, apiKey: string, runId: string, input: string) {
  return api(baseUrl, apiKey, `/v1/runs/${encodeURIComponent(runId)}/steer`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

type Msg = { id: string; role: string; content: string; createdAt: number };

async function readSSE(
  res: Response,
  handlers: StreamHandlers,
) {
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    let eventName = 'message';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') {
        if (data === '[DONE]') handlers.onDone?.();
        continue;
      }
      try {
        const parsed = JSON.parse(data);
        if (eventName.includes('approval') || parsed.type?.includes?.('approval')) {
          handlers.onApproval?.({
            runId: parsed.run_id || parsed.runId,
            message: parsed.message || parsed.prompt || JSON.stringify(parsed),
            raw: parsed,
          });
        }
        if (eventName.includes('tool') || parsed.type?.includes?.('tool') || eventName === 'hermes.tool.progress') {
          handlers.onTool?.({
            name: parsed.name || parsed.tool || parsed.tool_name || 'tool',
            status: eventName.includes('completed') ? 'completed' : parsed.status || 'progress',
            detail: parsed.detail || parsed.output || parsed.message,
          });
        }
        const delta =
          parsed.choices?.[0]?.delta?.content ||
          parsed.delta ||
          parsed.text ||
          (typeof parsed.content === 'string' ? parsed.content : undefined);
        if (typeof delta === 'string' && delta) handlers.onDelta(delta);
        if (eventName === 'run.completed' || parsed.type === 'run.completed' || parsed.choices?.[0]?.finish_reason) {
          handlers.onDone?.();
        }
      } catch {
        /* ignore */
      }
      eventName = 'message';
    }
  }
  handlers.onDone?.();
}

export async function streamChatCompletions(
  baseUrl: string,
  apiKey: string,
  messages: Msg[],
  handlers: StreamHandlers,
  opts?: { signal?: AbortSignal; sessionId?: string; model?: string; provider?: string },
) {
  const headers: Record<string, string> = {
    ...(authHeaders(apiKey) as Record<string, string>),
    Accept: 'text/event-stream',
  };
  if (opts?.sessionId) headers['X-Hermes-Session-Id'] = opts.sessionId;
  const body: Record<string, unknown> = {
    model: opts?.model || 'hermes-agent',
    stream: true,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (opts?.provider) body.provider = opts.provider;
  const res = await fetch(joinUrl(baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers,
    signal: opts?.signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(res.status === 401 ? 'Unauthorized — check API key' : `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  await readSSE(res, handlers);
}

export async function streamSessionChat(
  baseUrl: string,
  apiKey: string,
  sessionId: string,
  input: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  extras?: { model?: string; provider?: string },
) {
  const body: Record<string, unknown> = { input };
  if (extras?.model) body.model = extras.model;
  if (extras?.provider) body.provider = extras.provider;
  const res = await fetch(joinUrl(baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`), {
    method: 'POST',
    headers: {
      ...(authHeaders(apiKey) as Record<string, string>),
      Accept: 'text/event-stream',
    },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`session stream ${res.status}`);
  await readSSE(res, handlers);
}
