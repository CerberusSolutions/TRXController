import { describe, expect, it } from 'vitest';
import { ChannelLearner, dsdFrequencyLines } from '../dsdChannels';

const T = new Date(2026, 9, 2, 9, 52, 32).getTime();

describe('ChannelLearner', () => {
  it('learns a channel from grants the TRX opened on at the same moment, after two consistent votes', () => {
    const l = new ChannelLearner();
    // 09:52:32 DSD+: Group call TG=69 Ch=306; the TRX opened on 167.300 at 09:52:32.6.
    l.grant(T, 'L1', '306');
    l.opening(T + 600, 167_300_000);
    // Nothing until the grant's window has closed: a second opening could still make it ambiguous.
    expect(l.learned('L1')).toEqual({});
    l.tick(T + 5000);
    expect(l.learned('L1')['306']).toEqual({ channel: '306', hz: null, votes: 1, total: 1 });
    expect(l.takeChanged()).toBe(true);
    expect(l.takeChanged()).toBe(false);
    // The opening may come first (the carrier is up before DSD+ writes the whole-second line).
    l.opening(T + 10_000, 167_300_000);
    l.grant(T + 10_800, 'L1', '306');
    l.tick(T + 16_000);
    expect(l.learned('L1')['306']).toEqual({ channel: '306', hz: 167_300_000, votes: 2, total: 2 });
    expect(l.hzOf('L1', '306')).toBe(167_300_000);
    expect(l.hzOf('L1', '305')).toBeNull();
  });

  it('ignores a re-opening on a frequency the scanner has been parked on (the control channel fluttering)', () => {
    const l = new ChannelLearner();
    // TfL, 2 Oct 2026: the scanner sat on the control channel 139.53125 in a Service Search; every grant found a flutter there.
    l.grant(T, 'S1 TfL', '1701');
    l.opening(T + 400, 139_531_250, 45_000);
    l.tick(T + 5000);
    expect(l.learned('S1 TfL')).toEqual({});
    // A stop: the scanner had just moved onto the frequency.
    l.grant(T + 10_000, 'S1 TfL', '1701');
    l.opening(T + 10_300, 140_118_750, 150);
    l.tick(T + 15_000);
    expect(l.learned('S1 TfL')['1701']).toEqual({ channel: '1701', hz: null, votes: 1, total: 1 });
  });

  it('casts no vote when two openings or two grants fall in one window, and drops a split channel', () => {
    const l = new ChannelLearner();
    l.grant(T, 'L1', '306');
    l.opening(T + 500, 167_300_000);
    l.opening(T + 900, 164_700_000);
    l.tick(T + 5000);
    expect(l.learned('L1')).toEqual({});
    l.grant(T + 20_000, 'L1', '306');
    l.grant(T + 20_200, 'L1', '305');
    l.opening(T + 21_000, 167_300_000);
    l.tick(T + 26_000);
    expect(l.learned('L1')).toEqual({});
    // Conflicting votes: no frequency while neither holds 70 %.
    l.grant(T + 40_000, 'L1', '307');
    l.opening(T + 40_500, 167_225_000);
    l.tick(T + 45_000);
    l.grant(T + 50_000, 'L1', '307');
    l.opening(T + 50_500, 164_862_500);
    l.tick(T + 55_000);
    expect(l.learned('L1')['307']).toMatchObject({ hz: null, votes: 1, total: 2 });
  });

  it('forgets stale halves and keeps networks apart', () => {
    const l = new ChannelLearner();
    l.grant(T, 'L1', '306');
    l.opening(T + 15_000, 167_300_000);
    l.tick(T + 20_000);
    expect(l.learned('L1')).toEqual({});
    l.grant(T + 30_000, 'L2', '306');
    l.opening(T + 30_500, 170_000_000);
    l.tick(T + 35_000);
    expect(l.learned('L2')['306']).toMatchObject({ votes: 1 });
    expect(l.learned('L1')).toEqual({});
  });

  it('forgets a channel on request and learns it afresh', () => {
    const l = new ChannelLearner({ L1: { '306': { '167300000': 5 }, '305': { '167225000': 2 } } });
    expect(l.learned('L1')['306']!.hz).toBe(167_300_000);
    l.forget('L1', '306');
    expect(l.takeChanged()).toBe(true);
    expect(Object.keys(l.learned('L1'))).toEqual(['305']);
    l.forget('L1', '999');
    expect(l.takeChanged()).toBe(false);
    l.forget('L1', '305');
    expect(l.toJSON()).toEqual({});
  });

  it('round-trips its votes and writes DSDPlus.frequencies lines for the learned channels', () => {
    const l = new ChannelLearner({ L1: { '306': { '167300000': 3 }, '305': { '167225000': 2, '164700000': 1 }, '310': { '170000000': 1 } } });
    const again = new ChannelLearner(l.toJSON());
    expect(again.learned('L1')['305']).toEqual({ channel: '305', hz: null, votes: 2, total: 3 });
    expect(dsdFrequencyLines('TIIInonStd', 'L1', 'L1-15', again.learned('L1'))).toEqual(['TIIInonStd, L1, 15, 306, 167.3000, 0.0, 0']);
    expect(dsdFrequencyLines('DMR', 'L1', null, again.learned('L1'))).toEqual(['DMR, L1, 1, 306, 167.3000, 0.0, 0']);
  });
});
