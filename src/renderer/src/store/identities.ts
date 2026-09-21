import { create } from 'zustand';
import type { IdentityStats, ImportResult, RrRegion, RrStatus, RrukStatus, Settings } from '../../../shared/ipc';
import { DEFAULT_LOOKUPS } from '../../../shared/sources';

interface IdentityState {
  stats: IdentityStats;
  importing: boolean;
  lastResult: ImportResult | null;
  error: string | null;
  wtrImporting: boolean;
  wtrResult: ImportResult | null;
  repeatersImporting: boolean;
  repeatersResult: ImportResult | null;
  settings: Settings;
  rr: RrStatus | null;
  rrBusy: boolean;
  rruk: RrukStatus | null;
  rrukBusy: boolean;
  rrukMessage: { ok: boolean; text: string } | null;
  setRrukKey: (key: string) => Promise<void>;
  testRruk: () => Promise<void>;
  clearRrukCache: () => Promise<void>;
  /** Outcome of the last RadioReference action (test, save, region), for the Data menu. */
  rrMessage: { ok: boolean; text: string } | null;
  setRrAccount: (username: string, password: string) => Promise<void>;
  testRr: () => Promise<void>;
  rrCountries: () => Promise<RrRegion[]>;
  rrStates: (coid: number) => Promise<RrRegion[]>;
  setRrRegion: (region: { coid: number; stid: number; countryName: string; stateName: string }) => Promise<void>;
  clearRrCache: () => Promise<void>;
  refresh: () => Promise<void>;
  importFile: () => Promise<void>;
  importWtr: () => Promise<void>;
  importRepeaters: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
}

export const useIdentities = create<IdentityState>((set) => ({
  stats: { dmrUsers: 0, importedAt: null, source: null, wtrLicences: 0, wtrImportedAt: null, wtrSource: null, repeaters: 0, repeatersImportedAt: null, repeatersSource: null },
  importing: false,
  lastResult: null,
  error: null,
  wtrImporting: false,
  wtrResult: null,
  repeatersImporting: false,
  repeatersResult: null,
  settings: { lat: null, lon: null, radiusKm: 60, units: 'km', scanTimeoutS: null, port: null, autoConnect: true, window: null, mapDock: null, mapWindow: null, rr: { username: '', password: '', coid: null, stid: null, countryName: '', stateName: '' }, rruk: { apiKey: '', postcode: '' }, lookups: DEFAULT_LOOKUPS.map((p) => ({ ...p })) },
  rr: null,
  rrBusy: false,
  rrMessage: null,
  rruk: null,
  rrukBusy: false,
  rrukMessage: null,

  refresh: async () => {
    if (!window.trx) return;
    const [stats, settings, rr, rruk] = await Promise.all([window.trx.identityStats(), window.trx.settingsGet(), window.trx.rrStatus?.() ?? null, window.trx.rrukStatus?.() ?? null]);
    set({ stats, settings, rr, rruk });
  },

  setRrukKey: async (key) => {
    if (!window.trx) return;
    set({ rrukBusy: true, rrukMessage: null });
    try {
      const rruk = await window.trx.rrukKeySet(key);
      set({ rruk, rrukMessage: { ok: true, text: key ? 'API key saved.' : 'API key cleared.' } });
    } catch (e) {
      set({ rrukMessage: { ok: false, text: ipcText(e) } });
    } finally {
      set({ rrukBusy: false });
    }
  },

  testRruk: async () => {
    if (!window.trx) return;
    set({ rrukBusy: true, rrukMessage: null });
    try {
      const r = await window.trx.rrukTest();
      set({ rrukMessage: { ok: true, text: `Key accepted${r.user ? ` for ${r.user}` : ''}; PMR446 channel 1 returned ${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}.` } });
      set({ rruk: await window.trx.rrukStatus() });
    } catch (e) {
      set({ rrukMessage: { ok: false, text: ipcText(e) } });
    } finally {
      set({ rrukBusy: false });
    }
  },

  clearRrukCache: async () => {
    if (!window.trx) return;
    const rruk = await window.trx.rrukClearCache();
    set({ rruk, rrukMessage: { ok: true, text: 'Cache cleared; frequencies will be looked up again as they are heard.' } });
  },

  setRrAccount: async (username, password) => {
    if (!window.trx) return;
    set({ rrBusy: true, rrMessage: null });
    try {
      const rr = await window.trx.rrAccountSet(username, password);
      set({ rr, rrMessage: { ok: true, text: username ? 'Account saved.' : 'Account cleared.' } });
    } catch (e) {
      set({ rrMessage: { ok: false, text: ipcText(e) } });
    } finally {
      set({ rrBusy: false });
    }
  },

  testRr: async () => {
    if (!window.trx) return;
    set({ rrBusy: true, rrMessage: null });
    try {
      const u = await window.trx.rrTest();
      set({ rrMessage: { ok: true, text: `Logged in as ${u.username}${u.subExpireDate ? `, premium until ${u.subExpireDate}` : ''}.` } });
    } catch (e) {
      set({ rrMessage: { ok: false, text: ipcText(e) } });
    } finally {
      set({ rrBusy: false });
    }
  },

  rrCountries: async () => {
    if (!window.trx) return [];
    try {
      return await window.trx.rrCountries();
    } catch (e) {
      set({ rrMessage: { ok: false, text: ipcText(e) } });
      return [];
    }
  },

  rrStates: async (coid) => {
    if (!window.trx) return [];
    try {
      return await window.trx.rrStates(coid);
    } catch (e) {
      set({ rrMessage: { ok: false, text: ipcText(e) } });
      return [];
    }
  },

  setRrRegion: async (region) => {
    if (!window.trx) return;
    try {
      const rr = await window.trx.rrRegionSet(region);
      set({ rr, rrMessage: { ok: true, text: `Region set to ${region.stateName}, ${region.countryName}.` } });
    } catch (e) {
      set({ rrMessage: { ok: false, text: ipcText(e) } });
    }
  },

  clearRrCache: async () => {
    if (!window.trx) return;
    const rr = await window.trx.rrClearCache();
    set({ rr, rrMessage: { ok: true, text: 'Cache cleared; frequencies will be looked up again as they are heard.' } });
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

  importRepeaters: async () => {
    if (!window.trx) return;
    set({ repeatersImporting: true, error: null });
    try {
      const result = await window.trx.repeatersImport();
      if (result) set({ repeatersResult: result });
      set({ stats: await window.trx.identityStats() });
    } catch (e) {
      set({ error: (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') });
    } finally {
      set({ repeatersImporting: false });
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

function ipcText(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
