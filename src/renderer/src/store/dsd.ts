import { create } from 'zustand';
import type { DsdStatus } from '../../../shared/dsd';
import type { DsdDaySummary, DsdNetworkSummary } from '../../../shared/dsdEvents';

interface DsdState {
  /** What the DSD+ folder watcher sees; null until main has answered. */
  status: DsdStatus | null;
  setStatus: (s: DsdStatus | null) => void;
  chooseFolder: () => Promise<void>;
  clearFolder: () => Promise<void>;
  open: () => void;
  /** The History view's summary for `dayKey` (the period as "from-to") on `dayNetwork`; null until fetched or when nothing is recorded. */
  day: DsdDaySummary | null;
  dayKey: string | null;
  dayNetwork: string | null;
  dayBusy: boolean;
  networks: DsdNetworkSummary[];
  loadDay: (network: string, from: number, to: number) => Promise<void>;
  loadNetworks: () => Promise<void>;
}

export const useDsd = create<DsdState>((set, get) => ({
  status: null,
  setStatus: (status) => set({ status }),
  chooseFolder: async () => {
    if (!window.trx?.dsdChooseFolder) return;
    await window.trx.dsdChooseFolder();
    set({ status: (await window.trx.dsdStatus?.()) ?? null });
  },
  clearFolder: async () => {
    if (!window.trx?.settingsSet) return;
    await window.trx.settingsSet({ dsd: { folder: null, dock: 'right', window: null } });
    set({ status: (await window.trx.dsdStatus?.()) ?? null });
  },
  open: () => void window.trx?.dsdOpen?.(),
  day: null,
  dayKey: null,
  dayNetwork: null,
  dayBusy: false,
  networks: [],
  loadDay: async (network, from, to) => {
    if (!window.trx?.dsdSummary) return;
    const day = `${from}-${to}`;
    set({ dayBusy: true, dayKey: day, dayNetwork: network });
    try {
      const summary = await window.trx.dsdSummary(network, from, to);
      // A later request may have overtaken this one: keep only the answer for the day in hand.
      if (get().dayKey === day && get().dayNetwork === network) set({ day: summary, dayBusy: false });
    } catch {
      set({ day: null, dayBusy: false });
    }
  },
  loadNetworks: async () => {
    if (!window.trx?.dsdNetworks) return;
    set({ networks: await window.trx.dsdNetworks() });
  },
}));

export function attachDsdEvents(): () => void {
  if (!window.trx?.onDsdUpdate) return () => undefined;
  const off = window.trx.onDsdUpdate((s) => useDsd.getState().setStatus(s));
  void window.trx.dsdStatus?.().then((s) => useDsd.getState().setStatus(s));
  return off;
}
