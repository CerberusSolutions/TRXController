import { create } from 'zustand';
import type { PortInfo, ScannerSnapshot } from '../../../shared/ipc';
import { useBand } from './band';
import { holdDetails, type HeldDetails } from '../lib/format';
import { DEFAULT_LOOKUPS } from '../../../shared/sources';

function emptySnapshot(): ScannerSnapshot {
  return {
    clock: { sentAt: null, order: 'le', verified: null, scannerTime: null, offsetS: null },
  link: { status: 'disconnected', port: null, error: null, stall: null },
    power: null,
    version: null,
    status: null,
    lcd: null,
    active: null,
    radioUser: null,
    licences: [],
    repeaters: [],
    rr: null,
    rruk: null,
    stats: { requests: 0, responses: 0, timeouts: 0, late: 0, frameErrors: 0, consecutiveTimeouts: 0, lastRttMs: null },
    updatedAt: 0,
    lookups: DEFAULT_LOOKUPS.map((p) => ({ ...p })),
    confirmed: null,
  };
}

export const MAX_CCDUMP_LINES = 200;
/** A tune / scan failure message clears itself after this long. */
const ERROR_SHOWN_MS = 8000;

/** The second scanner's live state, kept beside RX1's (which the fields below carry, as they always have). */
export interface Rx2State {
  snapshot: ScannerSnapshot;
  held: HeldDetails | null;
  selectedPort: string | null;
  busy: boolean;
  /** Why the last Connect / Disconnect was refused, until the next try. */
  error: string | null;
  tuneState: TuneState | null;
  lastKey: number | null;
}

/** Progress of a click-to-tune / typed tune, shown until it clears. */
export interface TuneState {
  hz: number;
  phase: 'tuning' | 'done' | 'error';
  message?: string;
}

/** One receiver's live state as the components read it: RX1's from the store's own fields, RX2's from `rx2`. */
export interface RxView {
  snapshot: ScannerSnapshot;
  held: HeldDetails | null;
  selectedPort: string | null;
  busy: boolean;
  error: string | null;
  tuneState: TuneState | null;
  lastKey: number | null;
}

