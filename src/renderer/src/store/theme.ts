import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Effective = 'light' | 'dark';

const KEY = 'trx.theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(mode: ThemeMode): Effective {
  return mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
}

function applyToDocument(effective: Effective): void {
  document.documentElement.dataset['theme'] = effective;
}

interface ThemeState {
  mode: ThemeMode;
  effective: Effective;
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: loadMode(),
  effective: resolve(loadMode()),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
    // Main sets nativeTheme.themeSource, which also drives prefers-color-scheme
    // here, so a follow-up 'change' event resolves the effective theme.
    void window.trx?.setTheme(mode);
    const effective = resolve(mode);
    applyToDocument(effective);
    set({ mode, effective });
    void get;
  },
}));

/** Apply the stored theme at start-up and follow system changes. */
export function initTheme(): () => void {
  const { mode } = useTheme.getState();
  applyToDocument(resolve(mode));
  void window.trx?.setTheme(mode);
  const onChange = (): void => {
    const effective = resolve(useTheme.getState().mode);
    applyToDocument(effective);
    useTheme.setState({ effective });
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
