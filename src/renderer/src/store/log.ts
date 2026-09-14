import { create } from 'zustand';
import type { ReceptionRow } from '../../../shared/ipc';

export const MAX_ROWS = 1000;

interface LogState {
  rows: ReceptionRow[];
  filter: string;
  loaded: boolean;
  setFilter: (f: string) => void;
  load: () => Promise<void>;
  upsert: (row: ReceptionRow) => void;
  clear: () => Promise<void>;
}

export const useLog = create<LogState>((set, get) => ({
  rows: [],
  filter: '',
  loaded: false,

  setFilter: (filter) => set({ filter }),

  load: async () => {
    if (!window.trx) return;
    const rows = await window.trx.logRecent(MAX_ROWS);
    set({ rows, loaded: true });
  },

  upsert: (row) => {
    const rows = get().rows;
    const i = rows.findIndex((r) => r.id === row.id);
    let next: ReceptionRow[];
    if (i >= 0) {
      next = rows.slice();
      next[i] = row;
    } else {
      next = [row, ...rows].slice(0, MAX_ROWS);
    }
    // A new reception on a frequency bumps the hit count of earlier rows too.
    if (i < 0) next = next.map((r) => (r.id !== row.id && r.frequencyHz === row.frequencyHz ? { ...r, hits: r.hits + 1 } : r));
    set({ rows: next });
  },

  clear: async () => {
    if (!window.trx) return;
    await window.trx.logClear();
    set({ rows: [] });
  },
}));

export function attachLogEvents(): () => void {
  if (!window.trx) return () => undefined;
  const off = window.trx.onLogUpsert((row) => useLog.getState().upsert(row));
  void useLog.getState().load();
  return off;
}

export function rowMatches(r: ReceptionRow, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  const hay = [r.name, r.system, r.scanlist, r.objectType, r.mode, r.site, r.squelch, (r.frequencyHz / 1e6).toFixed(6), r.tgid ?? '', r.radioId ?? '', r.radioCallsign ?? '', r.radioName ?? '']
    .join(' ')
    .toLowerCase();
  return f.split(/\s+/).every((word) => hay.includes(word));
}
