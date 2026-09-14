import { describe, expect, it } from 'vitest';
import {
  NO_ID,
  RECORDING_HEADER_SIZE,
  formatId,
  parseActiveChannel,
  parseRecordingHeader,
  parseRecordingTime,
} from '../activeChannel';
import { encodeFrame, fromHex, splitFrames } from '../frame';

function putStr(buf: Uint8Array, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
}

/** Build a header the way the spec describes: BE integers, LE stm. */
function sampleHeader(stmLittle = true): Uint8Array {
  const buf = new Uint8Array(RECORDING_HEADER_SIZE);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x2e736e64); // ".snd"
  dv.setUint32(4, 320);
  dv.setUint32(8, 0xffffffff);
  dv.setUint32(12, 1);
  dv.setUint32(16, 8000);
  dv.setUint32(20, 1);
  buf[24] = 1; // Talkgroup
  // stm: 2026-09-14 13:45:30, Monday (wday 1), yday 256, dst 1
  const stm = [30, 45, 13, 14, 8, 126, 1, 256, 1];
  stm.forEach((v, i) => dv.setInt16(25 + i * 2, v, stmLittle));
  putStr(buf, 43, 'Fire Dispatch');
  putStr(buf, 60, 'County P25');
  putStr(buf, 77, 'TG 1234');
  dv.setUint32(94, 42);
  dv.setUint32(98, 1234);
  dv.setUint32(102, NO_ID);
  dv.setUint32(106, 7654321);
  dv.setUint32(110, NO_ID);
  putStr(buf, 114, 'Site 3');
  dv.setUint32(131, 9);
  putStr(buf, 135, 'S1 CC7');
  dv.setUint32(152, 851012500);
  dv.setUint32(156, 852500000);
  dv.setUint16(160, 3); // NAC
  dv.setUint16(162, 0x293);
  buf[164] = 3; // P25
  return buf;
}

describe('parseRecordingHeader', () => {
  it('decodes big-endian fields and strings', () => {
    const h = parseRecordingHeader(sampleHeader());
    expect(h.magic).toBe(0x2e736e64);
    expect(h.dataOffset).toBe(320);
    expect(h.dataSize).toBe(0xffffffff);
    expect(h.encoding).toBe(1);
    expect(h.sampleRate).toBe(8000);
    expect(h.channels).toBe(1);
    expect(h.recordingTypeName).toBe('Talkgroup');
    expect(h.objectTag).toBe('Fire Dispatch');
    expect(h.systemTag).toBe('County P25');
    expect(h.infoTag).toBe('TG 1234');
    expect(h.objectId).toBe(42);
    expect(h.talkgroupId1).toBe(1234);
    expect(h.talkgroupId2).toBe(NO_ID);
    expect(h.radioId1).toBe(7654321);
    expect(h.siteName).toBe('Site 3');
    expect(h.tsysFileIndex).toBe(9);
    expect(h.miscText).toBe('S1 CC7');
    expect(h.voiceFrequencyHz).toBe(851012500);
    expect(h.controlFrequencyHz).toBe(852500000);
    expect(h.squelchModeName).toBe('NAC');
    expect(h.squelchText).toBe('NAC 293');
    expect(h.tsysTypeName).toBe('P25');
    expect(h.reserved.length).toBe(155);
  });

  it('decodes the little-endian stm struct', () => {
    const t = parseRecordingHeader(sampleHeader()).startTime;
    expect(t.byteOrder).toBe('le');
    expect(t.iso).toBe('2026-09-14T13:45:30');
    expect(t.yday).toBe(256);
    expect(t.isdst).toBe(1);
  });

  it('falls back to big-endian stm when little-endian is implausible', () => {
    const t = parseRecordingTime(sampleHeader(false));
    expect(t.byteOrder).toBe('be');
    expect(t.iso).toBe('2026-09-14T13:45:30');
  });

  it('reports null iso when neither order is plausible', () => {
    const buf = new Uint8Array(RECORDING_HEADER_SIZE).fill(0xff);
    const t = parseRecordingTime(buf);
    expect(t.iso).toBeNull();
  });

  it('formats CTCSS and DCS squelch', () => {
    const buf = sampleHeader();
    const dv = new DataView(buf.buffer);
    dv.setUint16(160, 1);
    dv.setUint16(162, 12);
    expect(parseRecordingHeader(buf).squelchText).toBe('CTCSS 100.0');
    dv.setUint16(160, 2);
    dv.setUint16(162, 5);
    expect(parseRecordingHeader(buf).squelchText).toBe('DCS 023');
  });

  it('rejects short buffers', () => {
    expect(() => parseRecordingHeader(new Uint8Array(319))).toThrow(/320 bytes/);
  });
});

