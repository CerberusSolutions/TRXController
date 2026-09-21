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
  /** Record number, EZ Scan's Rec# (0-based). */
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
  isDefault: boolean;
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
}

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

/** A CDAT folder found on a mounted volume. */
export interface CdatCandidate {
  dir: string;
  description: string;
}

/** The 50 CTCSS tones in the order the scanner indexes them. */
export const CTCSS_TONES = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4,
  156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1,
] as const;
