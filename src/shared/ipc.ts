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
    /**
     * Set while the scanner has stopped answering. `loading` when the last
     * reply came from a menu (Main Menu, Scanlist Edit...), which is what a
     * scanlist load looks like: it takes up to a couple of minutes, during
     * which every request and key press is queued and executed afterwards.
     */
    stall: { since: number; loading: boolean } | null;
  };
  version: Version | null;
  status: Status | null;
  lcd: Lcd | null;
  active: ActiveChannel | null;
  /** DMR user matching active.header.radioId1, when the database knows it. */
  radioUser: DmrUser | null;
  /** Nearest Ofcom licences for status.frequencyHz (empty when none imported/matched). */
  licences: WtrMatch[];
  /** Amateur repeaters whose output (or input) is status.frequencyHz, nearest first. */
  repeaters: RepeaterMatch[];
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
  /** Programmed squelch from the header, e.g. "No Tone", "CTCSS 100.0". */
  squelch: string;
  /** Tone detected on the transmission by the scanner's tone lookup, if shown. */
  tone: string;
  /** Nearest Ofcom licensee for the frequency at the time, if the WTR is imported. */
  licensee: string;
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
  /** Ofcom WTR licence rows, and when/from what they were imported. */
  wtrLicences: number;
  wtrImportedAt: number | null;
  wtrSource: string | null;
  /** ETCC repeater rows, and when/from what they were imported. */
  repeaters: number;
  repeatersImportedAt: number | null;
  repeatersSource: string | null;
}

/** One UK amateur repeater or gateway from the ETCC list (ukrepeater.net). */
export interface Repeater {
  id: number;
  callsign: string;
  /** "2M", "70CM", "6M", "23CM", "10M" as the list has it. */
  band: string;
  /** Channel designation, e.g. "RV53", "RU76", "DVU46"; may be blank for gateways. */
  channel: string;
  /** What the repeater transmits, i.e. what a scanner hears. */
  outputHz: number;
  /** The repeater's input, or null if the list has none. */
  inputHz: number | null;
  /** CTCSS access tone in Hz, or null (digital-only, toneburst, unknown). */
  ctcss: number | null;
  /** Maidenhead locator, 4 or 6 characters. */
  locator: string;
  /** Place name as the list has it, e.g. "BRISTOL". */
  where: string;
  lat: number | null;
  lon: number | null;
  /** "FM · DMR · D-STAR · Fusion", whichever apply. */
  modes: string;
}

/** A repeater matched to a heard frequency. */
export interface RepeaterMatch extends Repeater {
  distanceKm: number | null;
  /** Which of the repeater's frequencies the scanner is on. */
  side: 'output' | 'input';
}

/** One Ofcom Wireless Telegraphy Register assignment kept by the importer. */
export interface WtrLicence {
  id: number;
  frequencyHz: number;
  /** 'T' base transmits here, 'R' base receives here (mobiles transmit), 'TR' both, '-' unknown */
  direction: string;
  licensee: string;
  product: string;
  /** Raw emission designator, e.g. 11K0G3EJN */
  emission: string;
  /** 'DIG' | 'NFM' | 'FM' | '' derived from the emission designator */
  mode: string;
  widthHz: number;
  lat: number | null;
  lon: number | null;
  ngr: string;
  licenceNo: string;
}

/** A licence matched to a heard frequency, with distance from the user's location if known. */
export interface WtrMatch extends WtrLicence {
  distanceKm: number | null;
}

/** User settings kept by the main process (userData/settings.json). */
export interface Settings {
  /** Observer location for distance sorting, decimal degrees. */
  lat: number | null;
  lon: number | null;
  /** Only licences within this distance are matched; null = no limit. */
  radiusKm: number | null;
  /** Serial port of the last successful connection, reopened at launch. */
  port: string | null;
  /** False after the user disconnects, so the app stops reconnecting on its own. */
  autoConnect: boolean;
  /** Last window placement, restored at launch when it is still on a screen. */
  window: WindowState | null;
}

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Build identity, from package.json via Electron. */
export interface AppInfo {
  name: string;
  version: string;
  electron: string;
}

/** Result of asking GitHub for the latest release. */
export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  /** The release page. */
  url: string;
  /** The installer asset, if the release has one. */
  downloadUrl: string | null;
  publishedAt: number | null;
  checkedAt: number;
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
  tune: 'scanner:tune',
  resumeScan: 'scanner:resume-scan',
  getSnapshot: 'scanner:get-snapshot',
  snapshot: 'scanner:snapshot',
  ccdump: 'scanner:ccdump',
  logRecent: 'log:recent',
  logClear: 'log:clear',
  logUpsert: 'log:upsert',
  identityStats: 'identities:stats',
  identityImport: 'identities:import',
  identityLookup: 'identities:lookup',
  wtrImport: 'wtr:import',
  wtrLookup: 'wtr:lookup',
  repeatersImport: 'repeaters:import',
  repeatersLookup: 'repeaters:lookup',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  setTheme: 'theme:set',
  appInfo: 'app:info',
  updateCheck: 'app:update-check',
  update: 'app:update',
} as const;

export type ThemeMode = 'light' | 'dark' | 'system';
