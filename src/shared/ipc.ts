/**
 * Types shared between main, preload and renderer. Pure types plus channel
 * names; no runtime dependencies on Node or Electron.
 */
import type { ActiveChannel, Lcd, Status, Version } from '@trxcontroller/rcip';

export type LinkStatus = 'disconnected' | 'connecting' | 'connected' | 'unresponsive' | 'error';

export interface PortInfo {
  path: string;
  manufacturer?: string;
  friendlyName?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

export interface LinkStats {
  requests: number;
  responses: number;
  timeouts: number;
  /** Responses that arrived after their request had timed out (still used). */
  late: number;
  frameErrors: number;
  consecutiveTimeouts: number;
  /** Round-trip of the last successful request, ms. */
  lastRttMs: number | null;
}

export interface ScannerSnapshot {
  link: {
    status: LinkStatus;
    port: string | null;
    error: string | null;
  };
  version: Version | null;
  status: Status | null;
  lcd: Lcd | null;
  active: ActiveChannel | null;
  /** DMR user matching active.header.radioId1, when the database knows it. */
  radioUser: DmrUser | null;
  stats: LinkStats;
  /** Wall-clock time (ms since epoch) of the last update. */
  updatedAt: number;
}

/** One logged reception (a period with squelch open on one frequency). */
export interface ReceptionRow {
  id: number;
  /** ms since epoch */
  startedAt: number;
  /** null while the reception is still open */
  endedAt: number | null;
  frequencyHz: number;
  /** AM / FM / NFM from the status frame */
  mode: string;
  /** Signal type from the LCD icons (DG, Dg, AM, FM, NFM, ENC, D2) */
  signalType: string;
  name: string;
  system: string;
  scanlist: string;
  /** CONV, TGRP, ... from the LCD, or Conventional/Talkgroup/Search from the header */
  objectType: string;
  tgid: number | null;
  radioId: number | null;
  site: string;
  squelch: string;
  rssiPeak: number;
  /** Squelch openings merged into this row (a conversation with gaps). */
  calls: number;
  /** Number of receptions logged on this frequency, including this one. */
  hits: number;
  /** Callsign for radioId from the imported DMR user database, if known. */
  radioCallsign: string | null;
  /** Name for radioId from the imported DMR user database, if known. */
  radioName: string | null;
}

/** One entry of the DMR user database (radioid.net). */
export interface DmrUser {
  id: number;
  callsign: string;
  name: string;
  city: string;
  state: string;
  country: string;
}

export interface IdentityStats {
  dmrUsers: number;
  /** ms since epoch of the last import, or null */
  importedAt: number | null;
  /** File name of the last import, or null */
  source: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  file: string;
}

export const IPC = {
  listPorts: 'scanner:list-ports',
  connect: 'scanner:connect',
  disconnect: 'scanner:disconnect',
  sendKey: 'scanner:send-key',
  getSnapshot: 'scanner:get-snapshot',
  snapshot: 'scanner:snapshot',
  ccdump: 'scanner:ccdump',
  logRecent: 'log:recent',
  logClear: 'log:clear',
  logUpsert: 'log:upsert',
  identityStats: 'identities:stats',
  identityImport: 'identities:import',
  identityLookup: 'identities:lookup',
} as const;
