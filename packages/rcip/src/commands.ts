import { encodeFrame } from './frame';
import type { KeyCode } from './keys';

/** Message codes. Case matters: 'A' and 'a' are different commands. */
export const Code = {
  STATUS: 'A',
  LCD: 'L',
  ACTIVE_CHANNEL: 'a',
  SEND_KEY: 'K',
  CLOCK_SET: 't',
  POWER: 'P',
  VERSION: 'V',
  CCDUMP: 'C',
} as const;

/** Commands that the scanner never answers. */
export const NO_RESPONSE_CODES: ReadonlySet<string> = new Set([Code.SEND_KEY, Code.CLOCK_SET, Code.CCDUMP]);

export const getStatus = (): Uint8Array => encodeFrame(Code.STATUS);
export const getLcd = (): Uint8Array => encodeFrame(Code.LCD);
export const getActiveChannel = (): Uint8Array => encodeFrame(Code.ACTIVE_CHANNEL);
export const getPower = (): Uint8Array => encodeFrame(Code.POWER);
/** Version request carries a single 0x00 data byte. */
export const getVersion = (): Uint8Array => encodeFrame(Code.VERSION, [0x00]);

/** Send Key. Needs CPU firmware 1.2+. No response. */
export function sendKey(key: KeyCode | number): Uint8Array {
  if (!Number.isInteger(key) || key < 0 || key > 255) throw new Error(`Invalid key code ${key}`);
  return encodeFrame(Code.SEND_KEY, [key]);
}

/** CC Dump on/off. No response. Also rewrites the scanner's config. */
export function setCcDump(on: boolean): Uint8Array {
  return encodeFrame(Code.CCDUMP, [on ? 1 : 0]);
}

export interface ClockFields {
  sec: number;
  min: number;
  hour: number;
  /** 1-31 */
  mday: number;
  /** 0-11 */
  month: number;
  /** years since 1900 */
  year: number;
  /** 0-6, Sunday = 0 */
  weekday: number;
  /** optional, 0-365 */
  yearday?: number;
  /** optional */
  isDst?: number;
}

export interface ClockOptions {
  /**
   * Byte order of the nine 16-bit fields. The spec does not say. Little-endian
   * matches the `A` frequency field and the recording-header stm struct.
   * Unverified on hardware.
   */
  byteOrder?: 'le' | 'be';
}

/** Clock Set from explicit fields. No response. */
export function setClock(f: ClockFields, opts: ClockOptions = {}): Uint8Array {
  const values = [f.sec, f.min, f.hour, f.mday, f.month, f.year, f.weekday, f.yearday ?? 0, f.isDst ?? 0];
  const little = (opts.byteOrder ?? 'le') === 'le';
  const data = new Uint8Array(values.length * 2);
  const dv = new DataView(data.buffer);
  values.forEach((v, i) => dv.setInt16(i * 2, v, little));
  return encodeFrame(Code.CLOCK_SET, data);
}

/** Clock Set from a JS Date, using the local time zone. */
export function setClockFromDate(d: Date, opts: ClockOptions = {}): Uint8Array {
  const start = new Date(d.getFullYear(), 0, 1);
  const yearday = Math.floor((d.getTime() - start.getTime()) / 86_400_000);
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  const isDst = Math.min(jan, jul) !== Math.max(jan, jul) && d.getTimezoneOffset() === Math.min(jan, jul) ? 1 : 0;
  return setClock(
    {
      sec: d.getSeconds(),
      min: d.getMinutes(),
      hour: d.getHours(),
      mday: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear() - 1900,
      weekday: d.getDay(),
      yearday,
      isDst,
    },
    opts,
  );
}
