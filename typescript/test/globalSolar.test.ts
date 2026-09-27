import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nextGlobalSolarEclipse, previousGlobalSolarEclipse, globalSolarEclipses,
  solarEclipses, solarObscuration, AlmanacOutOfRangeError
} from '../src/index.js';
import type { GlobalSolarEclipse, Observer } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

const SEC = 1000;
const DAY = 86400000;
/** Espenak's gamma is the axis distance in equatorial Earth radii. */
const GAMMA_RADIUS_KM = 6378.137;
/** Beyond this axis distance the axis meets the ground so obliquely that its point is hypersensitive; upstream skips the location check there too. */
const GLANCING_AXIS_KM = 6100;

interface CatalogRow {
  peakUtc: string;
  kind: 'partial' | 'annular' | 'total' | 'hybrid';
  central: boolean;
  gamma: number;
  magnitude: number;
  latitudeDeg: number;
  longitudeDeg: number;
  sunAltDeg: number;
  pathWidthKm: number | null;
}

const catalog: CatalogRow[] = load('eclipses/solar-catalog.json');

/**
 * The kind at the greatest-eclipse point. A non-central row (type flag `+` or
 * `-`) has an axis that misses the Earth, so nobody sees its central phase,
 * and a hybrid path is total at greatest eclipse.
 */
function expectedKind(row: CatalogRow): GlobalSolarEclipse['kind'] {
  if (row.kind === 'partial' || !row.central) return 'partial';
  return row.kind === 'hybrid' ? 'total' : row.kind;
}

/** UPSTREAM test.js `AngleDiff`: the great-circle angle between two points, degrees. */
function angleDiffDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const a = [Math.cos(aLon * r) * Math.cos(aLat * r), Math.sin(aLon * r) * Math.cos(aLat * r), Math.sin(aLat * r)];
  const b = [Math.cos(bLon * r) * Math.cos(bLat * r), Math.sin(bLon * r) * Math.cos(bLat * r), Math.sin(bLat * r)];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot <= -1) return 180;
  if (dot >= 1) return 0;
  return Math.acos(dot) / r;
}

/** Every solar eclipse on Earth, 1950-2100, by repeated next. */
const walk: GlobalSolarEclipse[] = (() => {
  const found: GlobalSolarEclipse[] = [];
  let cursor = new Date(SUPPORTED_MIN);
  for (;;) {
    let e: GlobalSolarEclipse;
    try { e = nextGlobalSolarEclipse(cursor); } catch (err) {
      if (err instanceof AlmanacOutOfRangeError) break;
      throw err;
    }
    found.push(e);
    cursor = e.peak;
  }
  return found;
})();

const groundPoint = (e: GlobalSolarEclipse): Observer => ({ latitudeDeg: e.latitudeDeg!, longitudeDeg: e.longitudeDeg! });

