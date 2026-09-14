import { create } from 'zustand';
import type { AppInfo } from '../../../shared/ipc';

const HELP_SEEN_KEY = 'trx.helpSeen';

interface UiState {
  helpOpen: boolean;
  app: AppInfo | null;
  openHelp: () => void;
  closeHelp: () => void;
  loadAppInfo: () => Promise<void>;
}

/** Cross-cutting UI state: the help dialog and the build identity shown in the top bar. */
export const useUi = create<UiState>((set) => ({
  helpOpen: false,
  app: null,
  openHelp: () => set({ helpOpen: true }),
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
