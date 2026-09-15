import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, screen, shell, type Rectangle } from 'electron';
import { join } from 'node:path';
import { isKeyCode } from '@trxcontroller/rcip';
import { IPC, type AppInfo, type ImportResult, type ReceptionRow, type ScannerSnapshot, type Settings, type UpdateInfo, type WtrMatch } from '../shared/ipc';
import { readUserFile } from './identities/radioid';
import { readWtrCsv } from './identities/wtr';
import { MIN_WINDOW, SettingsStore } from './settings';
import { checkForUpdate } from './updates';
import { LogDb } from './log/db';
import { ReceptionLogger } from './log/logger';
import { snapshotRadioId } from './log/tracker';
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
let settings: SettingsStore | null = null;
let licenceCache: { hz: number; matches: WtrMatch[] } | null = null;

function licencesFor(hz: number): WtrMatch[] {
  if (!db) return [];
  if (licenceCache && licenceCache.hz === hz) return licenceCache.matches;
  const s = settings?.get();
  const matches = db.lookupWtr(hz, { lat: s?.lat, lon: s?.lon, radiusKm: s?.radiusKm, limit: 5 });
  licenceCache = { hz, matches };
  return matches;
}

/** Attach the DMR user for the current radio ID and the nearest Ofcom licences for the frequency. */
function enrich(s: ScannerSnapshot): ScannerSnapshot {
  const rid = snapshotRadioId(s);
  const radioUser = db && rid !== null ? (s.radioUser?.id === rid ? s.radioUser : (db.lookupDmrUser(rid) ?? null)) : null;
  const licences = s.status ? licencesFor(s.status.frequencyHz) : [];
  return { ...s, radioUser, licences };
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

/** Release check: shortly after launch, then every six hours while the app runs. */
const UPDATE_FIRST_CHECK_MS = 5000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let latestUpdate: UpdateInfo | null = null;
let updateTimer: ReturnType<typeof setTimeout> | null = null;

async function runUpdateCheck(): Promise<void> {
  // Chromium's network stack (net.fetch) follows the system proxy; Node's fetch does not.
  const info = await checkForUpdate(app.getVersion(), net.fetch);
  if (info) {
    latestUpdate = info;
    if (info.newer) console.log(`[update] v${info.latest} is available (running v${info.current})`);
    broadcast(IPC.update, info);
  }
  updateTimer = setTimeout(() => void runUpdateCheck(), UPDATE_INTERVAL_MS);
}

const AUTO_CONNECT_INTERVAL_MS = 5000;
let autoConnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Reopen the remembered port whenever nothing is connected: at launch, after the
 * scanner is unplugged and plugged back in, or after a failed attempt. Quiet by
 * design: the port is only tried when the OS lists it, so an absent scanner never
 * shows an error, and a scanner that is present but silent shows the same message
 * a manual Connect would.
 */
function scheduleAutoConnect(delayMs = AUTO_CONNECT_INTERVAL_MS): void {
  if (autoConnectTimer) clearTimeout(autoConnectTimer);
  autoConnectTimer = setTimeout(() => {
    autoConnectTimer = null;
    void autoConnectAttempt();
  }, delayMs);
}

async function autoConnectAttempt(): Promise<void> {
  const s = settings?.get();
  const link = session.getSnapshot().link.status;
  if (s?.port && s.autoConnect && (link === 'disconnected' || link === 'error')) {
    try {
      const present = (await listPorts()).some((p) => p.path === s.port);
      if (present) {
        await session.connect(s.port);
        console.log(`[scanner] auto-connected to ${s.port}`);
      }
    } catch (err) {
      console.log(`[scanner] auto-connect to ${s.port} failed: ${(err as Error).message}`);
    }
  }
  scheduleAutoConnect();
}

function registerIpc(): void {
  ipcMain.handle(IPC.listPorts, () => listPorts());
  ipcMain.handle(IPC.connect, async (_e, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('Port path required');
    await session.connect(path);
    settings?.set({ port: path, autoConnect: true });
  });
  ipcMain.handle(IPC.disconnect, () => {
    // A deliberate disconnect must stick until the user connects again.
    settings?.set({ autoConnect: false });
    return session.disconnect();
  });
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron ?? '' }),
  );
  ipcMain.handle(IPC.updateCheck, () => latestUpdate);
  ipcMain.handle(IPC.sendKey, async (_e, code: unknown) => {
    if (typeof code !== 'number' || !isKeyCode(code)) throw new Error(`Unknown key code ${String(code)}`);
    await session.pressKey(code);
  });
  ipcMain.handle(IPC.tune, async (_e, hz: unknown) => {
    if (typeof hz !== 'number' || !Number.isFinite(hz)) throw new Error('Frequency required');
    try {
      await session.tuneTo(hz);
      console.log(`[scanner] tuned to ${(hz / 1e6).toFixed(6)} MHz`);
    } catch (err) {
      const screen = (err as { screen?: string[] }).screen;
      console.log(`[scanner] tune failed: ${(err as Error).message}${screen?.length ? ` | display: ${screen.map((l) => `|${l}|`).join(' ')}` : ''}`);
      throw err;
    }
  });
  ipcMain.handle(IPC.resumeScan, () => session.resumeScan());
  ipcMain.handle(IPC.getSnapshot, () => enrich(session.getSnapshot()));
  ipcMain.handle(IPC.logRecent, (_e, limit: unknown) => db?.recent(typeof limit === 'number' ? limit : 500) ?? []);
  ipcMain.handle(IPC.logClear, () => {
    logger?.flush();
    db?.clear();
    logger?.reset();
  });
  ipcMain.handle(IPC.identityStats, () => db?.identityStats() ?? { dmrUsers: 0, importedAt: null, source: null });
  ipcMain.handle(IPC.identityLookup, (_e, id: unknown) => (typeof id === 'number' && db ? (db.lookupDmrUser(id) ?? null) : null));
  ipcMain.handle(IPC.wtrImport, async (): Promise<ImportResult | null> => {
    if (!db) throw new Error('Database not open');
    const res = await dialog.showOpenDialog({
      title: 'Import Ofcom Wireless Telegraphy Register (CSV)',
      filters: [
        { name: 'WTR export', extensions: ['csv'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    const parsed = await readWtrCsv(file);
    if (parsed.rows.length === 0) throw new Error('No usable licences found in that file');
    const name = file.split(/[\\/]/).pop() ?? file;
    const imported = db.replaceWtr(parsed.rows, name);
    licenceCache = null;
    console.log(`[wtr] imported ${imported} licences from ${file} (${parsed.read} rows read, ${parsed.skipped} skipped)`);
    return { imported, skipped: parsed.skipped, file: name };
  });
  ipcMain.handle(IPC.wtrLookup, (_e, hz: unknown) => (typeof hz === 'number' ? licencesFor(hz) : []));
  ipcMain.handle(IPC.settingsGet, () => settings?.get() ?? null);
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => {
    if (!settings || typeof patch !== 'object' || patch === null) throw new Error('Bad settings');
    const next = settings.set(patch as Partial<Settings>);
    licenceCache = null;
    return next;
  });
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
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  const path = join(app.getPath('userData'), 'trx-log.sqlite');
  db = new LogDb(path);
  logger = new ReceptionLogger(db, (row: ReceptionRow) => broadcast(IPC.logUpsert, row));
  console.log(`[log] ${path} (${db.count()} receptions)`);
}

// Wide enough for the log table without truncating the system column.
const DEFAULT_WINDOW = { width: 1320, height: 780 };

/** The saved placement, if enough of it still lands on a connected screen to grab. */
function savedBounds(): Rectangle | null {
  const w = settings?.get().window;
  if (!w) return null;
  const area = screen.getDisplayMatching(w).workArea;
  const grip = 80;
  const onScreen =
    w.x + w.width > area.x + grip && w.x < area.x + area.width - grip && w.y >= area.y - 8 && w.y < area.y + area.height - grip;
  return onScreen ? { x: w.x, y: w.y, width: w.width, height: w.height } : null;
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

function rememberBounds(w: BrowserWindow): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    saveBoundsTimer = null;
    if (w.isDestroyed() || w.isMinimized()) return;
    // Normal bounds so a maximised window restores to its pre-maximised shape.
    settings?.set({ window: { ...w.getNormalBounds(), maximized: w.isMaximized() } });
  }, 400);
}

function createWindow(): void {
  const saved = savedBounds();
  win = new BrowserWindow({
    ...(saved ?? DEFAULT_WINDOW),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
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

  if (settings?.get().window?.maximized) win.maximize();
  win.on('ready-to-show', () => win?.show());
  const remember = (): void => {
    if (win) rememberBounds(win);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
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
  scheduleAutoConnect(500);
  updateTimer = setTimeout(() => void runUpdateCheck(), UPDATE_FIRST_CHECK_MS);
  nativeTheme.on('updated', applyChrome);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void session.disconnect(false).finally(() => app.quit());
});

app.on('before-quit', () => {
  if (autoConnectTimer) clearTimeout(autoConnectTimer);
  autoConnectTimer = null;
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = null;
  void session.disconnect(false);
  logger?.flush();
  db?.close();
  db = null;
  logger = null;
});
