import { create } from 'zustand';
import type { IdentityStats, ImportResult } from '../../../shared/ipc';

interface IdentityState {
  stats: IdentityStats;
  importing: boolean;
  lastResult: ImportResult | null;
  error: string | null;
  refresh: () => Promise<void>;
  importFile: () => Promise<void>;
}

export const useIdentities = create<IdentityState>((set) => ({
  stats: { dmrUsers: 0, importedAt: null, source: null },
  importing: false,
  lastResult: null,
  error: null,

  refresh: async () => {
    if (!window.trx) return;
    set({ stats: await window.trx.identityStats() });
  },

  importFile: async () => {
    if (!window.trx) return;
    set({ importing: true, error: null });
    try {
      const result = await window.trx.identityImport();
      if (result) set({ lastResult: result });
      set({ stats: await window.trx.identityStats() });
    } catch (e) {
      set({ error: (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') });
    } finally {
      set({ importing: false });
    }
  },
}));
