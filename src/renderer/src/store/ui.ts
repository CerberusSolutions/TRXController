import { create } from 'zustand';
import type { AppInfo } from '../../../shared/ipc';

const HELP_SEEN_KEY = 'trx.helpSeen';
const DIAG_KEY = 'trx.diagnostics';

function loadDiagnostics(): boolean {
  try {
    return localStorage.getItem(DIAG_KEY) === '1';
  } catch {
    return false;
  }
}

interface UiState {
  helpOpen: boolean;
  app: AppInfo | null;
  /** Ctrl+Shift+D: shows the raw display bytes and other testing aids. */
  diagnostics: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toggleDiagnostics: () => void;
  loadAppInfo: () => Promise<void>;
}

/** Cross-cutting UI state: the help dialog and the build identity shown in the top bar. */
export const useUi = create<UiState>((set) => ({
  helpOpen: false,
  app: null,
  diagnostics: loadDiagnostics(),
  openHelp: () => set({ helpOpen: true }),
  toggleDiagnostics: () =>
    set((s) => {
      const diagnostics = !s.diagnostics;
      try {
        localStorage.setItem(DIAG_KEY, diagnostics ? '1' : '0');
      } catch {
        /* ignore */
      }
      return { diagnostics };
    }),
  closeHelp: () => {
    try {
      localStorage.setItem(HELP_SEEN_KEY, '1');
    } catch {
      /* private mode etc. */
    }
    set({ helpOpen: false });
  },
  loadAppInfo: async () => {
    if (!window.trx?.appInfo) return;
    set({ app: await window.trx.appInfo() });
  },
}));

/** True until the user has closed the help screen once on this machine. */
export function isFirstRun(): boolean {
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === null;
  } catch {
    return false;
  }
}