describe('nextGlobalSolarEclipse vs the Espenak catalog', () => {
  it('walks 1950-2100 finding every catalog eclipse exactly once, and nothing else', () => {
    // Upstream's own test tolerates up to two marginal partial eclipses near
    // the penumbral limit that its model finds and the catalog omits. Over
    // 1950-2100 this port finds none, so the count is exact: a change that
    // adds or drops one fails here. Index alignment is the peak test below.
    expect(catalog.length).toBe(337);
    expect(walk.length).toBe(catalog.length);
    for (let i = 1; i < walk.length; i++)
      expect(walk[i].peak.getTime()).toBeGreaterThan(walk[i - 1].peak.getTime());
  });

  it('greatest eclipse agrees within 60 s', () => {
    // Measured worst 8.2 s (2081-09-03). The catalog's UT is its TD minus its
    // own Espenak–Meeus Delta-T, the model this port uses, so no Delta-T floor.
    const errs = walk.map((e, i) => Math.abs(e.peak.getTime() - Date.parse(catalog[i].peakUtc)) / SEC);
    const worst = Math.max(...errs);
    expect(worst, `worst peak error ${worst.toFixed(1)} s at ${catalog[errs.indexOf(worst)].peakUtc}`).toBeLessThanOrEqual(60);
  });

  it('kind matches every row: hybrid is total at greatest eclipse, and a non-central axis misses the Earth', () => {
    const bad = walk
      .map((e, i) => ({ row: catalog[i], got: e.kind, want: expectedKind(catalog[i]) }))
      .filter(r => r.got !== r.want)
      .map(r => `${r.row.peakUtc}: got ${r.got}, catalog ${r.row.kind}${r.row.central ? '' : ' (non-central)'}`);
    expect(bad).toEqual([]);
    // The non-central rows are the ones that prove the axis can miss while the umbra still touches.
    expect(catalog.filter(r => r.kind !== 'partial' && !r.central).length).toBeGreaterThan(0);
  });

  it('axis distance agrees with |gamma| within 5 km', () => {
    // Gamma is tabulated to 1e-4 radii, 0.32 km of rounding. Measured worst
    // 4.1 km (2096-11-15); the lunar theory's error grows away from J2000,
    // from under 2.3 km through 2049 to that worst case in the 2090s.
    const errs = walk.map((e, i) => Math.abs(e.axisDistanceKm - Math.abs(catalog[i].gamma) * GAMMA_RADIUS_KM));
    const worst = Math.max(...errs);
    expect(worst, `worst axis distance error ${worst.toFixed(2)} km at ${catalog[errs.indexOf(worst)].peakUtc}`).toBeLessThanOrEqual(5);
  });

  it(`ground point agrees within 1° where the axis meets the ground under ${GLANCING_AXIS_KM} km from the center`, () => {
    // The catalog rounds to whole degrees, up to 0.71° on its own; measured
    // worst 0.66° (1951-09-01).
    const errs: { at: string; deg: number }[] = [];
    walk.forEach((e, i) => {
      const row = catalog[i];
      if (e.kind === 'partial' || e.axisDistanceKm >= GLANCING_AXIS_KM) return;
      errs.push({ at: row.peakUtc, deg: angleDiffDeg(row.latitudeDeg, row.longitudeDeg, e.latitudeDeg!, e.longitudeDeg!) });
    });
    expect(errs.length).toBeGreaterThan(190);
    const worst = errs.reduce((a, b) => (b.deg > a.deg ? b : a));
    expect(worst.deg, `worst ground point error ${worst.deg.toFixed(3)}° at ${worst.at}`).toBeLessThanOrEqual(1);
  });

  it('reports a ground point and obscuration exactly when the axis meets the ground', () => {
    for (const e of walk) {
      const label = e.peak.toISOString();
      if (e.kind === 'partial') {
        expect([e.latitudeDeg, e.longitudeDeg, e.obscuration], label).toEqual([null, null, null]);
        continue;
      }
      expect(e.latitudeDeg!, label).toBeGreaterThanOrEqual(-90);
      expect(e.latitudeDeg!, label).toBeLessThanOrEqual(90);
      expect(e.longitudeDeg!, label).toBeGreaterThan(-180);
      expect(e.longitudeDeg!, label).toBeLessThanOrEqual(180);
      // An axis inside the Earth's equatorial radius is what puts a point on it.
      expect(e.axisDistanceKm, label).toBeLessThan(6378.1366);
      if (e.kind === 'total') expect(e.obscuration, label).toBe(1);
      else {
        expect(e.obscuration!, label).toBeGreaterThan(0);
        expect(e.obscuration!, label).toBeLessThan(1);
      }
    }
  });
});

describe('the ground point is on the shadow axis at greatest eclipse', () => {
  // An observer placed there has the axis pass straight through them at the
  // peak, so their own closest approach is the global peak. This checks the
  // geodetic latitude and the sidereal longitude far below the catalog's
  // whole-degree rounding, through the observer path the local search uses.
  const central = walk.filter(e => e.kind !== 'partial');

  it('the local search there peaks within 2 s of greatest eclipse, with the same obscuration', () => {
    expect(central.length).toBeGreaterThan(200);
    const bad: string[] = [];
    for (const e of central) {
      const at = e.peak.getTime();
      const found = solarEclipses(new Date(at - DAY), new Date(at + DAY), groundPoint(e));
      if (found.length !== 1) { bad.push(`${e.peak.toISOString()}: ${found.length} local eclipses`); continue; }
      const dt = Math.abs(found[0].peak.getTime() - at) / SEC;
      if (dt > 2) bad.push(`${e.peak.toISOString()}: local peak off by ${dt.toFixed(2)} s`);
      const obscuration = solarObscuration(e.peak, groundPoint(e));
      if (Math.abs(obscuration - e.obscuration!) > 1e-6) bad.push(`${e.peak.toISOString()}: obscuration ${obscuration} vs ${e.obscuration}`);
    }
    expect(bad).toEqual([]);
  });

  it('the local search there sees the same kind, except the one near-hybrid it classifies with a larger Moon', () => {
    // Upstream classifies the local kind from the umbra of the Moon's mean
    // radius (1737.4 km) and the global kind from its polar radius (1736.0 km).
    // Only 1966-05-20 falls between them: the catalog's annular eclipse with a
    // 3 km path, whose mean-radius umbra is 44 m wide, which the local peak
    // misses by 0.14 km.
    const differ: string[] = [];
    for (const e of central) {
      const at = e.peak.getTime();
      const [local] = solarEclipses(new Date(at - DAY), new Date(at + DAY), groundPoint(e));
      if (local.kind !== e.kind) differ.push(`${e.peak.toISOString().slice(0, 10)} global ${e.kind} local ${local.kind}`);
    }
    expect(differ).toEqual(['1966-05-20 global annular local partial']);
  });
});

