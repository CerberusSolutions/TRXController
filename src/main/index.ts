import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { isKeyCode } from '@trxcontroller/rcip';
import { IPC, type ImportResult, type ReceptionRow, type ScannerSnapshot } from '../shared/ipc';
import { readUserFile } from './identities/radioid';
import { LogDb } from './log/db';
import { ReceptionLogger } from './log/logger';
import { ScannerSession } from './scanner/session';
import { listPorts, serialTransportFactory } from './scanner/serialTransport';

let win: BrowserWindow | null = null;

/** Window chrome colours per theme, matching the renderer's tokens. */
const CHROME = {
  dark: { background: '#0b0f14', overlay: '#121821', symbol: '#9fb0c3' },
  light: { background: '#eef1f5', overlay: '#ffffff', symbol: '#475467' },
} as const;

function applyChrome(): void {
  const c = nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light;
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    w.setBackgroundColor(c.background);
    w.setTitleBarOverlay({ color: c.overlay, symbolColor: c.symbol, height: 46 });
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

let db: LogDb | null = null;
let logger: ReceptionLogger | null = null;

/** Attach the DMR user record for the current radio ID, if the database knows it. */
function enrich(s: ScannerSnapshot): ScannerSnapshot {
  const rid = s.active?.header?.radioId1;
  if (!db || rid === undefined || rid === 0xffffffff) return { ...s, radioUser: null };
  if (s.radioUser && s.radioUser.id === rid) return s;
  return { ...s, radioUser: db.lookupDmrUser(rid) ?? null };
}

const session = new ScannerSession(serialTransportFactory, {
  onSnapshot: (raw: ScannerSnapshot) => {
    const s = enrich(raw);
    broadcast(IPC.snapshot, s);
    logger?.onSnapshot(s);
  },
  onCcDump: (line) => broadcast(IPC.ccdump, line),
  log: (msg) => console.log(`[scanner] ${msg}`),
});

function registerIpc(): void {
  ipcMain.handle(IPC.listPorts, () => listPorts());
  ipcMain.handle(IPC.connect, async (_e, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('Port path required');
    await session.connect(path);
  });
  ipcMain.handle(IPC.disconnect, () => session.disconnect());
  ipcMain.handle(IPC.sendKey, async (_e, code: unknown) => {
    if (typeof code !== 'number' || !isKeyCode(code)) throw new Error(`Unknown key code ${String(code)}`);
    await session.pressKey(code);
  });
  ipcMain.handle(IPC.getSnapshot, () => enrich(session.getSnapshot()));
  ipcMain.handle(IPC.logRecent, (_e, limit: unknown) => db?.recent(typeof limit === 'number' ? limit : 500) ?? []);
  ipcMain.handle(IPC.logClear, () => {
    logger?.flush();
    db?.clear();
    logger?.reset();
  });
  ipcMain.handle(IPC.identityStats, () => db?.identityStats() ?? { dmrUsers: 0, importedAt: null, source: null });
  ipcMain.handle(IPC.identityLookup, (_e, id: unknown) => (typeof id === 'number' && db ? (db.lookupDmrUser(id) ?? null) : null));
  ipcMain.handle(IPC.setTheme, (_e, mode: unknown) => {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') throw new Error('Bad theme mode');
    // Also flips prefers-color-scheme in the renderer, which resolves "system".
    nativeTheme.themeSource = mode;
    applyChrome();
  });
  ipcMain.handle(IPC.identityImport, async (): Promise<ImportResult | null> => {
    if (!db) throw new Error('Database not open');
    const res = await dialog.showOpenDialog({
      title: 'Import DMR user database (radioid.net)',
      filters: [
        { name: 'radioid.net export', extensions: ['csv', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    const parsed = await readUserFile(file);
    if (parsed.users.length === 0) throw new Error('No DMR users found in that file');
    const name = file.split(/[\\/]/).pop() ?? file;
    const imported = db.replaceDmrUsers(parsed.users, name);
    console.log(`[identities] imported ${imported} DMR users from ${file} (${parsed.skipped} rows skipped, header: ${parsed.hadHeader})`);
    return { imported, skipped: parsed.skipped, file: name };
  });
}

function openLog(): void {
  const path = join(app.getPath('userData'), 'trx-log.sqlite');
  db = new LogDb(path);
  logger = new ReceptionLogger(db, (row: ReceptionRow) => broadcast(IPC.logUpsert, row));
  console.log(`[log] ${path} (${db.count()} receptions)`);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? CHROME.dark.background : CHROME.light.background,
    title: 'TRXController',
    // Frameless with the native window controls drawn over our own top bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: nativeTheme.shouldUseDarkColors
      ? { color: CHROME.dark.overlay, symbolColor: CHROME.dark.symbol, height: 46 }
      : { color: CHROME.light.overlay, symbolColor: CHROME.light.symbol, height: 46 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  openLog();
  registerIpc();
  createWindow();
  nativeTheme.on('updated', applyChrome);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void session.disconnect(false).finally(() => app.quit());
});

app.on('before-quit', () => {
  void session.disconnect(false);
  logger?.flush();
  db?.close();
  db = null;
  logger = null;
});
