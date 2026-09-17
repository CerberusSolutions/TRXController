import { describe, expect, it } from 'vitest';
import { bearingDeg, compassPoint, distanceKm, formatBearing, formatDistance, formatPlace, normaliseUnits, placeFrom } from '../geo';

describe('geo', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
    // London to Paris, about 344 km.
    expect(distanceKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(343.5, 0);
  });

  it('gives the initial bearing clockwise from north, 0-359', () => {
    expect(bearingDeg(51, 0, 52, 0)).toBe(0);
    expect(bearingDeg(51, 0, 50, 0)).toBe(180);
    expect(bearingDeg(51, 0, 51, 1)).toBe(90); // due east on a short leg rounds to 090
    expect(bearingDeg(51, 0, 51, -1)).toBe(270);
    // Aylesbury to Croughton (RAF): north-west.
    expect(bearingDeg(51.82, -0.81, 51.99, -1.19)).toBeGreaterThan(290);
    expect(bearingDeg(51.82, -0.81, 51.99, -1.19)).toBeLessThan(320);
  });

  it('places a point relative to the user, or not at all', () => {
    expect(placeFrom({ lat: 51, lon: 0 }, 52, 0)).toEqual({ distanceKm: expect.closeTo(111.2, 0), bearingDeg: 0 });
    expect(placeFrom(null, 52, 0)).toEqual({ distanceKm: null, bearingDeg: null });
    expect(placeFrom({ lat: 51, lon: 0 }, null, 0)).toEqual({ distanceKm: null, bearingDeg: null });
    expect(placeFrom({ lat: 51, lon: 0 }, 52, undefined)).toEqual({ distanceKm: null, bearingDeg: null });
  });

  it('formats in the chosen units', () => {
    expect(formatDistance(6.73)).toBe('6.7 km');
    expect(formatDistance(41.4)).toBe('41 km');
    expect(formatDistance(6.73, 'mi')).toBe('4.2 mi');
    expect(formatDistance(30.6, 'mi')).toBe('19 mi');
    expect(formatDistance(null)).toBe('');
    expect(formatBearing(47)).toBe('047°');
    expect(formatBearing(360)).toBe('000°');
    expect(formatBearing(null)).toBe('');
    expect(formatPlace({ distanceKm: 6.73, bearingDeg: 47 })).toBe('6.7 km 047°');
    expect(formatPlace({ distanceKm: 6.73, bearingDeg: 47 }, 'mi')).toBe('4.2 mi 047°');
    expect(formatPlace({ distanceKm: null, bearingDeg: null })).toBe('');
    expect(formatPlace(null)).toBe('');
    expect(compassPoint(47)).toBe('NE');
    expect(compassPoint(350)).toBe('N');
    expect(normaliseUnits('mi')).toBe('mi');
    expect(normaliseUnits('miles')).toBe('km');
  });
});
