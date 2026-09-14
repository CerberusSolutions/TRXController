import { create } from 'zustand';
import type { ScannerSnapshot } from '../../../shared/ipc';

/** One frequency the scanner has visited while sweeping or scanning. */
export interface Bin {
  hz: number;
  peakRssi: number;
  lastRssi: number;
  samples: number;
  lastSeenAt: number;
  /** Times squelch was open when sampled here. */
  opens: number;
  lastOpenAt: number | null;
}

export const MAX_BINS = 6000;

/** Scanner modes in which the frequency stream is worth charting. */
const CHARTED_MODES = new Set([0x0a, 0x11, 0x12, 0x09]); // Scan, Sweeper, Search, Monitor

interface BandState {
  bins: Map<number, Bin>;
  /** Bumped on every change so components can subscribe cheaply. */
  version: number;
  currentHz: number | null;
  mode: number | null;
  startedAt: number | null;
  ingest: (s: ScannerSnapshot, now?: number) => void;
  reset: () => void;
}

export const useBand = create<BandState>((set, get) => ({
  bins: new Map(),
  version: 0,
  currentHz: null,
  mode: null,
  startedAt: null,

  ingest: (s, now = Date.now()) => {
    const st = s.status;
    if (!st || !CHARTED_MODES.has(st.mode) || st.frequencyHz <= 0) return;
    const { bins } = get();
    const hz = st.frequencyHz;
    const open = st.squelch.rf;
    const b = bins.get(hz);
    if (b) {
      b.peakRssi = Math.max(b.peakRssi, st.rssi);
      b.lastRssi = st.rssi;
      b.samples++;
      b.lastSeenAt = now;
      if (open) {
        b.opens++;
        b.lastOpenAt = now;
      }
    } else {
      if (bins.size >= MAX_BINS) {
        // Drop the stalest bin to bound memory.
        let oldest: Bin | null = null;
        for (const x of bins.values()) if (!oldest || x.lastSeenAt < oldest.lastSeenAt) oldest = x;
        if (oldest) bins.delete(oldest.hz);
      }
      bins.set(hz, { hz, peakRssi: st.rssi, lastRssi: st.rssi, samples: 1, lastSeenAt: now, opens: open ? 1 : 0, lastOpenAt: open ? now : null });
    }
    set((prev) => ({ version: prev.version + 1, currentHz: hz, mode: st.mode, startedAt: prev.startedAt ?? now }));
  },

  reset: () => set({ bins: new Map(), version: 0, currentHz: null, startedAt: null }),
}));
