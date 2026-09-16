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
  type UpdateInfo,
  type WtrMatch,
  type RepeaterMatch,
  type RrInfo,
  type RrRegion,
  type RrStatus,
} from '../shared/ipc';

// The renderer only ever sees this object. Nothing in the renderer may
// require Node modules; the serial port lives in the main process.
const api = {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  listPorts: (): Promise<PortInfo[]> => ipcRenderer.invoke(IPC.listPorts),
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
  logRecent: (limit?: number): Promise<ReceptionRow[]> => ipcRenderer.invoke(IPC.logRecent, limit),
  logClear: (): Promise<void> => ipcRenderer.invoke(IPC.logClear),
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
