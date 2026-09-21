/**
 * Types shared between main, preload and renderer. Pure types plus channel
 * names; no runtime dependencies on Node or Electron.
 */
import type { Confirmation } from './confirm';
import type { Units } from './geo';
import type { Candidate } from './listed';
import type { LookupPref, LookupSource } from './sources';
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
  /**
   * The scanner's own word on its power: it sends an unsolicited `p` (0) when switched off, and any
   * later reply means it is on again. Null until it has said anything. Off is shown in place of the
   * stall it causes ("Scanner off" rather than "Scanner busy").
   */
  power: { on: boolean; at: number } | null;
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
  /** What RadioReference knows about status.frequencyHz, from the local cache; null when RadioReference is not set up. */
  rr: RrInfo | null;
  /** What RadioReference UK lists on status.frequencyHz near the user, from the local cache; null when RRUK is not set up. */
  rruk: RrukInfo | null;
  stats: LinkStats;
  /** Wall-clock time (ms since epoch) of the last update. */
  updatedAt: number;
  /** The lookup order in force when this snapshot was built, so the tracker and hero rank sources the same way. */
  lookups: LookupPref[];
  /** The identity the user confirmed for status.frequencyHz (and the tone / talkgroup in hand), if any. */
  confirmed: Confirmation | null;
}

/** One logged reception (a period with squelch open on one frequency). */
/** Where a page of the log ends: the last row's place in the last-activity order, for the next page. */
export interface LogCursor {
  endedAt: number | null;
  startedAt: number;
  id: number;
}

/** What the map window shows: the scanner's current frequency as it moves, or one log entry, pinned. */
export type MapTarget = { kind: 'follow' } | { kind: 'row'; row: ReceptionRow; /** Index into `row.candidates` of the pin to draw the line to; the log's own choice when absent. */ pick?: number };

/** The serial ports the OS lists, or why it could not list them (shown in the top bar). */
export interface PortsResult {
  ports: PortInfo[];
  error: string | null;
}

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
  /** Lookup that supplied the name (or the system, when the scanner named the object): see `LookupSource`. Blank = the scanner's own programming. */
  source: LookupSource;
  /** What each source said at the time, whichever the lookup order chose: the scanner's own object name, */
  scannerName: string;
  /** the nearest Ofcom licensee, */
  wtr: string;
  /** RadioReference's talkgroup or channel name and its system, */
  rrName: string;
  rrSystem: string;
  /** RadioReference UK's best entry (alpha tag, else callsign), */
  rruk: string;
  /** and the repeater from the RSGB list. */
  rpt: string;
  /**
   * Where the row's identity lies relative to the user (the licensee's licence, the repeater, or
   * RadioReference's site / county when RadioReference named it), km and degrees; null when unplaced.
   */
  distanceKm: number | null;
  bearingDeg: number | null;
  /** The placed identity's own position (the licence, repeater, site or county centre); null when unplaced, or on rows from before it was stored. */
  lat: number | null;
  lon: number | null;
  /** Everything the lookups offered for the frequency at the time, ranked as the hero listed them. */
  candidates: Candidate[];
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

/**
 * Traffic seen on one frequency, grouped by the tone / colour code and talkgroup the receptions
 * carried: how the users sharing a channel tell apart.
 */
export interface TrafficGroup {
  tone: string;
  tgid: number | null;
  /** Logged receptions (rows) and the squelch openings merged into them. */
  receptions: number;
  calls: number;
  firstAt: number;
  lastAt: number;
  /** Distinct radio IDs heard, most recent first, at most a handful; `radioCount` is the full number. */
  radioIds: number[];
  radioCount: number;
  /** Distinct names the rows carry, most frequent first, at most a few. */
  names: string[];
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
  /** Bearing from the user's location, degrees from true north; null when unplaced. */
  bearingDeg: number | null;
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
  /** Bearing from the user's location, degrees from true north; null when unplaced. */
  bearingDeg: number | null;
}

/** A conventional channel RadioReference lists on a frequency. */
export interface RrConventional {
  /** RadioReference's description, the readable name ("National Ice Centre - Security"). */
  descr: string;
  /** The short alpha tag ("NtmIceCH2"); secondary, never used as a name on its own when a description exists. */
  alpha: string;
  /** Tone / code as RadioReference writes it, e.g. "94.8 PL", "023 DPL", "167 NAC", "CC 1". */
  tone: string;
  mode: string;
  callsign: string;
  tags: string[];
  /** County the entry is listed under, once its details are cached. */
  county: string;
  /** Distance and bearing from the user's location to that county's centre, when both are known. */
  distanceKm: number | null;
  bearingDeg: number | null;
  /** The county's centre, when RadioReference gives one. */
  lat: number | null;
  lon: number | null;
}

/** A trunked system RadioReference lists as using the frequency, with the site and talkgroup resolved for the current reception. */
export interface RrSystemInfo {
  sid: number;
  name: string;
  city: string;
  /** Site whose frequency list contains the heard frequency (and whose NAC matches when one was detected). */
  site: { descr: string; location: string; nac: string } | null;
  /** Distance and bearing from the user's location to that site, when both are known. */
  distanceKm: number | null;
  bearingDeg: number | null;
  /** The site's position, else the system's own centre; null when RadioReference has neither. */
  lat: number | null;
  lon: number | null;
  /** The talkgroup the scanner reported, if the system's list has it. */
  talkgroup: { tgDec: number; alpha: string; descr: string; mode: string; enc: number; category: string } | null;
}

