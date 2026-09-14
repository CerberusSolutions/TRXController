import { create } from 'zustand';
import type { PortInfo, ScannerSnapshot } from '../../../shared/ipc';

function emptySnapshot(): ScannerSnapshot {
  return {
    link: { status: 'disconnected', port: null, error: null },
    version: null,
    status: null,
    lcd: null,
    active: null,
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
  setSnapshot: (s: ScannerSnapshot) => void;
  refreshPorts: () => Promise<void>;
  selectPort: (path: string) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  pressKey: (code: number) => Promise<void>;
  pushCcDump: (line: string) => void;
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

  setSnapshot: (snapshot) => set({ snapshot }),

  refreshPorts: async () => {
    const ports = await api().listPorts();
    const current = get().selectedPort;
    // Prefer the Whistler USB port, else keep the current choice, else first.
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