describe('global search semantics', () => {
  it('finds the same eclipses backward and in one range', () => {
    const backward: GlobalSolarEclipse[] = [];
    let cursor = new Date(SUPPORTED_MAX - 1);
    for (let i = 0; i <= walk.length; i++) {
      try {
        const e = previousGlobalSolarEclipse(cursor);
        expect(e.peak.getTime()).toBeLessThan(cursor.getTime());
        backward.push(e);
        cursor = e.peak;
      } catch (err) {
        if (err instanceof AlmanacOutOfRangeError) break;
        throw err;
      }
    }
    const range = globalSolarEclipses(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX));
    expect(backward.reverse()).toEqual(walk);
    expect(range).toEqual(walk);
  });

  it('includes each returned peak at the range start and excludes it at the end', () => {
    for (const e of walk) {
      const at = e.peak.getTime();
      expect(globalSolarEclipses(new Date(at), new Date(at + 1)).map(x => x.peak.getTime()), e.peak.toISOString()).toEqual([at]);
      expect(globalSolarEclipses(new Date(at - 1), new Date(at)), e.peak.toISOString()).toEqual([]);
    }
  });

  it('can approach a peak from either side, regardless of which side its new moon is on', () => {
    for (const e of walk) {
      const at = e.peak.getTime();
      expect(nextGlobalSolarEclipse(new Date(at - 101)).peak.getTime(), e.peak.toISOString()).toBe(at);
      expect(previousGlobalSolarEclipse(new Date(at + 101)).peak.getTime(), e.peak.toISOString()).toBe(at);
    }
  });

  it('pins the same-eclipse band at 100 ms either side of the anchor', () => {
    const e = walk.find(x => x.peak.getTime() > Date.UTC(2026, 0, 1))!;
    const at = e.peak.getTime();
    expect(nextGlobalSolarEclipse(e.peak).peak.getTime()).toBeGreaterThan(at);
    expect(nextGlobalSolarEclipse(new Date(at - 100)).peak.getTime()).toBeGreaterThan(at);
    expect(nextGlobalSolarEclipse(new Date(at - 101)).peak.getTime()).toBe(at);
    expect(previousGlobalSolarEclipse(e.peak).peak.getTime()).toBeLessThan(at);
    expect(previousGlobalSolarEclipse(new Date(at + 100)).peak.getTime()).toBeLessThan(at);
    expect(previousGlobalSolarEclipse(new Date(at + 101)).peak.getTime()).toBe(at);
  });

  it('returns integer-millisecond peaks', () => {
    for (const e of walk) expect(Number.isInteger(e.peak.getTime())).toBe(true);
  });

  it('validates inputs before returning an empty window and reaches the boundary as out-of-range', () => {
    // No solar eclipse between the 2026-08-12 total and the 2027-02-06 annular.
    const from = new Date('2026-09-01T00:00:00Z'), to = new Date('2027-01-01T00:00:00Z');
    expect(globalSolarEclipses(from, to)).toEqual([]);
    expect(globalSolarEclipses(from, from)).toEqual([]);
    expect(globalSolarEclipses(to, from)).toEqual([]);
    expect(globalSolarEclipses(new Date(Date.parse(catalog[catalog.length - 1].peakUtc) + DAY), new Date(SUPPORTED_MAX))).toEqual([]);
    expect(() => globalSolarEclipses(new Date(NaN), to)).toThrow(RangeError);
    expect(() => globalSolarEclipses(from, new Date(NaN))).toThrow(RangeError);
    expect(() => globalSolarEclipses(new Date(NaN), to)).not.toThrow(AlmanacOutOfRangeError);
    expect(() => globalSolarEclipses(new Date(SUPPORTED_MIN - 1), to)).toThrow(AlmanacOutOfRangeError);
    expect(() => globalSolarEclipses(from, new Date(SUPPORTED_MAX + 1))).toThrow(AlmanacOutOfRangeError);
    expect(() => globalSolarEclipses(new Date(SUPPORTED_MAX), from)).toThrow(AlmanacOutOfRangeError);
    expect(() => nextGlobalSolarEclipse(new Date(NaN))).toThrow(RangeError);
    expect(() => previousGlobalSolarEclipse(new Date(NaN))).toThrow(RangeError);
    expect(() => nextGlobalSolarEclipse(new Date(SUPPORTED_MIN - 1))).toThrow(AlmanacOutOfRangeError);
    expect(() => nextGlobalSolarEclipse(new Date(Date.parse(catalog[catalog.length - 1].peakUtc) + DAY))).toThrow(AlmanacOutOfRangeError);
    expect(() => previousGlobalSolarEclipse(new Date(Date.parse(catalog[0].peakUtc) - DAY))).toThrow(AlmanacOutOfRangeError);
    expect(() => previousGlobalSolarEclipse(new Date(SUPPORTED_MIN))).toThrow(AlmanacOutOfRangeError);
    expect(() => previousGlobalSolarEclipse(new Date(SUPPORTED_MAX))).toThrow(AlmanacOutOfRangeError);
  });
});
