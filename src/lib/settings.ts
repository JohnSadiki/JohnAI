export type JohnAISettings = {
  baseUrl: string;
  apiKey: string;
  displayName: string;
};

const KEY = 'johnai.settings.v1';

const envDefaults: JohnAISettings = {
  baseUrl: import.meta.env.VITE_HERMES_BASE_URL || 'http://127.0.0.1:8642',
  apiKey: import.meta.env.VITE_HERMES_API_KEY || '',
  displayName: import.meta.env.VITE_DISPLAY_NAME || 'You',
};

export const defaultSettings: JohnAISettings = { ...envDefaults };

export function loadSettings(): JohnAISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const saved = JSON.parse(raw) as Partial<JohnAISettings>;
    return {
      ...defaultSettings,
      ...saved,
      // Prefer env/default key if the user never saved a real one
      apiKey: saved.apiKey?.trim() ? saved.apiKey : defaultSettings.apiKey,
      baseUrl: saved.baseUrl?.trim() ? saved.baseUrl : defaultSettings.baseUrl,
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: JohnAISettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}