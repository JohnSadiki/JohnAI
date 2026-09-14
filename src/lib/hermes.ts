import type { ChatMessage, SkillInfo, ToolsetInfo } from './types';

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onTool?: (evt: { name: string; status: string; detail?: string }) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
};

function authHeaders(apiKey: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function checkHealth(baseUrl: string): Promise<{ ok: boolean; body?: unknown }> {
  try {
    const res = await fetch(joinUrl(baseUrl, '/health'), { method: 'GET' });
    if (!res.ok) return { ok: false };
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false };
  }
}

export async function fetchCapabilities(baseUrl: string, apiKey: string) {
  const res = await fetch(joinUrl(baseUrl, '/v1/capabilities'), {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  return res.json();
}

export async function fetchSkills(baseUrl: string, apiKey: string): Promise<SkillInfo[]> {
  const res = await fetch(joinUrl(baseUrl, '/v1/skills'), { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`skills ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.skills ?? [];
}

export async function fetchToolsets(baseUrl: string, apiKey: string): Promise<ToolsetInfo[]> {
  const res = await fetch(joinUrl(baseUrl, '/v1/toolsets'), { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`toolsets ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.toolsets ?? [];
}

export async function listRemoteSessions(baseUrl: string, apiKey: string) {
  const res = await fetch(joinUrl(baseUrl, '/api/sessions?limit=50'), {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`sessions ${res.status}`);
  return res.json();
}

export async function createRemoteSession(baseUrl: string, apiKey: string, title?: string) {
  const res = await fetch(joinUrl(baseUrl, '/api/sessions'), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error(`create session ${res.status}`);
  return res.json();
}

export async function streamChatCompletions(
  baseUrl: string,
  apiKey: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  opts?: { signal?: AbortSignal; sessionId?: string },
) {
  const headers: Record<string, string> = {
    ...(authHeaders(apiKey) as Record<string, string>),
    Accept: 'text/event-stream',
  };
  if (opts?.sessionId) headers['X-Hermes-Session-Id'] = opts.sessionId;

  const res = await fetch(joinUrl(baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers,
    signal: opts?.signal,
    body: JSON.stringify({
      model: 'hermes-agent',
      stream: true,
      messages: messages
        .filter((m) => m.role !== 'system' || m.content)
        .map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(res.status === 401 ? 'Unauthorized — check your API key' : `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n');
    buffer = chunks.pop() ?? '';

    let eventName = 'message';
    for (const line of chunks) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        handlers.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (eventName === 'hermes.tool.progress' || parsed.type === 'hermes.tool.progress') {
          handlers.onTool?.({
            name: parsed.name || parsed.tool || parsed.tool_name || 'tool',
            status: parsed.status || 'progress',
            detail: parsed.detail || parsed.message || parsed.output,
          });
          eventName = 'message';
          continue;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) handlers.onDelta(delta);
        const finish = parsed.choices?.[0]?.finish_reason;
        if (finish) handlers.onDone?.();
      } catch {
        // ignore partial JSON
      }
      eventName = 'message';
    }
  }
  handlers.onDone?.();
}

export async function streamSessionChat(
  baseUrl: string,
  apiKey: string,
  sessionId: string,
  input: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  const res = await fetch(joinUrl(baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`), {
    method: 'POST',
    headers: {
      ...(authHeaders(apiKey) as Record<string, string>),
      Accept: 'text/event-stream',
    },
    signal,
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`session stream ${res.status}`);
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
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        if (eventName.includes('tool') || parsed.type?.includes('tool')) {
          handlers.onTool?.({
            name: parsed.name || parsed.tool || 'tool',
            status: eventName.includes('completed') ? 'completed' : 'started',
            detail: parsed.detail || parsed.output || parsed.message,
          });
        }
        const delta =
          parsed.delta ||
          parsed.text ||
          parsed.content ||
          parsed.choices?.[0]?.delta?.content ||
          (parsed.type === 'assistant.delta' ? parsed.delta || parsed.text : undefined);
        if (typeof delta === 'string' && delta) handlers.onDelta(delta);
        if (eventName === 'run.completed' || parsed.type === 'run.completed') handlers.onDone?.();
      } catch {
        /* ignore */
      }
    }
  }
  handlers.onDone?.();
}