/** RadioReference's view of one frequency, from the local cache. */
export interface RrInfo {
  frequencyHz: number;
  conventional: RrConventional[];
  systems: RrSystemInfo[];
  /** When the cache row was fetched; null while nothing is cached yet. */
  fetchedAt: number | null;
  /** A lookup is queued or in flight. */
  pending: boolean;
  /** Why the last lookup for this frequency failed, if it did. */
  error: string | null;
}

/** One entry RadioReference UK lists on a frequency near the user. */
export interface RrukEntry {
  /** Licensee / user as RRUK has it ("FCC RECYCLING (UK) LIMITED", "PMR446"). */
  callsign: string;
  /** The descriptive alpha tag ("PMR446 CH1"); the name shown when present. */
  alpha: string;
  freqMHz: number;
  mode: string;
  tone: string;
  colorCode: string;
  ran: string;
  nac: string;
  /** The code in the scanner's form ("CC 12", "CTCSS 94.8", "NAC 293", "RAN 1"), for matching; '' when none. */
  code: string;
  /** TX/RX as the WTR has it: 'T' base transmits here, 'R' base receives (mobiles transmit), 'TR', or ''. */
  direction: string;
  location: string;
  /** A nationwide or aero allocation: placed everywhere, so it never sinks below local guesses. */
  nationwide: boolean;
  /** Distance from the user's postcode / coordinates, converted from RRUK's miles; null when nationwide or unknown. */
  distanceKm: number | null;
  /** Bearing from the user, degrees; from the server when it sends one, else from the entry's coordinates. */
  bearingDeg: number | null;
  /** The entry's own position and address, when the server sends them (the web search shows them). */
  lat: number | null;
  lon: number | null;
  place: string;
  county: string;
  postcode: string;
  /** Ofcom licence number, when given. */
  licence: string;
  /** RRUK's group ("WTR", "PMR446", …), when given. */
  group: string;
  tags: string;
  isTrunk: boolean;
}

/** RadioReference UK's view of one frequency for the user's location, from the local cache. */
export interface RrukInfo {
  frequencyHz: number;
  entries: RrukEntry[];
  fetchedAt: number | null;
  pending: boolean;
  error: string | null;
}

/** RadioReference UK settings. The API key is the user's own, stored encrypted by safeStorage and blanked when sent to the renderer. */
export interface RrukSettings {
  apiKey: string;
  /** UK postcode (full or outward) to search from; blank = use the location's coordinates. */
  postcode: string;
}

export interface RrukStatus {
  hasKey: boolean;
  /** No stored key, but a development key from the environment is in use. */
  devKey: boolean;
  postcode: string;
  /** A postcode or coordinates are set, so there is somewhere to search from. */
  located: boolean;
  enabled: boolean;
  cachedFreqs: number;
  lastError: string | null;
}

export interface RrRegion {
  id: number;
  name: string;
  code: string;
}

/** RadioReference account and cache state for the Data menu. */
export interface RrStatus {
  /** This build carries an app key (RR_KEY at build time). */
  appKey: boolean;
  /** Where the password is kept: 'os' (Windows DPAPI / macOS Keychain), a Linux keyring backend, or 'basic_text' when Linux has no keyring. */
  passwordStore: string;
  username: string;
  hasPassword: boolean;
  coid: number | null;
  stid: number | null;
  countryName: string;
  stateName: string;
  /** Account, region and key are all present, so lookups run. */
  enabled: boolean;
  cachedFreqs: number;
  cachedSystems: number;
  cachedTalkgroups: number;
  lastError: string | null;
}

/** RadioReference settings. The password is stored encrypted by Electron's safeStorage and blanked when sent to the renderer. */
export interface RrSettings {
  username: string;
  password: string;
  coid: number | null;
  stid: number | null;
  countryName: string;
  stateName: string;
}

/** User settings kept by the main process (userData/settings.json). */
export interface Settings {
  /** RadioReference account and region. */
  rr: RrSettings;
  /** RadioReference UK key and postcode. */
  rruk: RrukSettings;
  /** Which lookups fill in names, in order of preference; the scanner's own programming always comes first. */
  lookups: LookupPref[];
  /** Observer location for distance sorting, decimal degrees. */
  lat: number | null;
  lon: number | null;
  /** Only licences within this distance are matched; null = no limit. */
  radiusKm: number | null;
  /** How distances are shown (always stored in km). */
  units: Units;
  /** Seconds the scanner may sit on one carrier in Scan mode before ► is pressed for it; null = never. */
  scanTimeoutS: number | null;
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
  mapOpen: 'map:open',
  mapTarget: 'map:target',
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
  logExportCsv: 'log:export-csv',
  logConfirm: 'log:confirm',
  logUnconfirm: 'log:unconfirm',
  logConfirmations: 'log:confirmations',
  logTraffic: 'log:traffic',
  identityStats: 'identities:stats',
  identityImport: 'identities:import',
  identityLookup: 'identities:lookup',
  wtrImport: 'wtr:import',
  wtrLookup: 'wtr:lookup',
  repeatersImport: 'repeaters:import',
  repeatersLookup: 'repeaters:lookup',
  rrStatus: 'rr:status',
  rrAccountSet: 'rr:account-set',
  rrTest: 'rr:test',
  rrCountries: 'rr:countries',
  rrStates: 'rr:states',
  rrRegionSet: 'rr:region-set',
  rrClearCache: 'rr:clear-cache',
  rrLookup: 'rr:lookup',
  rrukStatus: 'rruk:status',
  rrukKeySet: 'rruk:key-set',
  rrukTest: 'rruk:test',
  rrukClearCache: 'rruk:clear-cache',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  setTheme: 'theme:set',
  appInfo: 'app:info',
  updateCheck: 'app:update-check',
  update: 'app:update',
} as const;

export type ThemeMode = 'light' | 'dark' | 'system';
