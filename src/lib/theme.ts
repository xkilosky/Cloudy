export type StudioTheme = 'deepseek' | 'claude' | 'chatgpt' | 'qwen';

export interface ThemeMeta {
  id: StudioTheme;
  label: string;
  swatch: string;
  canvasHex: string;
}

export const STUDIO_THEMES: ThemeMeta[] = [
  { id: 'deepseek', label: 'DeepSeek', swatch: '#4D6BFE', canvasHex: '#171920' },
  { id: 'claude', label: 'Claude', swatch: '#D97757', canvasHex: '#201f1d' },
  { id: 'chatgpt', label: 'ChatGPT', swatch: '#10A37F', canvasHex: '#212121' },
  { id: 'qwen', label: 'Qwen', swatch: '#7C5CFC', canvasHex: '#1a1924' },
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
  const found = STUDIO_THEMES.find((t) => t.id === theme);
  if (found) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', found.canvasHex);
    }
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}