interface ScannerState {
  snapshot: ScannerSnapshot;
  /** RX2, when the window has a second scanner. Its fields follow RX1's one for one. */
  rx2: Rx2State;
  setSnapshot2: (s: ScannerSnapshot) => void;
  selectPort2: (path: string) => void;
  connect2: () => Promise<void>;
  disconnect2: () => Promise<void>;
  /** TGID / radio ID / slot seen so far on the current reception; null once the signal has dropped. */
  held: HeldDetails | null;
  ports: PortInfo[];
  /** Why the ports could not be listed, when they could not. */
  portsError: string | null;
  selectedPort: string | null;
  busy: boolean;
  /** Why the last Connect / Disconnect was refused (the port is the other scanner's, no such scanner), until the next try. */
  error: string | null;
  ccdump: string[];
  /** Key code most recently pressed, for a brief highlight. */
  lastKey: number | null;
  /** Progress of a click-to-tune / typed tune on RX1, shown until it clears (RX2's is `rx2.tuneState`). */
  tuneState: TuneState | null;
  /** The receiver's index is the last argument: 0 (RX1) when left out, so every single-scanner caller is unchanged. */
  tune: (hz: number, rx?: number) => Promise<void>;
  resumeScan: (rx?: number) => Promise<void>;
  setSnapshot: (s: ScannerSnapshot) => void;
  refreshPorts: () => Promise<void>;
  selectPort: (path: string) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  pressKey: (code: number, rx?: number) => Promise<void>;
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

/** RX1's view, built once per store state: selectors call `rxView` a dozen times per update, so it must not allocate each time. */
const rx1Views = new WeakMap<ScannerState, RxView>();

/** The receiver's state for the components (the hero, display, keypad, status bar each live under one `RxContext`). */
export function rxView(s: ScannerState, rx: number): RxView {
  if (rx === 1) return s.rx2;
  let v = rx1Views.get(s);
  if (!v) {
    v = { snapshot: s.snapshot, held: s.held, selectedPort: s.selectedPort, busy: s.busy, error: s.error, tuneState: s.tuneState, lastKey: s.lastKey };
    rx1Views.set(s, v);
  }
  return v;
}

export const useScanner = create<ScannerState>((set, get) => ({
  snapshot: emptySnapshot(),
  rx2: { snapshot: emptySnapshot(), held: null, selectedPort: null, busy: false, error: null, tuneState: null, lastKey: null },
  setSnapshot2: (snapshot) => {
    const { rx2 } = get();
    const port = snapshot.link.port;
    const held = holdDetails(rx2.held, snapshot);
    const selectedPort = port && snapshot.link.status !== 'disconnected' && port !== rx2.selectedPort ? port : rx2.selectedPort;
    set({ rx2: { ...rx2, snapshot, held, selectedPort } });
    useBand.getState().ingest(snapshot, 1);
  },
  selectPort2: (path) => set((s) => ({ rx2: { ...s.rx2, selectedPort: path } })),
  connect2: async () => {
    const port = get().rx2.selectedPort;
    if (!port) return;
    set((s) => ({ rx2: { ...s.rx2, busy: true, error: null } }));
    try {
      await api().connect(port, 1);
    } catch (e) {
      set((s) => ({ rx2: { ...s.rx2, error: ipcMessage(e) } }));
    } finally {
      set((s) => ({ rx2: { ...s.rx2, busy: false } }));
    }
  },
  disconnect2: async () => {
    set((s) => ({ rx2: { ...s.rx2, busy: true, error: null } }));
    try {
      await api().disconnect(1);
    } catch (e) {
      set((s) => ({ rx2: { ...s.rx2, error: ipcMessage(e) } }));
    } finally {
      set((s) => ({ rx2: { ...s.rx2, busy: false } }));
    }
  },
  held: null,
  ports: [],
  portsError: null,
  selectedPort: null,
  busy: false,
  error: null,
  ccdump: [],
  lastKey: null,
  tuneState: null,

  tune: async (hz, rx = 0) => {
    const setTune = (t: TuneState | null): void => (rx === 1 ? set((s) => ({ rx2: { ...s.rx2, tuneState: t } })) : set({ tuneState: t }));
    const current = (): TuneState | null => rxView(get(), rx).tuneState;
    setTune({ hz, phase: 'tuning' });
    try {
      const tuned = await api().tune(hz, rx);
      // "Tuned to" names the frequency the scanner settled on: an airband channel name snaps to its carrier.
      setTune({ hz: typeof tuned === 'number' ? tuned : hz, phase: 'done' });
      setTimeout(() => {
        if (current()?.phase === 'done') setTune(null);
      }, 2500);
    } catch (e) {
      const tuneState = { hz, phase: 'error' as const, message: ipcMessage(e) };
      setTune(tuneState);
      setTimeout(() => {
        if (current() === tuneState) setTune(null);
      }, ERROR_SHOWN_MS);
    }
  },

  resumeScan: async (rx = 0) => {
    const setTune = (t: TuneState | null): void => (rx === 1 ? set((s) => ({ rx2: { ...s.rx2, tuneState: t } })) : set({ tuneState: t }));
    setTune(null);
    try {
      await api().resumeScan(rx);
    } catch (e) {
      const tuneState = { hz: 0, phase: 'error' as const, message: ipcMessage(e) };
      setTune(tuneState);
      setTimeout(() => {
        if (rxView(get(), rx).tuneState === tuneState) setTune(null);
      }, ERROR_SHOWN_MS);
    }
  },

  setSnapshot: (snapshot) => {
    const { ports, selectedPort } = get();
    const port = snapshot.link.port;
    const held = holdDetails(get().held, snapshot);
    // Main may connect on its own (remembered port): keep the selector in step.
    if (port && snapshot.link.status !== 'disconnected' && port !== selectedPort) {
      set({ snapshot, held, selectedPort: port });
      if (!ports.some((p) => p.path === port)) void get().refreshPorts();
    } else {
      set({ snapshot, held });
    }
    useBand.getState().ingest(snapshot, 0);
  },

  refreshPorts: async () => {
    const [listed, settings] = await Promise.all([api().listPorts(), api().settingsGet().catch(() => null)]);
    // The preview mock still answers with a bare array.
    const { ports, error: portsError } = Array.isArray(listed) ? { ports: listed as PortInfo[], error: null } : listed;
    const current = get().selectedPort ?? settings?.port ?? null;
    // Keep the current (or remembered) choice if present, else the Whistler USB port, else first.
    const whistler = ports.find((p) => (p.vendorId ?? '').toUpperCase() === '2A59');
    const selectedPort =
      current && ports.some((p) => p.path === current) ? current : (whistler ?? ports[0])?.path ?? null;
    // RX2 takes its remembered port, else the first port RX1 is not on.
    const current2 = get().rx2.selectedPort ?? settings?.rx2?.port ?? null;
    const selectedPort2 = current2 && ports.some((p) => p.path === current2) ? current2 : (ports.find((p) => p.path !== selectedPort)?.path ?? null);
    set({ ports, portsError, selectedPort, rx2: { ...get().rx2, selectedPort: selectedPort2 } });
  },

  selectPort: (path) => set({ selectedPort: path }),

  connect: async () => {
    const port = get().selectedPort;
    if (!port) return;
    set({ busy: true, error: null });
    try {
      await api().connect(port);
    } catch (e) {
      set({ error: ipcMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  disconnect: async () => {
    set({ busy: true, error: null });
    try {
      await api().disconnect();
    } catch (e) {
      set({ error: ipcMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  pressKey: async (code, rx = 0) => {
    const setLast = (k: number | null): void => (rx === 1 ? set((s) => ({ rx2: { ...s.rx2, lastKey: k } })) : set({ lastKey: k }));
    setLast(code);
    setTimeout(() => {
      if (rxView(get(), rx).lastKey === code) setLast(null);
    }, 180);
    await api().sendKey(code, rx);
  },

  pushCcDump: (line) => set((s) => ({ ccdump: [...s.ccdump.slice(-(MAX_CCDUMP_LINES - 1)), line] })),
}));

/** Wire the store to the preload API once. Returns an unsubscribe function. */
export function attachScannerEvents(): () => void {
  if (!window.trx) return () => undefined;
  const offSnap = window.trx.onSnapshot((s) => useScanner.getState().setSnapshot(s));
  const offSnapRx = window.trx.onSnapshotRx?.((s) => {
    if (s.rx === 1) useScanner.getState().setSnapshot2(s.snapshot);
  });
  const offCc = window.trx.onCcDump((l) => useScanner.getState().pushCcDump(l));
  void window.trx
    .getSnapshot()
    .then((s) => {
      if (s) useScanner.getState().setSnapshot(s);
    })
    .catch(() => undefined);
  // Null until a second scanner is added (an older main throws instead; either way there is nothing to show yet).
  void window.trx
    .getSnapshot(1)
    .then((s) => {
      if (s) useScanner.getState().setSnapshot2(s);
    })
    .catch(() => undefined);
  void useScanner.getState().refreshPorts();
  return () => {
    offSnap();
    offSnapRx?.();
    offCc();
  };
}
