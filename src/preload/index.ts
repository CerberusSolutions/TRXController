import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AppInfo,
  type DmrUser,
  type IdentityStats,
  type ImportResult,
  type PortInfo,
  type ReceptionRow,
  type ScannerSnapshot,
  type Settings,
  type ThemeMode,
  type LogCursor,
  type PortsResult,
  type TrafficGroup,
  type UpdateInfo,
  type WtrMatch,
  type RepeaterMatch,
  type RrInfo,
  type RrRegion,
  type RrStatus,
  type RrukStatus,
} from '../shared/ipc';
import type { Confirmation, NewConfirmation } from '../shared/confirm';

// The renderer only ever sees this object. Nothing in the renderer may
// require Node modules; the serial port lives in the main process.
const api = {
  /** 'win32' or 'darwin': the renderer leaves room for the native window controls accordingly. */
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  /** The ports the OS lists (the Mac's own built-in ones left out), or the reason it could not list them. */
  listPorts: (): Promise<PortsResult> => ipcRenderer.invoke(IPC.listPorts),
  connect: (path: string): Promise<void> => ipcRenderer.invoke(IPC.connect, path),
  disconnect: (): Promise<void> => ipcRenderer.invoke(IPC.disconnect),
  sendKey: (code: number): Promise<void> => ipcRenderer.invoke(IPC.sendKey, code),
  /** Tune Mode via the menus, then the frequency as keystrokes; rejects with the reason if the display disagrees. */
  tune: (hz: number): Promise<void> => ipcRenderer.invoke(IPC.tune, hz),
  resumeScan: (): Promise<void> => ipcRenderer.invoke(IPC.resumeScan),
  getSnapshot: (): Promise<ScannerSnapshot> => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (cb: (s: ScannerSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, s: ScannerSnapshot): void => cb(s);
    ipcRenderer.on(IPC.snapshot, listener);
    return () => ipcRenderer.removeListener(IPC.snapshot, listener);
  },
  onCcDump: (cb: (line: string) => void): (() => void) => {
    const listener = (_e: unknown, line: string): void => cb(line);
    ipcRenderer.on(IPC.ccdump, listener);
    return () => ipcRenderer.removeListener(IPC.ccdump, listener);
  },
  /** The newest `limit` log rows, or the page after `before` (the last row already shown). */
  logRecent: (limit?: number, before?: LogCursor): Promise<ReceptionRow[]> => ipcRenderer.invoke(IPC.logRecent, limit, before),
  logClear: (): Promise<void> => ipcRenderer.invoke(IPC.logClear),
  /** Save CSV text through a file dialog; resolves to the path, or null if cancelled. */
  logExportCsv: (csv: string, suggestedName: string): Promise<string | null> => ipcRenderer.invoke(IPC.logExportCsv, csv, suggestedName),
  /** Confirm by hand what a frequency (with this tone / talkgroup) is; renames the rows it applies to. */
  logConfirm: (c: NewConfirmation): Promise<Confirmation> => ipcRenderer.invoke(IPC.logConfirm, c),
  logUnconfirm: (id: number): Promise<void> => ipcRenderer.invoke(IPC.logUnconfirm, id),
  logConfirmations: (): Promise<Confirmation[]> => ipcRenderer.invoke(IPC.logConfirmations),
  /** What has been heard on a frequency, grouped by tone / colour code and talkgroup. */
  logTraffic: (hz: number): Promise<TrafficGroup[]> => ipcRenderer.invoke(IPC.logTraffic, hz),
  onLogUpsert: (cb: (row: ReceptionRow) => void): (() => void) => {
    const listener = (_e: unknown, row: ReceptionRow): void => cb(row);
    ipcRenderer.on(IPC.logUpsert, listener);
    return () => ipcRenderer.removeListener(IPC.logUpsert, listener);
  },
  identityStats: (): Promise<IdentityStats> => ipcRenderer.invoke(IPC.identityStats),
  identityImport: (): Promise<ImportResult | null> => ipcRenderer.invoke(IPC.identityImport),
  identityLookup: (id: number): Promise<DmrUser | null> => ipcRenderer.invoke(IPC.identityLookup, id),
  setTheme: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke(IPC.setTheme, mode),
  wtrImport: (): Promise<ImportResult | null> => ipcRenderer.invoke(IPC.wtrImport),
  wtrLookup: (hz: number): Promise<WtrMatch[]> => ipcRenderer.invoke(IPC.wtrLookup, hz),
  repeatersImport: (): Promise<ImportResult | null> => ipcRenderer.invoke(IPC.repeatersImport),
  repeatersLookup: (hz: number): Promise<RepeaterMatch[]> => ipcRenderer.invoke(IPC.repeatersLookup, hz),
  rrStatus: (): Promise<RrStatus> => ipcRenderer.invoke(IPC.rrStatus),
  /** Store the RadioReference login; an empty password keeps the one already stored. */
  rrAccountSet: (username: string, password: string): Promise<RrStatus> => ipcRenderer.invoke(IPC.rrAccountSet, username, password),
  rrTest: (): Promise<{ username: string; subExpireDate: string }> => ipcRenderer.invoke(IPC.rrTest),
  rrCountries: (): Promise<RrRegion[]> => ipcRenderer.invoke(IPC.rrCountries),
  rrStates: (coid: number): Promise<RrRegion[]> => ipcRenderer.invoke(IPC.rrStates, coid),
  rrRegionSet: (region: { coid: number; stid: number; countryName: string; stateName: string }): Promise<RrStatus> => ipcRenderer.invoke(IPC.rrRegionSet, region),
  rrClearCache: (): Promise<RrStatus> => ipcRenderer.invoke(IPC.rrClearCache),
  /** Force a fresh lookup of a frequency. */
  rrLookup: (hz: number): Promise<RrInfo | null> => ipcRenderer.invoke(IPC.rrLookup, hz),
  /** RadioReference UK: the user's own API key (stored encrypted; an empty key clears it), a test call, the cache. */
  rrukStatus: (): Promise<RrukStatus | null> => ipcRenderer.invoke(IPC.rrukStatus),
  rrukKeySet: (key: string): Promise<RrukStatus> => ipcRenderer.invoke(IPC.rrukKeySet, key),
  rrukTest: (): Promise<{ user: string; entries: number }> => ipcRenderer.invoke(IPC.rrukTest),
  rrukClearCache: (): Promise<RrukStatus | null> => ipcRenderer.invoke(IPC.rrukClearCache),
  settingsGet: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  /** Latest known release check (null until the first check completes or if GitHub was unreachable). */
  updateCheck: (): Promise<UpdateInfo | null> => ipcRenderer.invoke(IPC.updateCheck),
  onUpdate: (cb: (u: UpdateInfo) => void): (() => void) => {
    const listener = (_e: unknown, u: UpdateInfo): void => cb(u);
    ipcRenderer.on(IPC.update, listener);
    return () => ipcRenderer.removeListener(IPC.update, listener);
  },
};

export type TrxApi = typeof api;

contextBridge.exposeInMainWorld('trx', api);
