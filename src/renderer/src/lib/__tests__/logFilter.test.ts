import { describe, expect, it } from 'vitest';
import type { ReceptionRow } from '../../../../shared/ipc';
import { rowMatches, useLog } from '../../store/log';

const row = (rx: number, name = 'Thames Valley Taxis'): ReceptionRow =>
  ({ rx, id: rx + 1, startedAt: 0, endedAt: 1, frequencyHz: 453_062_500, mode: 'FM', signalType: 'DMR', name, system: '', scanlist: '', objectType: '', tgid: null, radioId: null, site: '', squelch: '', tone: '', rssiPeak: 0, hits: 1, calls: 1, radioAlias: '', radioLabel: '', tgLabel: '', radioCallsign: null, radioName: null, licensee: '', source: '', scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', rruk: '', distanceKm: null, bearingDeg: null, lat: null, lon: null, candidates: [] }) as ReceptionRow;

describe('log filter', () => {
  it('matches every word of the text, and only the scanners shown when told which', () => {
    expect(rowMatches(row(0), 'taxis valley')).toBe(true);
    expect(rowMatches(row(0), 'taxis bus')).toBe(false);
    // A single-scanner window never passes the receivers, so every row shows.
    expect(rowMatches(row(1), '')).toBe(true);
    expect(rowMatches(row(1), '', [true, false])).toBe(false);
    expect(rowMatches(row(0), '', [true, false])).toBe(true);
    // A receiver the chips do not know (a row from a third scanner, if ever) is shown.
    expect(rowMatches(row(2), '', [true, false])).toBe(true);
  });

  it('keeps at least one scanner shown', () => {
    const s = useLog.getState();
    expect(s.rxShown).toEqual([true, true]);
    s.toggleRx(1);
    expect(useLog.getState().rxShown).toEqual([true, false]);
    s.toggleRx(0); // would hide both: ignored
    expect(useLog.getState().rxShown).toEqual([true, false]);
    s.toggleRx(1);
    expect(useLog.getState().rxShown).toEqual([true, true]);
  });
});
