import { create } from 'zustand';
import type { DsdStatus } from '../../../shared/dsd';

interface DsdState {
  /** What the DSD+ folder watcher sees; null until main has answered. */
  status: DsdStatus | null;
  setStatus: (s: DsdStatus | null) => void;
  chooseFolder: () => Promise<void>;
  clearFolder: () => Promise<void>;
  open: () => void;
}

export const useDsd = create<DsdState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  chooseFolder: async () => {
    if (!window.trx?.dsdChooseFolder) return;
    await window.trx.dsdChooseFolder();
    set({ status: (await window.trx.dsdStatus?.()) ?? null });
  },
  clearFolder: async () => {
    if (!window.trx?.settingsSet) return;
    await window.trx.settingsSet({ dsd: { folder: null, window: null } });
    set({ status: (await window.trx.dsdStatus?.()) ?? null });
  },
  open: () => void window.trx?.dsdOpen?.(),
}));

export function attachDsdEvents(): () => void {
  if (!window.trx?.onDsdUpdate) return () => undefined;
  const off = window.trx.onDsdUpdate((s) => useDsd.getState().setStatus(s));
  void window.trx.dsdStatus?.().then((s) => useDsd.getState().setStatus(s));
  return off;
}
