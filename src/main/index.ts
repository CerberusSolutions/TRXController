import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, safeStorage, screen, shell, type Rectangle } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Key, isKeyCode } from '@trxcontroller/rcip';
import { IPC, type AppInfo, type ImportResult, type ReceptionRow, type RepeaterMatch, type ScannerSnapshot, type Settings, type UpdateInfo, type WtrMatch } from '../shared/ipc';
import { readUserFile } from './identities/radioid';
import { readWtrCsv } from './identities/wtr';
import { readRepeaterCsv } from './identities/repeaters';
import { MIN_WINDOW, SettingsStore } from './settings';
import { DEFAULT_LOOKUPS, lookupEnabled, type LookupPref } from '../shared/sources';
import type { NewConfirmation } from '../shared/confirm';
import { checkForUpdate, type FetchLike } from './updates';
import { LogDb } from './log/db';
import { ReceptionLogger } from './log/logger';
import { describe as describeSnapshot, snapshotRadioId } from './log/tracker';
import { RrService } from './identities/rrService';
import { ScannerSession } from './scanner/session';
import { ScanTimeout } from './scanner/scanTimeout';
import { listPorts, serialTransportFactory } from './scanner/serialTransport';

let win: BrowserWindow | null = null;

/** Window chrome colours per theme, matching the renderer's tokens. */
const CHROME = {
  dark: { background: '#0b0f14', overlay: '#121821', symbol: '#9fb0c3' },
  light: { background: '#eef1f5', overlay: '#ffffff', symbol: '#475467' },
} as const;

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