describe('parseActiveChannel', () => {
  it('returns no header for an empty response', () => {
    const frame = encodeFrame('a', [0, 0]);
    expect(frame.length).toBe(6);
    const ac = parseActiveChannel(frame.subarray(2, 4));
    expect(ac).toEqual({ length: 0, header: null, raw: null });
  });

  it('parses a 320-byte payload', () => {
    const hdr = sampleHeader();
    const data = new Uint8Array([0x01, 0x40, ...hdr]);
    const ac = parseActiveChannel(data);
    expect(ac.length).toBe(320);
    expect(ac.header?.objectTag).toBe('Fire Dispatch');
    expect(ac.raw?.length).toBe(320);
  });

  it('rejects a length field that disagrees with the data', () => {
    expect(() => parseActiveChannel(new Uint8Array([0x01, 0x40, 0, 0]))).toThrow(/length field/);
  });

  it('rejects a non-empty payload shorter than a header', () => {
    expect(() => parseActiveChannel(new Uint8Array([0x00, 0x04, 1, 2, 3, 4]))).toThrow(/expected 320/);
  });
});

describe('real TRX-1e capture', () => {
  // Full `a` response captured on 14 Sep 2026 while receiving a conventional
  // airband object. Header integers are big-endian, stm is little-endian.
  const RAW = fromHex(
    '02 61 01 40 2E 73 6E 64 00 00 01 40 FF FF FF FF 00 00 00 01 00 00 1F 40 00 00 00 01 00 23 00 2D ' +
        '00 0E 00 0E 00 08 00 7E 00 01 00 00 00 00 00 54 43 20 4E 57 20 44 65 70 73 20 20 20 20 20 20 00 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 20 31 31 39 2E 37 37 35 30 30 30 00 00 00 00 ' +
        '00 00 00 00 00 00 FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF 00 00 00 00 00 00 00 00 00 00 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 07 23 9F 18 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ' +
        '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ' +
        '00 00 00 00 03 5E ',
  );

  it('is a valid 326-byte frame', () => {
    expect(RAW.length).toBe(326);
    const events = splitFrames(RAW);
    expect(events).toHaveLength(1);
    expect(events[0]!.type === 'frame' && events[0]!.frame.data.length).toBe(322);
  });

  it('decodes the header as the scanner displayed it', () => {
    const events = splitFrames(RAW);
    const frame = events[0]!.type === 'frame' ? events[0]!.frame : undefined;
    const ac = parseActiveChannel(frame!.data);
    expect(ac.length).toBe(320);
    const h = ac.header!;
    expect(h.magic).toBe(0x2e736e64);
    expect(h.dataOffset).toBe(320);
    expect(h.sampleRate).toBe(8000);
    expect(h.recordingTypeName).toBe('Conventional');
    expect(h.startTime.byteOrder).toBe('le');
    expect(h.startTime.iso).toBe('2026-09-14T14:45:35');
    expect(h.startTime.wday).toBe(1); // Monday
    expect(h.startTime.yday).toBe(0); // scanner leaves these two at zero
    expect(h.startTime.isdst).toBe(0);
    expect(h.objectTag).toBe('TC NW Deps');
    expect(h.systemTag).toBe('');
    expect(h.infoTag).toBe(' 119.775000');
    expect(h.objectId).toBe(0);
    expect([h.talkgroupId1, h.talkgroupId2, h.radioId1, h.radioId2]).toEqual([NO_ID, NO_ID, NO_ID, NO_ID]);
    expect(h.siteName).toBe('');
    expect(h.miscText).toBe('');
    expect(h.voiceFrequencyHz).toBe(119775000);
    expect(h.controlFrequencyHz).toBe(0);
    expect(h.squelchText).toBe('No Tone');
    expect(h.tsysType).toBe(0);
    expect(h.reserved.every((x) => x === 0)).toBe(true);
  });
});

describe('formatId', () => {
  it('shows a dash for the not-available sentinel', () => {
    expect(formatId(NO_ID)).toBe('-');
    expect(formatId(1234)).toBe('1234');
  });
});
