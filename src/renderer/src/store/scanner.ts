import { create } from 'zustand';
import type { PortInfo, ScannerSnapshot } from '../../../shared/ipc';
import { useBand } from './band';

function emptySnapshot(): ScannerSnapshot {
  return {
    link: { status: 'disconnected', port: null, error: null },
    version: null,
    status: null,
    lcd: null,
    active: null,
    radioUser: null,
    licences: [],
    stats: { requests: 0, responses: 0, timeouts: 0, late: 0, frameErrors: 0, consecutiveTimeouts: 0, lastRttMs: null },
    updatedAt: 0,
  };
}

export const MAX_CCDUMP_LINES = 200;

interface ScannerState {
  snapshot: ScannerSnapshot;
  ports: PortInfo[];
  selectedPort: string | null;
  busy: boolean;
  ccdump: string[];
  /** Key code most recently pressed, for a brief highlight. */
  lastKey: number | null;
  /** Progress of a click-to-tune / typed tune, shown until it clears. */
  tuneState: { hz: number; phase: 'tuning' | 'done' | 'error'; message?: string } | null;
  tune: (hz: number) => Promise<void>;
  resumeScan: () => Promise<void>;
  setSnapshot: (s: ScannerSnapshot) => void;
  refreshPorts: () => Promise<void>;
  selectPort: (path: string) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  pressKey: (code: number) => Promise<void>;
  pushCcDump: (line: string) => void;
}

/** Electron wraps thrown errors as "Error invoking remote method 'x': Error: msg". */
function ipcMessage(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

const api = (): Window['trx'] => {
  if (!window.trx) throw new Error('Not running inside Electron');
  return window.trx;
};

export const useScanner = create<ScannerState>((set, get) => ({
  snapshot: emptySnapshot(),
  ports: [],
  selectedPort: null,
  busy: false,
  ccdump: [],
  lastKey: null,
  tuneState: null,

  tune: async (hz) => {
    set({ tuneState: { hz, phase: 'tuning' } });
    try {
      await api().tune(hz);
      set({ tuneState: { hz, phase: 'done' } });
      setTimeout(() => {
        if (get().tuneState?.phase === 'done') set({ tuneState: null });
      }, 2500);
    } catch (e) {
      set({ tuneState: { hz, phase: 'error', message: ipcMessage(e) } });
    }
  },

  resumeScan: async () => {
    set({ tuneState: null });
    try {
      await api().resumeScan();
    } catch (e) {
      set({ tuneState: { hz: 0, phase: 'error', message: ipcMessage(e) } });
    }
  },

  setSnapshot: (snapshot) => {
    const { ports, selectedPort } = get();
    const port = snapshot.link.port;
    // Main may connect on its own (remembered port): keep the selector in step.
    if (port && snapshot.link.status !== 'disconnected' && port !== selectedPort) {
      set({ snapshot, selectedPort: port });
      if (!ports.some((p) => p.path === port)) void get().refreshPorts();
    } else {
      set({ snapshot });
    }
    useBand.getState().ingest(snapshot);
  },

  refreshPorts: async () => {
    const [ports, settings] = await Promise.all([api().listPorts(), api().settingsGet().catch(() => null)]);
    const current = get().selectedPort ?? settings?.port ?? null;
    // Keep the current (or remembered) choice if present, else the Whistler USB port, else first.
    const whistler = ports.find((p) => (p.vendorId ?? '').toUpperCase() === '2A59');
    const selectedPort =
      current && ports.some((p) => p.path === current) ? current : (whistler ?? ports[0])?.path ?? null;
    set({ ports, selectedPort });
  },

  selectPort: (path) => set({ selectedPort: path }),

  connect: async () => {
    const port = get().selectedPort;
    if (!port) return;
    set({ busy: true });
    try {
      await api().connect(port);
    } finally {
      set({ busy: false });
    }
  },

  disconnect: async () => {
    set({ busy: true });
    try {
      await api().disconnect();
    } finally {
      set({ busy: false });
    }
  },

  pressKey: async (code) => {
    set({ lastKey: code });
    setTimeout(() => {
      if (get().lastKey === code) set({ lastKey: null });
    }, 180);
    await api().sendKey(code);
  },

  pushCcDump: (line) => set((s) => ({ ccdump: [...s.ccdump.slice(-(MAX_CCDUMP_LINES - 1)), line] })),
}));

/** Wire the store to the preload API once. Returns an unsubscribe function. */
export function attachScannerEvents(): () => void {
  if (!window.trx) return () => undefined;
  const offSnap = window.trx.onSnapshot((s) => useScanner.getState().setSnapshot(s));
  const offCc = window.trx.onCcDump((l) => useScanner.getState().pushCcDump(l));
  void window.trx.getSnapshot().then((s) => useScanner.getState().setSnapshot(s));
  void useScanner.getState().refreshPorts();
  return () => {
    offSnap();
    offCc();
  };
}
