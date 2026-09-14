import { formatSquelch, recordingTypeName, squelchModeName, tsysTypeName } from './tables';

/** Size of the audio recording header, also used by the `a` response. */
export const RECORDING_HEADER_SIZE = 320;

export const NO_ID = 0xffffffff;

export interface RecordingTime {
  sec: number;
  min: number;
  hour: number;
  /** 1-31 */
  mday: number;
  /** 0-11 */
  mon: number;
  /** years since 1900 */
  year: number;
  wday: number;
  yday: number;
  isdst: number;
  /** Byte order the parser settled on for this struct. */
  byteOrder: 'le' | 'be';
  /** ISO-8601 local date-time string, or null if the fields are out of range. */
  iso: string | null;
}

export interface RecordingHeader {
  magic: number;
  dataOffset: number;
  dataSize: number;
  encoding: number;
  sampleRate: number;
  channels: number;
  recordingType: number;
  recordingTypeName: string;
  startTime: RecordingTime;
  objectTag: string;
  systemTag: string;
  infoTag: string;
  objectId: number;
  talkgroupId1: number;
  /** Radio ID that initiated the call, if available (else NO_ID). */
  talkgroupId2: number;
  /** Updated in real time with the current radio ID (else NO_ID). */
  radioId1: number;
  radioId2: number;
  siteName: string;
  tsysFileIndex: number;
  miscText: string;
  voiceFrequencyHz: number;
  controlFrequencyHz: number;
  squelchMode: number;
  squelchModeName: string;
  squelchValue: number;
  squelchText: string;
  tsysType: number;
  tsysTypeName: string;
  reserved: Uint8Array;
}

/** Decoded `a` (Get Active Channel) response. */
export interface ActiveChannel {
  /** Length field from the response; 0 when nothing is being received. */
  length: number;
  /** Present when length > 0. */
  header: RecordingHeader | null;
  /** Raw header bytes when present, for logging and debugging. */
  raw: Uint8Array | null;
}

function cstr(buf: Uint8Array, off: number, len: number): string {
  let end = off;
  const stop = Math.min(buf.length, off + len);
  while (end < stop && buf[end] !== 0) end++;
  let s = '';
  for (let i = off; i < end; i++) s += String.fromCharCode(buf[i]!);
  return s.trimEnd();
}

function readStm(dv: DataView, off: number, little: boolean): Omit<RecordingTime, 'byteOrder' | 'iso'> {
  const s = (i: number): number => dv.getInt16(off + i * 2, little);
  return {
    sec: s(0),
    min: s(1),
    hour: s(2),
    mday: s(3),
    mon: s(4),
    year: s(5),
    wday: s(6),
    yday: s(7),
    isdst: s(8),
  };
}

function stmPlausible(t: Omit<RecordingTime, 'byteOrder' | 'iso'>): boolean {
  return (
    t.sec >= 0 && t.sec <= 61 &&
    t.min >= 0 && t.min <= 59 &&
    t.hour >= 0 && t.hour <= 23 &&
    t.mday >= 1 && t.mday <= 31 &&
    t.mon >= 0 && t.mon <= 11 &&
    t.year >= 0 && t.year <= 300 &&
    t.wday >= 0 && t.wday <= 6 &&
    t.yday >= 0 && t.yday <= 366
  );
}

function stmIso(t: Omit<RecordingTime, 'byteOrder' | 'iso'>): string | null {
  if (!stmPlausible(t)) return null;
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(t.year + 1900, 4)}-${p(t.mon + 1)}-${p(t.mday)}T${p(t.hour)}:${p(t.min)}:${p(t.sec)}`;
}

/**
 * Parse the recording start time. The header is big-endian but this struct
 * is little-endian, as the spec's struct comment says and a TRX-1e confirmed.
 * The scanner leaves tm_yday and tm_isdst at zero. The opposite byte order is
 * tried only if the little-endian reading is out of range.
 */
export function parseRecordingTime(buf: Uint8Array, off = 25, prefer: 'le' | 'be' = 'le'): RecordingTime {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const first = readStm(dv, off, prefer === 'le');
  if (stmPlausible(first)) return { ...first, byteOrder: prefer, iso: stmIso(first) };
  const other: 'le' | 'be' = prefer === 'le' ? 'be' : 'le';
  const second = readStm(dv, off, other === 'le');
  if (stmPlausible(second)) return { ...second, byteOrder: other, iso: stmIso(second) };
  return { ...first, byteOrder: prefer, iso: null };
}

export interface RecordingHeaderOptions {
  /** Preferred byte order for the stm struct (spec says little-endian). */
  timeByteOrder?: 'le' | 'be';
}

/** Parse the 320-byte recording header (big-endian integers). */
export function parseRecordingHeader(buf: Uint8Array, opts: RecordingHeaderOptions = {}): RecordingHeader {
  if (buf.length < RECORDING_HEADER_SIZE) {
    throw new Error(`Recording header must be ${RECORDING_HEADER_SIZE} bytes, got ${buf.length}`);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (off: number): number => dv.getUint32(off, false);
  const u16 = (off: number): number => dv.getUint16(off, false);
  const squelchMode = u16(160);
  const squelchValue = u16(162);
  const recordingType = buf[24]!;
  const tsysType = buf[164]!;
  return {
    magic: u32(0),
    dataOffset: u32(4),
    dataSize: u32(8),
    encoding: u32(12),
    sampleRate: u32(16),
    channels: u32(20),
    recordingType,
    recordingTypeName: recordingTypeName(recordingType),
    startTime: parseRecordingTime(buf, 25, opts.timeByteOrder ?? 'le'),
    objectTag: cstr(buf, 43, 17),
    systemTag: cstr(buf, 60, 17),
    infoTag: cstr(buf, 77, 17),
    objectId: u32(94),
    talkgroupId1: u32(98),
    talkgroupId2: u32(102),
    radioId1: u32(106),
    radioId2: u32(110),
    siteName: cstr(buf, 114, 17),
    tsysFileIndex: u32(131),
    miscText: cstr(buf, 135, 17),
    voiceFrequencyHz: u32(152),
    controlFrequencyHz: u32(156),
    squelchMode,
    squelchModeName: squelchModeName(squelchMode),
    squelchValue,
    squelchText: formatSquelch(squelchMode, squelchValue),
    tsysType,
    tsysTypeName: tsysTypeName(tsysType),
    reserved: buf.slice(165, 320),
  };
}

/** Parse the data of an `a` response: lenH lenL then len bytes. */
export function parseActiveChannel(data: Uint8Array, opts: RecordingHeaderOptions = {}): ActiveChannel {
  if (data.length < 2) throw new Error(`Active channel data must be at least 2 bytes, got ${data.length}`);
  const length = (data[0]! << 8) | data[1]!;
  if (data.length !== 2 + length) {
    throw new Error(`Active channel length field says ${length} but ${data.length - 2} bytes follow`);
  }
  if (length === 0) return { length, header: null, raw: null };
  const raw = data.slice(2, 2 + length);
  if (length < RECORDING_HEADER_SIZE) {
    throw new Error(`Active channel payload is ${length} bytes, expected ${RECORDING_HEADER_SIZE}`);
  }
  return { length, header: parseRecordingHeader(raw, opts), raw };
}

/** Format an ID field, showing '-' for the "not available" sentinel. */
export function formatId(id: number): string {
  return id === NO_ID ? '-' : String(id);
}
