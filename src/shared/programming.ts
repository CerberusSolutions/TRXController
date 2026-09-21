/**
 * The scanner's programming as EZ Scan writes it to the SD card's CDAT folder (read by
 * `src/main/programming/cdat.ts`). Field names follow EZ Scan's own columns so the Programming window
 * can mirror its screens.
 */

export type Modulation = 'AM' | 'FM' | 'NFM' | 'DMR' | 'NXDN' | 'AUTO' | string;
export type DMode = 'Auto' | 'Analog' | 'Digital';

export interface ToneSetting {
  /** EZ Scan's "Tone Type": None, Search, CTCSS, DCS (other codes are shown as they come). */
  type: 'None' | 'Search' | 'CTCSS' | 'DCS' | string;
  /** "94.8" for CTCSS, the code for DCS, '' otherwise. */
  value: string;
}

/** One conventional object (a channel). */
export interface ProgObject {
  /** Record number, EZ Scan's Rec# (0-based). An object added in the editor gets the next number after the card's last; the save renumbers. */
  index: number;
  name: string;
  frequencyHz: number;
  modulation: Modulation;
  dmode: DMode;
  tone: ToneSetting;
  skip: boolean;
  /** EZ Scan's Backlight column: Leave, Flash, or the raw code. */
  backlight: string;
  /** Seconds, EZ Scan's Delay Time. */
  delayS: number;
  led: { on: boolean; colour: string | null };
  /** A DMR object: EZ Scan shows talkgroup, colour code and slot as `*` (any) unless set. */
  digital: boolean;
  /** 'any' when the colour code is a wildcard, 'set' when one is programmed, null for analogue. */
  colourCode: 'any' | 'set' | null;
  nxdn: boolean;
  /** Scanlist numbers (1-200) the object belongs to. */
  scanlists: number[];
}

export interface ProgScanlist {
  number: number;
  name: string;
  enabled: boolean;
  /** Object record numbers, in the scanlist's own order. */
  objects: number[];
}

export interface ProgScanSet {
  number: number;
  name: string;
  enabled: boolean;
  scanlists: number[];
}

export interface ProgSite {
  name: string;
  frequenciesHz: number[];
}

export interface ProgTalkgroup {
  name: string;
  id: number;
  scanlists: number[];
}

export interface ProgTrunkedSystem {
  number: number;
  name: string;
  sites: ProgSite[];
  talkgroups: ProgTalkgroup[];
}

export interface ProgGlobals {
  /** The five welcome lines shown at power-on. */
  welcome: string[];
  /** RSSI thresholds for the five signal bars. */
  signalBars: number[];
  /** The last Tune Mode frequency the scanner saved, if any. */
  lastTuneHz: number | null;
  /** EZ Scan's Search Delay Time, seconds; null when the file is too short to hold it. */
  searchDelayS: number | null;
  /** The search the WX button starts, as the scanner's code (`WX_BUTTON` names the known ones). */
  wxButton: number | null;
  /** Search lockouts, Hz, lowest first. */
  lockoutsHz: number[];
}

/** WX button operations by code, as far as seen (EZ Scan's list has more; unknown codes are shown as "Mode N"). */
export const WX_BUTTON: Readonly<Record<number, string>> = { 0: 'Pub Safety', 3: 'Amateur' };
/** How many lockouts ISCAN___.GLB holds: its table runs from `GLB_LOCKOUTS` to the end of the 1,706-byte file. */
export const GLB_LOCKOUTS = 694;
export const GLB_SEARCH_DELAY = 512;
export const GLB_WX_BUTTON = 566;

/** Everything read from one CDAT folder. */
export interface Programming {
  dir: string;
  /** The card's DESCRIPT.TXT, EZ Scan's name for the configuration. */
  description: string;
  globals: ProgGlobals;
  objects: ProgObject[];
  scanlists: ProgScanlist[];
  scanSets: ProgScanSet[];
  trunked: ProgTrunkedSystem[];
  readAt: number;
}

/** A CDAT folder found on a mounted volume: the card's live `CDAT`, or a `CDAT_VS.nnn` V-Scanner folder beside it. */
export interface CdatCandidate {
  dir: string;
  description: string;
  kind: 'card' | 'vscanner';
}

/** Where a save goes: over the folder that was read (after a backup beside it), or into a new V-Scanner folder beside it. */
export type ProgSaveTarget = { kind: 'inplace' } | { kind: 'vscanner'; description: string };

export interface ProgSaveResult {
  /** The folder written. */
  dir: string;
  /** The copy of the original folder taken before an in-place save. */
  backupDir: string | null;
  /** How many files were written. */
  files: number;
}

/** EZ Scan's channel types: analogue (or P25), DMR, NXDN. Which digital flags an object carries. */
export type ChannelType = 'analog' | 'dmr' | 'nxdn';
export const channelTypeOf = (o: Pick<ProgObject, 'digital' | 'nxdn'>): ChannelType => (o.nxdn ? 'nxdn' : o.digital ? 'dmr' : 'analog');


/** The 50 CTCSS tones in the order the scanner indexes them. */
export const CTCSS_TONES = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4,
  156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1,
] as const;
