import { create } from 'zustand';
import type { ReceptionRow } from '../../../shared/ipc';
import type { Confirmation, NewConfirmation } from '../../../shared/confirm';

/** Rows fetched per page: the first load, and each fetch as the user scrolls towards the bottom. */
export const PAGE = 500;
/** The most rows kept in memory. Beyond this the table says so instead of loading more. */
export const MAX_ROWS = 5000;

interface LogState {
  rows: ReceptionRow[];
  filter: string;
  loaded: boolean;
  /** No more pages: the log has been read to its end, or `MAX_ROWS` are loaded (`capped`). */
  exhausted: boolean;
  capped: boolean;
  loadingMore: boolean;
  /** Identities the user has confirmed by hand, every frequency. */
  confirmations: Confirmation[];
  setFilter: (f: string) => void;
  load: () => Promise<void>;
  /** Fetch the page after the oldest row loaded. A no-op while one is in flight or nothing is left. */
  loadMore: () => Promise<void>;
  upsert: (row: ReceptionRow) => void;
  clear: () => Promise<void>;
  confirm: (c: NewConfirmation) => Promise<void>;
  unconfirm: (id: number) => Promise<void>;
}

export const useLog = create<LogState>((set, get) => ({
  rows: [],
  filter: '',
  loaded: false,
  exhausted: false,
  capped: false,
  loadingMore: false,
  confirmations: [],

  setFilter: (filter) => set({ filter }),

  // Reloads as many rows as are already shown (at least a page), so a reload after a confirmation
  // does not throw away the pages the user has scrolled through.
  load: async () => {
    if (!window.trx) return;
    const n = Math.min(MAX_ROWS, Math.max(PAGE, get().rows.length));
    const [rows, confirmations] = await Promise.all([window.trx.logRecent(n), window.trx.logConfirmations?.() ?? []]);
    set({ rows, confirmations, loaded: true, exhausted: rows.length < n, capped: false });
  },

  loadMore: async () => {
    const { rows, exhausted, loadingMore } = get();
    if (!window.trx || exhausted || loadingMore) return;
    const last = rows[rows.length - 1];
    if (!last) return;
    if (rows.length >= MAX_ROWS) {
      set({ exhausted: true, capped: true });
      return;
    }
    set({ loadingMore: true });
    try {
      const more = await window.trx.logRecent(PAGE, { endedAt: last.endedAt, startedAt: last.startedAt, id: last.id });
      // Rows that moved up while the page was in flight (a reopened conversation) are already here.
      const seen = new Set(get().rows.map((r) => r.id));
      const next = [...get().rows, ...more.filter((r) => !seen.has(r.id))].slice(0, MAX_ROWS);
      const capped = next.length >= MAX_ROWS && more.length >= PAGE;
      set({ rows: next, exhausted: more.length < PAGE || capped, capped });
    } finally {
      set({ loadingMore: false });
    }
  },

  // A confirmation renames every row it applies to, so the log is reloaded rather than patched.
  confirm: async (c) => {
    if (!window.trx) return;
    await window.trx.logConfirm(c);
    await get().load();
  },

  unconfirm: async (id) => {
    if (!window.trx) return;
    await window.trx.logUnconfirm(id);
    await get().load();
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
    // A new entry on a frequency bumps the hit count of earlier rows too.
    if (i < 0) next = next.map((r) => (r.id !== row.id && r.frequencyHz === row.frequencyHz ? { ...r, hits: r.hits + 1 } : r));
    // A reopened row moves back to the top: order by last activity, open rows first.
    next.sort((a, b) => lastActivity(b) - lastActivity(a) || b.startedAt - a.startedAt || b.id - a.id);
    set({ rows: next });
  },

  clear: async () => {
    if (!window.trx) return;
    await window.trx.logClear();
    set({ rows: [], exhausted: true, capped: false });
  },
}));

function lastActivity(r: ReceptionRow): number {
  return r.endedAt ?? Number.MAX_SAFE_INTEGER;
}

export function attachLogEvents(): () => void {
  if (!window.trx) return () => undefined;
  const off = window.trx.onLogUpsert((row) => useLog.getState().upsert(row));
  void useLog.getState().load();
  return off;
}

export function rowMatches(r: ReceptionRow, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  const hay = [r.name, r.system, r.scanlist, r.objectType, r.mode, r.site, r.squelch, r.tone, (r.frequencyHz / 1e6).toFixed(6), r.tgid ?? '', r.radioId ?? '', r.radioCallsign ?? '', r.radioName ?? '', r.source ?? '', r.scannerName ?? '', r.wtr ?? '', r.rrName ?? '', r.rrSystem ?? '', r.rpt ?? '', r.rruk ?? '', ...(r.candidates ?? []).map((c) => c.name)]
    .join(' ')
    .toLowerCase();
  return f.split(/\s+/).every((word) => hay.includes(word));
}
