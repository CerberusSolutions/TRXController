import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { isKeyCode } from '@trxcontroller/rcip';
import { IPC, type ScannerSnapshot } from '../shared/ipc';
import { ScannerSession } from './scanner/session';
import { listPorts, serialTransportFactory } from './scanner/serialTransport';

let win: BrowserWindow | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

const session = new ScannerSession(serialTransportFactory, {
  onSnapshot: (s: ScannerSnapshot) => broadcast(IPC.snapshot, s),
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
  ipcMain.handle(IPC.getSnapshot, () => session.getSnapshot());
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f14',
    title: 'TRXController',
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
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void session.disconnect(false).finally(() => app.quit());
});

app.on('before-quit', () => {
  void session.disconnect(false);
});
