import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DmrUser, type IdentityStats, type ImportResult, type PortInfo, type ReceptionRow, type ScannerSnapshot } from '../shared/ipc';

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
};

export type TrxApi = typeof api;

contextBridge.exposeInMainWorld('trx', api);
