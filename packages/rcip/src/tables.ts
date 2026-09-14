/** Lookup tables transcribed from the protocol spec. */

/** `A` response <mode> byte. */
export const MODES: Readonly<Record<number, string>> = {
  0x00: 'Main Menu',
  0x01: 'Browse Objects',
  0x02: 'Browse Library',
  0x03: 'Location Select',
  0x04: 'Scanlist Edit',
  0x05: 'Scanlist Set Edit',
  0x06: 'Top Search Menu',
  0x07: 'Select Config',
  0x08: 'Update from Library',
  0x09: 'Monitor Object',
  0x0a: 'Scan',
  0x0b: 'Weather',
  0x0c: 'Skywarn',
  0x0d: 'Weather Menu',
  0x0e: 'Sweeper Menu',
  0x0f: 'Service Search Menu',
  0x10: 'Search Lockouts Menu',
  0x11: 'Sweeper',
  0x12: 'Search',
  0x13: 'Search Settings Menu',
  0x14: 'Sweeper Settings Menu',
};

export function modeName(mode: number): string {
  return MODES[mode] ?? `Unknown (0x${mode.toString(16).padStart(2, '0')})`;
}

/** `A` response <rxmode>. */
export const RX_MODES = ['AM', 'FM', 'NFM'] as const;
export type RxMode = (typeof RX_MODES)[number];

export function rxModeName(v: number): RxMode | `Unknown (${number})` {
  return RX_MODES[v] ?? `Unknown (${v})`;
}

/** `L` response icons3 bits 0-2. */
export const SIGNAL_TYPES = ['Off', 'DG', 'Dg', 'AM', 'FM', 'NFM', 'ENC', 'D2'] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** Recording header TSYS type. */
export const TSYS_TYPES: Readonly<Record<number, string>> = {
  0: 'Motorola',
  1: 'EDACS',
  2: 'LTR',
  3: 'P25',
  4: 'DMR',
  5: 'NXDN',
};

export function tsysTypeName(v: number): string {
  return TSYS_TYPES[v] ?? `Unknown (${v})`;
}

/** Recording header recording type. */
export const RECORDING_TYPES: Readonly<Record<number, string>> = {
  0: 'Conventional',
  1: 'Talkgroup',
  2: 'Search',
};

export function recordingTypeName(v: number): string {
  return RECORDING_TYPES[v] ?? `Unknown (${v})`;
}

/** Recording header squelch mode. */
export const SQUELCH_MODES = ['No Tone', 'CTCSS', 'DCS', 'NAC'] as const;
export type SquelchMode = (typeof SQUELCH_MODES)[number];

export function squelchModeName(v: number): string {
  return SQUELCH_MODES[v] ?? `Unknown (${v})`;
}

/** CTCSS tone table, index = squelch value, tone in Hz. */
export const CTCSS_TONES: readonly number[] = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9,
  114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9,
  171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1,
  225.7, 229.1, 233.6, 241.8, 250.3, 254.1,
];

/** DCS code table, index = squelch value, code as the three-digit octal string. */
export const DCS_CODES: readonly string[] = [
  '006', '007', '015', '017', '021', '023', '025', '026', '031', '032', '036', '043', '047', '050', '051', '053',
  '054', '065', '071', '072', '073', '074', '114', '115', '116', '122', '125', '131', '132', '134', '141', '143',
  '145', '152', '155', '156', '162', '165', '172', '174', '205', '212', '214', '223', '225', '226', '243', '244',
  '245', '246', '251', '252', '255', '261', '263', '265', '266', '271', '274', '306', '311', '315', '325', '331',
  '332', '343', '346', '351', '356', '364', '365', '371', '411', '412', '413', '423', '431', '432', '445', '446',
  '452', '454', '455', '462', '464', '465', '466', '503', '506', '516', '523', '526', '532', '546', '565', '606',
  '612', '624', '627', '631', '632', '654', '662', '664', '703', '712', '723', '731', '732', '734', '743', '754',
];

/** Human-readable squelch, e.g. "CTCSS 100.0", "DCS 023", "NAC 293", "No Tone". */
export function formatSquelch(mode: number, value: number): string {
  switch (mode) {
    case 0:
      return 'No Tone';
    case 1: {
      const tone = CTCSS_TONES[value];
      return tone === undefined ? `CTCSS ?(${value})` : `CTCSS ${tone.toFixed(1)}`;
    }
    case 2: {
      const code = DCS_CODES[value];
      return code === undefined ? `DCS ?(${value})` : `DCS ${code}`;
    }
    case 3:
      return `NAC ${value.toString(16).toUpperCase().padStart(3, '0')}`;
    default:
      return `Unknown squelch mode ${mode} (${value})`;
  }
}
