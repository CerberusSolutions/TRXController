import { describe, expect, it } from 'vitest';
import { buildChannelMap, channelMapLines, lcnOf, lsnIndex, lsnPair, lsnSlot, mapHz, mapLsn, neighbourAnchors, type MapAnchor } from '../dsdChannelMap';

const user = (lsn: number, hz: number): MapAnchor => ({ lsn, hz, source: 'user', note: '' });
const learned = (lsn: number, hz: number): MapAnchor => ({ lsn, hz, source: 'learned', note: '2 votes' });

describe('channel map', () => {
  it('pairs logical slot numbers on a carrier and numbers the carrier as Uniden does', () => {
    expect([lsnIndex(1607), lsnIndex(1608), lsnIndex(1609)]).toEqual([803, 803, 804]);
    expect([lsnSlot(1607), lsnSlot(1608)]).toEqual([1, 2]);
    expect(lsnPair(803)).toEqual([1607, 1608]);
    // The calculator in the forum post: LSN 1687 is LCN 843, 1693 is 846.
    expect([lcnOf(1687), lcnOf(1693)]).toEqual([843, 846]);
  });

  it('places every channel from one anchor at the default step: TfL London Buses, 2 Oct 2026', () => {
    const map = buildChannelMap([user(1607, 139_531_250)], null)!;
    expect(map).toMatchObject({ stepHz: 12_500, inferredStep: false });
    expect(mapHz(map, 1608)).toBe(139_531_250);
    expect(mapHz(map, 1715)).toBe(140_206_250);
    expect(mapHz(map, 1716)).toBe(140_206_250);
    expect(mapHz(map, 1735)).toBe(140_331_250);
    expect(mapLsn(map, 140_331_250)).toBe(1735);
    expect(mapLsn(map, 140_333_000)).toBeNull();
    expect(mapLsn(map, 100_000_000)).toBeNull();
  });

  it('infers the step from two anchors and flags an anchor off the line', () => {
    // The forum's Capacity Max example: site 4's control channel is LSN 1661 on 461.3875, site 3's LSN 1693 on 461.5875.
    const map = buildChannelMap([user(1661, 461_387_500), user(1693, 461_587_500)], null)!;
    expect(map).toMatchObject({ stepHz: 12_500, inferredStep: true });
    expect(mapHz(map, 1687)).toBe(461_550_000);
    expect(map.anchors.every((a) => a.fits)).toBe(true);
    // A learned vote from a coincidence (LSN 1716 as 139.91875 on TfL) is the misfit, the two that agree win.
    const tfl = buildChannelMap([user(1607, 139_531_250), learned(1735, 140_331_250), learned(1716, 139_918_750)], null)!;
    expect(tfl.anchors.map((a) => [a.lsn, a.fits])).toEqual([
      [1607, true],
      [1716, false],
      [1735, true],
    ]);
    expect(mapHz(tfl, 1716)).toBe(140_206_250);
    // A chosen step overrides inference; the user's anchor outranks a learned one on the same LSN.
    const forced = buildChannelMap([user(1661, 461_387_500), user(1693, 461_587_500)], 25_000)!;
    expect(forced).toMatchObject({ stepHz: 25_000, inferredStep: false });
    expect(forced.anchors.filter((a) => a.fits)).toHaveLength(1);
    const dup = buildChannelMap([learned(1607, 139_000_000), user(1607, 139_531_250)], null)!;
    expect(dup.anchors).toHaveLength(1);
    expect(dup.anchors[0]!.source).toBe('user');
    expect(buildChannelMap([], null)).toBeNull();
    expect(buildChannelMap([user(0, 1), user(5, 0)], null)).toBeNull();
  });

  it('writes one DSDPlus.frequencies line per carrier under its slot-1 number', () => {
    const map = buildChannelMap([user(1607, 139_531_250)], null)!;
    expect(channelMapLines('TIIInonStd', 'L1', 'L1-1', [1716, 1715, 1735, 1607, 1608], map)).toEqual([
      'TIIInonStd, L1, 1, 1607, 139.53125, 0.0, 0',
      'TIIInonStd, L1, 1, 1715, 140.20625, 0.0, 0',
      'TIIInonStd, L1, 1, 1735, 140.33125, 0.0, 0',
    ]);
    expect(channelMapLines('TIIInonStd', 'S1', '1', [723], buildChannelMap([user(723, 939_512_500)], null)!)).toEqual(['TIIInonStd, S1, 1, 723, 939.5125, 0.0, 0']);
  });

  it('turns a neighbour list plus a known control channel into an anchor', () => {
    const anchors = neighbourAnchors([
      { site: 'L1-15', controlHz: null, neighbours: [{ site: 'L1-3', code: 'CC=63' }, { site: 'L1-9', code: 'CC=183' }] },
      { site: 'L1-3', controlHz: 167_300_000, neighbours: [{ site: 'L1-15', code: 'CC=241' }] },
      { site: 'L1-9', controlHz: null, neighbours: [{ site: 'L1-3', code: 'CC=63' }] },
    ]);
    expect(anchors).toEqual([{ lsn: 63, hz: 167_300_000, source: 'neighbour', note: "Site L1-3's control channel, from site L1-15's neighbour list" }]);
  });
});
