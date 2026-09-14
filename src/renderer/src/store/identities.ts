import { create } from 'zustand';
import type { IdentityStats, ImportResult, Settings } from '../../../shared/ipc';

interface IdentityState {
  stats: IdentityStats;
  importing: boolean;
  lastResult: ImportResult | null;
  error: string | null;
  wtrImporting: boolean;
  wtrResult: ImportResult | null;
  settings: Settings;
  refresh: () => Promise<void>;
  importFile: () => Promise<void>;
  importWtr: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
}

export const useIdentities = create<IdentityState>((set) => ({
  stats: { dmrUsers: 0, importedAt: null, source: null, wtrLicences: 0, wtrImportedAt: null, wtrSource: null },
  importing: false,
  lastResult: null,
  error: null,
  wtrImporting: false,
  wtrResult: null,
  settings: { lat: null, lon: null, radiusKm: 60, port: null, autoConnect: true, window: null },

  refresh: async () => {
    if (!window.trx) return;
    const [stats, settings] = await Promise.all([window.trx.identityStats(), window.trx.settingsGet()]);
    set({ stats, settings });
  },

  importWtr: async () => {
    if (!window.trx) return;
    set({ wtrImporting: true, error: null });
    try {
      const result = await window.trx.wtrImport();
      if (result) set({ wtrResult: result });
      set({ stats: await window.trx.identityStats() });
    } catch (e) {
      set({ error: (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') });
    } finally {
      set({ wtrImporting: false });
    }
  },

  saveSettings: async (patch) => {
    if (!window.trx) return;
    set({ settings: await window.trx.settingsSet(patch) });
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
