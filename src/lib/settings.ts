export type JohnAISettings = {
  baseUrl: string;
  apiKey: string;
  displayName: string;
};

const KEY = 'johnai.settings.v1';

function runtimeBaseUrl() {
  if (import.meta.env.VITE_HERMES_BASE_URL) return import.meta.env.VITE_HERMES_BASE_URL as string;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    // Local / LAN Vite uses the same-origin /hermes proxy.
    if (h === 'localhost' || h === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
      return `${window.location.origin}/hermes`;
    }
  }
  return 'http://127.0.0.1:8642';
}

const envDefaults: JohnAISettings = {
  baseUrl: runtimeBaseUrl(),
  apiKey: import.meta.env.VITE_HERMES_API_KEY || '',
  displayName: import.meta.env.VITE_DISPLAY_NAME || 'You',
};

export const defaultSettings: JohnAISettings = { ...envDefaults };

export function loadSettings(): JohnAISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const saved = JSON.parse(raw) as Partial<JohnAISettings>;
    const savedBase = saved.baseUrl?.trim() || '';
    const remoteHost =
      typeof window !== 'undefined' &&
      window.location.hostname !== '127.0.0.1' &&
      window.location.hostname !== 'localhost';
    const baseUrl =
      remoteHost && (savedBase.includes('127.0.0.1') || savedBase.includes('localhost'))
        ? defaultSettings.baseUrl
        : savedBase || defaultSettings.baseUrl;
    return {
      ...defaultSettings,
      ...saved,
      apiKey: saved.apiKey?.trim() ? saved.apiKey : defaultSettings.apiKey,
      baseUrl,
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: JohnAISettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export async function loadRuntimeConfig(): Promise<Partial<JohnAISettings>> {
  try {
    const res = await fetch(`/runtime-config.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as { hermesBaseUrl?: string };
    return data.hermesBaseUrl ? { baseUrl: data.hermesBaseUrl } : {};
  } catch {
    return {};
  }
}