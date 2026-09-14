import { modeName, rxModeName } from './tables';

/** Decoded `A` (Get Status) response. */
export interface Status {
  mode: number;
  modeName: string;
  squelch: {
    /** bit 0: RF squelch open */
    rf: boolean;
    /** bit 1: audio unmuted */
    unmuted: boolean;
    /** bit 2: /XF state (IMBE detect) */
    xf: boolean;
    raw: number;
  };
  battery: {
    /** 15-bit level, units undocumented (probably ADC counts) */
    level: number;
    /** battH bit 7: running on USB power */
    usb: boolean;
  };
  rssi: number;
  zeromatic: number;
  led: { r: number; g: number; b: number };
  frequencyHz: number;
  rxMode: number;
  rxModeName: string;
}

export const STATUS_DATA_LENGTH = 16;

export function parseStatus(data: Uint8Array): Status {
  if (data.length !== STATUS_DATA_LENGTH) {
    throw new Error(`Status data must be ${STATUS_DATA_LENGTH} bytes, got ${data.length}`);
  }
  const sq = data[1]!;
  const battL = data[2]!;
  const battH = data[3]!;
  const freq = (data[11]! | (data[12]! << 8) | (data[13]! << 16) | (data[14]! << 24)) >>> 0;
  return {
    mode: data[0]!,
    modeName: modeName(data[0]!),
    squelch: {
      rf: (sq & 0x01) !== 0,
      unmuted: (sq & 0x02) !== 0,
      xf: (sq & 0x04) !== 0,
      raw: sq,
    },
    battery: {
      level: battL | ((battH & 0x7f) << 8),
      usb: (battH & 0x80) !== 0,
    },
    rssi: data[4]! | (data[5]! << 8),
    zeromatic: data[6]! | (data[7]! << 8),
    led: { r: data[8]!, g: data[9]!, b: data[10]! },
    frequencyHz: freq,
    rxMode: data[15]!,
    rxModeName: rxModeName(data[15]!),
  };
}

export function formatFrequency(hz: number): string {
  return `${(hz / 1e6).toFixed(5)} MHz`;
}
