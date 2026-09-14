export type JohnAISettings = {
  baseUrl: string;
  apiKey: string;
  displayName: string;
};

const KEY = 'johnai.settings.v1';

export const defaultSettings: JohnAISettings = {
  baseUrl: 'http://127.0.0.1:8642',
  apiKey: '',
  displayName: 'You',
};

export function loadSettings(): JohnAISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: JohnAISettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
