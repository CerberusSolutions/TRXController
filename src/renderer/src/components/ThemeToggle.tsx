import type { ReactElement } from 'react';
import { useTheme, type ThemeMode } from '../store/theme';

const Sun = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Moon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
const Monitor = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

const OPTIONS: { mode: ThemeMode; label: string; icon: () => ReactElement }[] = [
  { mode: 'light', label: 'Light theme', icon: Sun },
  { mode: 'dark', label: 'Dark theme', icon: Moon },
  { mode: 'system', label: 'Follow Windows setting', icon: Monitor },
];

export default function ThemeToggle() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  return (
    <div className="no-drag flex overflow-hidden rounded-md border border-edge" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ mode: m, label, icon: Icon }) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          title={label}
          className={`px-2 py-1.5 ${mode === m ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:text-ink-2'}`}
          onClick={() => setMode(m)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
