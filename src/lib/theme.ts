export type StudioTheme = 'deepseek' | 'claude' | 'chatgpt' | 'qwen';

export interface ThemeMeta {
  id: StudioTheme;
  label: string;
  swatch: string;
}

export const STUDIO_THEMES: ThemeMeta[] = [
  { id: 'deepseek', label: 'DeepSeek', swatch: '#4D6BFE' },
  { id: 'claude', label: 'Claude', swatch: '#D97757' },
  { id: 'chatgpt', label: 'ChatGPT', swatch: '#10A37F' },
  { id: 'qwen', label: 'Qwen', swatch: '#7C5CFC' },
];

const THEME_STORAGE_KEY = 'cloudy_studio_theme_v1';

export function getSavedTheme(): StudioTheme {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY) as StudioTheme | null;
    if (val && STUDIO_THEMES.some((t) => t.id === val)) {
      return val;
    }
  } catch {
    // ignore
  }
  return 'deepseek';
}

export function applyStudioTheme(theme: StudioTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}