function applyChrome(): void {
  const c = nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light;
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    w.setBackgroundColor(c.background);
    // macOS draws its own traffic lights; the overlay is a Windows / Linux thing.
    if (!IS_MAC && !IS_LINUX) w.setTitleBarOverlay({ color: c.overlay, symbolColor: c.symbol, height: 46 });
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

let db: LogDb | null = null;
let logger: ReceptionLogger | null = null;
let rr: RrService | null = null;
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

let repeaterCache: { hz: number; matches: RepeaterMatch[] } | null = null;

function repeatersFor(hz: number): RepeaterMatch[] {
  if (!db) return [];
  if (repeaterCache && repeaterCache.hz === hz) return repeaterCache.matches;
  const s = settings?.get();
  const matches = db.lookupRepeaters(hz, { lat: s?.lat, lon: s?.lon, limit: 5 });
  repeaterCache = { hz, matches };
  return matches;
}

/** RadioReference's cached view of the current frequency, resolved for the talkgroup and NAC in hand. */
function rrFor(s: ScannerSnapshot): ScannerSnapshot['rr'] {
  if (!rr || !s.status) return null;
  const d = describeSnapshot(s);
  const nac = /^NAC\s+(\S+)/i.exec(d.tone)?.[1] ?? null;
  return rr.info(s.status.frequencyHz, { tgid: d.tgid, nac });
}

/** The user's lookup order; a lookup switched off here is neither queried nor shown. */
function lookups(): LookupPref[] {
  return settings?.get().lookups ?? DEFAULT_LOOKUPS.map((p) => ({ ...p }));
}

/** Attach the DMR user for the current radio ID, and the nearest Ofcom licences, amateur repeaters and RadioReference data for the frequency. */
function enrich(s: ScannerSnapshot): ScannerSnapshot {
  const rid = snapshotRadioId(s);
  const radioUser = db && rid !== null ? (s.radioUser?.id === rid ? s.radioUser : (db.lookupDmrUser(rid) ?? null)) : null;
  const prefs = lookups();
  const licences = s.status && lookupEnabled(prefs, 'WTR') ? licencesFor(s.status.frequencyHz) : [];
  const repeaters = s.status && lookupEnabled(prefs, 'UKR') ? repeatersFor(s.status.frequencyHz) : [];
  const confirmed = db && s.status ? confirmedFor(s) : null;
  return { ...s, radioUser, licences, repeaters, rr: lookupEnabled(prefs, 'RRDB') ? rrFor(s) : null, lookups: prefs, confirmed };
}

/** The identity the user confirmed for the current frequency, tone and talkgroup, if any. */
function confirmedFor(s: ScannerSnapshot): ScannerSnapshot['confirmed'] {
  const d = describeSnapshot(s);
  return db!.confirmationFor(s.status!.frequencyHz, d.tone, d.tgid);
}

/** A confirmation as the renderer sent it, checked field by field. */
function sanitizeConfirmation(v: unknown): NewConfirmation {
  if (typeof v !== 'object' || v === null) throw new Error('Bad confirmation');
  const o = v as Record<string, unknown>;
  const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const hz = num(o['frequencyHz']);
  const name = text(o['name']);
  if (hz === null || hz <= 0 || !Number.isInteger(hz)) throw new Error('Bad frequency');
  if (!name) throw new Error('A confirmed identity needs a name');
  const src = o['source'];
  return {
    frequencyHz: hz,
    tone: text(o['tone']),
    tgid: Number.isInteger(o['tgid']) ? (o['tgid'] as number) : null,
    name,
    system: text(o['system']),
    source: src === 'RRDB' || src === 'WTR' || src === 'UKR' ? src : 'USER',
    detail: text(o['detail']),
    distanceKm: num(o['distanceKm']),
    bearingDeg: num(o['bearingDeg']),
  };
}

/** Settings as the renderer may see them: the RadioReference password stays in main. */
function publicSettings(s: Settings): Settings {
  return { ...s, rr: { ...s.rr, password: '' } };
}

const scanTimeout = new ScanTimeout();

const session = new ScannerSession(serialTransportFactory, {
  onSnapshot: (raw: ScannerSnapshot) => {
    // Ask RadioReference about a frequency once the squelch has opened on it (never while sweeping).
    if (rr && raw.status?.squelch.rf && lookupEnabled(lookups(), 'RRDB')) rr.request(raw.status.frequencyHz);
    const s = enrich(raw);
    broadcast(IPC.snapshot, s);
    logger?.onSnapshot(s);
    // Parked on one carrier for longer than the user allows (Data menu): press ► so scanning resumes.
    const limit = settings?.get().scanTimeoutS ?? null;
    if (scanTimeout.update(s, limit === null ? null : limit * 1000)) {
      console.log(`[scan] ${(s.status!.frequencyHz / 1e6).toFixed(4)} MHz held for ${limit} s: resuming`);
      session.pressKey(Key.RIGHT).catch((e: unknown) => console.log(`[scan] resume key failed: ${(e as Error).message}`));
    }
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
  ipcMain.handle(IPC.listPorts, async () => {
    // A system that cannot enumerate ports (no udev on a minimal Linux, say) shows none rather than an error.
    try {
      return await listPorts();
    } catch (e) {
      console.log(`[scanner] cannot list serial ports: ${(e as Error).message}`);
      return [];
    }
  });
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
  ipcMain.handle(IPC.logExportCsv, async (_e, csv: unknown, suggestedName: unknown): Promise<string | null> => {
    if (typeof csv !== 'string') throw new Error('Bad CSV');
    const res = await dialog.showSaveDialog({
      title: 'Export log as CSV',
      defaultPath: join(app.getPath('documents'), typeof suggestedName === 'string' && suggestedName ? suggestedName : 'trx-log.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return null;
    // A BOM so Excel opens it as UTF-8 (callsigns and names are plain ASCII, but places are not always).
    await writeFile(res.filePath, '\uFEFF' + csv, 'utf8');
    return res.filePath;
  });
  ipcMain.handle(IPC.logConfirmations, () => db?.confirmations() ?? []);
  ipcMain.handle(IPC.logTraffic, (_e, hz: unknown) => (db && typeof hz === 'number' ? db.traffic(hz) : []));
  ipcMain.handle(IPC.logConfirm, (_e, c: unknown) => {
    if (!db) throw new Error('No log');
    const conf = sanitizeConfirmation(c);
    const saved = db.confirm(conf);
    // The hero and the open reception follow the confirmation at once.
    broadcast(IPC.snapshot, enrich(session.getSnapshot()));
    return saved;
  });
  ipcMain.handle(IPC.logUnconfirm, (_e, id: unknown) => {
    if (!db || typeof id !== 'number') throw new Error('Bad confirmation');
    db.unconfirm(id);
    broadcast(IPC.snapshot, enrich(session.getSnapshot()));
  });
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
  ipcMain.handle(IPC.wtrLookup, (_e, hz: unknown) => (typeof hz === 'number' && lookupEnabled(lookups(), 'WTR') ? licencesFor(hz) : []));
  ipcMain.handle(IPC.repeatersImport, async (): Promise<ImportResult | null> => {
    if (!db) throw new Error('Database not open');
    const res = await dialog.showOpenDialog({
      title: 'Import UK repeater list (ETCC CSV from ukrepeater.net)',
      filters: [
        { name: 'ETCC repeater list', extensions: ['csv'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    const parsed = await readRepeaterCsv(file);
    if (parsed.rows.length === 0) throw new Error('No repeaters found in that file');
    const name = file.split(/[\\/]/).pop() ?? file;
    const imported = db.replaceRepeaters(parsed.rows, name);
    repeaterCache = null;
    console.log(`[repeaters] imported ${imported} repeaters from ${file} (${parsed.read} rows read, ${parsed.skipped} skipped)`);
    return { imported, skipped: parsed.skipped, file: name };
  });
  ipcMain.handle(IPC.repeatersLookup, (_e, hz: unknown) => (typeof hz === 'number' && lookupEnabled(lookups(), 'UKR') ? repeatersFor(hz) : []));
  ipcMain.handle(IPC.settingsGet, () => (settings ? publicSettings(settings.get()) : null));
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => {
    if (!settings || typeof patch !== 'object' || patch === null) throw new Error('Bad settings');
    const p = { ...(patch as Partial<Settings>) };
    // The renderer never carries the password; only rr:account-set changes it.
    if (p.rr) p.rr = { ...settings.get().rr, ...p.rr, password: settings.get().rr.password };
    const next = settings.set(p);
    licenceCache = null;
    repeaterCache = null;
    // A new location or lookup order changes what the current frequency shows: republish it.
    broadcast(IPC.snapshot, enrich(session.getSnapshot()));
    return publicSettings(next);
  });
  ipcMain.handle(IPC.rrStatus, () => rr?.status() ?? null);
  ipcMain.handle(IPC.rrAccountSet, (_e, username: unknown, password: unknown) => {
    if (!rr || !settings || typeof username !== 'string' || typeof password !== 'string') throw new Error('Bad account');
    const cur = settings.get().rr;
    let stored = cur.password;
    if (password !== '') {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This account cannot encrypt the password (safeStorage unavailable)');
      stored = safeStorage.encryptString(password).toString('base64');
    }
    settings.set({ rr: { ...cur, username: username.trim(), password: username.trim() ? stored : '' } });
    rr.resetFailures();
    return rr.status();
  });
  ipcMain.handle(IPC.rrTest, async () => {
    const client = rr?.client();
    if (!client) throw new Error(rr?.status().appKey ? 'Enter your RadioReference username and password first' : 'This build has no RadioReference key');
    return client.getUserData();
  });
  ipcMain.handle(IPC.rrCountries, async () => {
    const client = rr?.client();
    if (!client) throw new Error('Enter your RadioReference username and password first');
    return (await client.getCountryList()).map((c) => ({ id: c.coid, name: c.name, code: c.code }));
  });
  ipcMain.handle(IPC.rrStates, async (_e, coid: unknown) => {
    const client = rr?.client();
    if (!client || typeof coid !== 'number') throw new Error('Enter your RadioReference username and password first');
    return (await client.getStates(coid)).map((r) => ({ id: r.stid, name: r.name, code: r.code }));
  });
  ipcMain.handle(IPC.rrRegionSet, (_e, region: unknown) => {
    if (!rr || !settings || typeof region !== 'object' || region === null) throw new Error('Bad region');
    const r = region as { coid?: unknown; stid?: unknown; countryName?: unknown; stateName?: unknown };
    settings.set({
      rr: {
        ...settings.get().rr,
        coid: typeof r.coid === 'number' ? r.coid : null,
        stid: typeof r.stid === 'number' ? r.stid : null,
        countryName: typeof r.countryName === 'string' ? r.countryName : '',
        stateName: typeof r.stateName === 'string' ? r.stateName : '',
      },
    });
    rr.resetFailures();
    return rr.status();
  });
  ipcMain.handle(IPC.rrClearCache, () => {
    rr?.clearCache();
    return rr?.status() ?? null;
  });
  ipcMain.handle(IPC.rrLookup, (_e, hz: unknown) => {
    if (!rr || typeof hz !== 'number') return null;
    rr.request(hz, true);
    return rr.info(hz);
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
  rr = new RrService({
    db,
    appKey: __RR_APP_KEY__,
    getSettings: () => settings!.get().rr,
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
    passwordStore: () => (IS_LINUX ? safeStorage.getSelectedStorageBackend() : 'os'),
    getLocation: () => {
      const s = settings!.get();
      return { lat: s.lat, lon: s.lon, radiusKm: s.radiusKm };
    },
    fetchImpl: net.fetch as unknown as FetchLike,
    // A lookup landed: show it on the current frequency and let the log absorb the names.
    onChange: () => broadcast(IPC.snapshot, enrich(session.getSnapshot())),
    log: (msg) => console.log(`[rr] ${msg}`),
  });
  console.log(`[rr] ${rr.status().appKey ? 'app key present' : 'no app key in this build'}; ${rr.enabled ? 'enabled' : 'not configured'}`);
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
    // Frameless with the native window controls drawn over our own top bar:
    // Windows puts minimise / maximise / close at the top right (the overlay),
    // macOS its traffic lights at the top left, vertically centred in the 46 px bar.
    // Linux has no overlay, so it keeps the window manager's own frame.
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 15 } }
      : IS_LINUX
        ? {}
        : {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: nativeTheme.shouldUseDarkColors
              ? { color: CHROME.dark.overlay, symbolColor: CHROME.dark.symbol, height: 46 }
              : { color: CHROME.light.overlay, symbolColor: CHROME.light.symbol, height: 46 },
          }),
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
  // Linux without a keyring (GNOME Keyring / KWallet) has only Electron's basic_text backend:
  // accept it, obfuscated rather than encrypted, and say so in the Data dialog, instead of
  // refusing to store the RadioReference password at all.
  if (IS_LINUX && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    safeStorage.setUsePlainTextEncryption(true);
    console.log('[rr] no keyring found: the RadioReference password will be stored obfuscated, not encrypted');
  }
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
  rr?.dispose();
  rr = null;
});
