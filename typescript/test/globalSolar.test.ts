import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nextGlobalSolarEclipse, previousGlobalSolarEclipse, globalSolarEclipses,
  solarEclipseAxisPoint, solarEclipseCentralLine,
  solarEclipses, solarObscuration, lunarEclipses, AlmanacOutOfRangeError
} from '../src/index.js';
import type { GlobalSolarEclipse, Observer, SolarEclipseAxisPoint } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';
import { deltaTSeconds, utDays } from '../src/time.js';

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
    // Delta-T column, this port's Espenak–Meeus model in whole seconds (within
    // 0.8 s on every row), so no Delta-T floor.
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
    // Gamma is tabulated to 1e-4 radii, 0.32 km of rounding. Measured within
    // 2.4 km through 2049, and 4.1 km at worst (2096-11-15).
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

// ------------------------------------------------------------ central line

interface PathRow { utc: string; latitudeDeg: number; longitudeDeg: number; diameterRatio: number; sunAltDeg: number; durationS: number }
interface PathTable {
  eclipse: string;
  kind: 'total' | 'annular';
  deltaTSeconds: number;
  greatestEclipse: { utc: string; latitudeDeg: number; longitudeDeg: number };
  limits: { latitudeDeg: number; longitudeDeg: number }[];
  centralLine: PathRow[];
}
const pathTables: PathTable[] = load('eclipses/solar-paths.json');

/** Ground tolerance against the path tables, km, and the looser one where a glancing axis meets the ground obliquely. */
const PATH_KM = 5;
const GLANCING_PATH_KM = 15;
/** Mean Earth radius, for ground distances between nearby points, km. */
const EARTH_MEAN_KM = 6371.0088;

type Unit = [number, number, number];
const unit = (latDeg: number, lonDeg: number): Unit => {
  const r = Math.PI / 180;
  return [Math.cos(latDeg * r) * Math.cos(lonDeg * r), Math.cos(latDeg * r) * Math.sin(lonDeg * r), Math.sin(latDeg * r)];
};
const dot3 = (a: Unit, b: Unit) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Unit, b: Unit): Unit => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: Unit, b: Unit) => Math.atan2(Math.hypot(...cross3(a, b)), dot3(a, b));

/** Ground distance between two points, km. */
function groundKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return EARTH_MEAN_KM * angle(unit(aLat, aLon), unit(bLat, bLon));
}

/**
 * The nearest place on a central line to a point: its ground distance, km,
 * and the instant the line passes there, interpolated along the segment.
 */
function nearestOnLine(latDeg: number, lonDeg: number, line: SolarEclipseAxisPoint[]): { km: number; timeMs: number } {
  const p = unit(latDeg, lonDeg);
  let best = { km: Infinity, timeMs: NaN };
  for (let i = 1; i < line.length; i++) {
    const a = unit(line[i - 1].latitudeDeg, line[i - 1].longitudeDeg);
    const b = unit(line[i].latitudeDeg, line[i].longitudeDeg);
    const n = cross3(a, b);
    const nLen = Math.hypot(...n);
    const ab = angle(a, b);
    let rad: number, frac: number;
    // The foot of the perpendicular from p onto the segment's great circle, when it falls inside the segment.
    const s = nLen > 0 ? dot3(p, n) / nLen : 0;
    const foot: Unit = [p[0] - s * n[0] / (nLen || 1), p[1] - s * n[1] / (nLen || 1), p[2] - s * n[2] / (nLen || 1)];
    const af = angle(a, foot), fb = angle(foot, b);
    if (nLen > 0 && Math.abs(af + fb - ab) < 1e-9) {
      rad = Math.abs(Math.asin(Math.max(-1, Math.min(1, s))));
      frac = af / ab;
    } else {
      const pa = angle(p, a), pb = angle(p, b);
      [rad, frac] = pa <= pb ? [pa, 0] : [pb, 1];
    }
    if (EARTH_MEAN_KM * rad < best.km) {
      const t0 = line[i - 1].time.getTime(), t1 = line[i].time.getTime();
      best = { km: EARTH_MEAN_KM * rad, timeMs: t0 + frac * (t1 - t0) };
    }
  }
  return best;
}

/** A table row's instant on this port's time scale: the same TD, since each table's UT uses its own Delta-T. */
function sameTd(utc: string, tableDeltaT: number): number {
  const ms = Date.parse(utc);
  return Math.trunc(ms + (tableDeltaT - deltaTSeconds(2000 + utDays(new Date(ms)) / 365.25)) * SEC);
}

describe('the central line vs the NASA path tables', () => {
  // Greatest eclipse to 0.1′ and the central line every 120 s. A glancing
  // axis meets the ground so obliquely that a kilometer across the axis is
  // several along the ground; of these six only 2044-08-23 (6,129 km) is.
  // Measured: greatest eclipse within 2.6 km, rows within 3.1 km across the
  // line and 4.9 s along it, and ends within 3.6 km, except 2044-08-23 at
  // 8.1 km, 9.4 km and 8.1 s, and 9.1 km.
  for (const table of pathTables) {
    const at = Date.parse(table.greatestEclipse.utc);
    const e = walk.find(x => Math.abs(x.peak.getTime() - at) < DAY)!;
    const glancing = e.axisDistanceKm >= GLANCING_AXIS_KM;
    const tolKm = glancing ? GLANCING_PATH_KM : PATH_KM;
    const line = solarEclipseCentralLine(e.peak, 10);
    const label = `${table.eclipse}${glancing ? ' (glancing)' : ''}`;

    it(`${label}: greatest eclipse within ${tolKm} km of the table's point`, () => {
      const km = groundKm(e.latitudeDeg!, e.longitudeDeg!, table.greatestEclipse.latitudeDeg, table.greatestEclipse.longitudeDeg);
      expect(km, `${km.toFixed(2)} km`).toBeLessThanOrEqual(tolKm);
    });

    it(`${label}: every row within ${tolKm} km of the line, which passes it within 60 s`, () => {
      const bad: string[] = [];
      for (const row of table.centralLine) {
        const near = nearestOnLine(row.latitudeDeg, row.longitudeDeg, line);
        const dt = (near.timeMs - sameTd(row.utc, table.deltaTSeconds)) / SEC;
        if (near.km > tolKm || Math.abs(dt) > 60) bad.push(`${row.utc}: ${near.km.toFixed(2)} km, ${dt.toFixed(1)} s`);
      }
      expect(bad).toEqual([]);
    });

    it(`${label}: the line's ends within ${tolKm} km of the table's limits`, () => {
      const ends = [line[0], line[line.length - 1]];
      ends.forEach((end, i) => {
        const km = groundKm(end.latitudeDeg, end.longitudeDeg, table.limits[i].latitudeDeg, table.limits[i].longitudeDeg);
        expect(km, `end ${i}: ${km.toFixed(2)} km`).toBeLessThanOrEqual(tolKm);
      });
    });

    it(`${label}: every point is ${table.kind}, with the table's obscuration`, () => {
      for (const p of line) expect(p.kind, p.time.toISOString()).toBe(table.kind);
      for (const row of table.centralLine) {
        const p = solarEclipseAxisPoint(new Date(sameTd(row.utc, table.deltaTSeconds)));
        if (p === null) continue;   // a row within the tables' few seconds of timing difference from an end
        // The ratio of apparent diameters is tabulated to 1e-3; its square, the
        // covered area at the center of an annular path, to within 0.002.
        if (table.kind === 'total') expect(p.obscuration, row.utc).toBe(1);
        else expect(Math.abs(p.obscuration - row.diameterRatio ** 2), row.utc).toBeLessThanOrEqual(0.002);
      }
    });
  }
});

describe('the central line against the local search', () => {
  it('the local search at every interior point of the tabulated paths peaks within 2 s of it, with its kind', () => {
    // The ends are where the Sun sits on the horizon. Measured worst 0.40 s over 953 points.
    const bad: string[] = [];
    let checked = 0;
    for (const table of pathTables) {
      const at = Date.parse(table.greatestEclipse.utc);
      const e = walk.find(x => Math.abs(x.peak.getTime() - at) < DAY)!;
      for (const p of solarEclipseCentralLine(e.peak).slice(1, -1)) {
        checked++;
        const t = p.time.getTime();
        const found = solarEclipses(new Date(t - DAY), new Date(t + DAY), { latitudeDeg: p.latitudeDeg, longitudeDeg: p.longitudeDeg });
        if (found.length !== 1) { bad.push(`${p.time.toISOString()}: ${found.length} local eclipses`); continue; }
        const dt = Math.abs(found[0].peak.getTime() - t) / SEC;
        if (dt > 2 || found[0].kind !== p.kind) bad.push(`${p.time.toISOString()}: local ${found[0].kind} ${dt.toFixed(2)} s off`);
      }
    }
    expect(checked).toBeGreaterThan(900);
    expect(bad).toEqual([]);
  });
});

describe('central lines across the catalog', () => {
  const lines = walk.map(e => solarEclipseCentralLine(e.peak));

  it('every central eclipse has a line from contact to contact through whole minutes, and no other eclipse has one', () => {
    let longestH = 0;
    walk.forEach((e, i) => {
      const line = lines[i];
      const label = e.peak.toISOString();
      if (e.kind === 'partial') { expect(line, label).toEqual([]); return; }
      expect(line.length, label).toBeGreaterThanOrEqual(2);
      const first = line[0].time.getTime(), last = line[line.length - 1].time.getTime();
      longestH = Math.max(longestH, (last - first) / 3600000);
      // Every step between the contacts is present, on whole minutes.
      const inner = line.slice(1, -1).map(p => p.time.getTime());
      expect(inner.every(ms => ms % 60000 === 0), label).toBe(true);
      const expected: number[] = [];
      for (let ms = (Math.floor(first / 60000) + 1) * 60000; ms < last; ms += 60000) expected.push(ms);
      expect(inner, label).toEqual(expected);
      // The ends are the contacts, found to the millisecond: the axis misses
      // two milliseconds outside them and meets the ground two inside.
      expect(solarEclipseAxisPoint(new Date(first - 2)), label).toBeNull();
      expect(solarEclipseAxisPoint(new Date(last + 2)), label).toBeNull();
      expect(solarEclipseAxisPoint(new Date(first + 2)), label).not.toBeNull();
      expect(solarEclipseAxisPoint(new Date(last - 2)), label).not.toBeNull();
    });
    // The contact search reaches 6 hours either side of the peak; measured longest 3.88 h (2096-11-15).
    expect(longestH).toBeLessThan(5);
  });

  it('a hybrid path changes kind along its line, annular to total to annular, except the 2013-11-03 path, which ends total', () => {
    // Espenak types 2013-11-03 H3: the path begins annular and ends total.
    const sequences = walk
      .map((e, i) => ({ e, i }))
      .filter(({ i }) => catalog[i].kind === 'hybrid')
      .map(({ e, i }) => `${e.peak.toISOString().slice(0, 10)} ${lines[i].map(p => p.kind[0]).join('').replace(/(.)\1+/g, '$1')}`);
    expect(sequences).toEqual([
      '1986-10-03 ata', '1987-03-29 ata', '2005-04-08 ata', '2013-11-03 at', '2023-04-20 ata',
      '2031-11-14 ata', '2049-11-25 ata', '2050-05-20 ata', '2067-12-06 ata',
    ]);
  });

  it('the axis point at greatest eclipse is the global search\'s ground point', () => {
    // The global point comes from the unrounded root, the axis point from the reported millisecond.
    for (const e of walk) {
      const p = solarEclipseAxisPoint(e.peak);
      if (e.kind === 'partial') { expect(p, e.peak.toISOString()).toBeNull(); continue; }
      expect(p!.kind, e.peak.toISOString()).toBe(e.kind);
      expect(Math.abs(p!.latitudeDeg - e.latitudeDeg!), e.peak.toISOString()).toBeLessThan(1e-3);
      expect(Math.abs(((p!.longitudeDeg - e.longitudeDeg! + 540) % 360) - 180), e.peak.toISOString()).toBeLessThan(1e-3);
      expect(Math.abs(p!.obscuration - e.obscuration!), e.peak.toISOString()).toBeLessThan(1e-6);
    }
  });

  it('a coarser step samples the same instants as a finer one', () => {
    const e = walk.find(x => x.peak.toISOString().startsWith('2026-08-12'))!;
    const fine = new Map(solarEclipseCentralLine(e.peak, 10).map(p => [p.time.getTime(), p]));
    const coarse = solarEclipseCentralLine(e.peak, 60);
    for (const p of coarse) expect(fine.get(p.time.getTime()), p.time.toISOString()).toEqual(p);
  });

  it('has no axis point at a lunar eclipse, where the Sun-Moon line crosses the Earth on the Sun\'s side of the Moon', () => {
    const lunar = lunarEclipses(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX));
    expect(lunar.length).toBeGreaterThan(300);
    expect(lunar.filter(l => solarEclipseAxisPoint(l.peak) !== null).map(l => l.peak.toISOString())).toEqual([]);
  });
});

describe('axis point and central line inputs', () => {
  it('has no axis point or central line away from an eclipse', () => {
    const quiet = new Date('2026-01-15T20:00:00Z');
    expect(solarEclipseAxisPoint(quiet)).toBeNull();
    expect(solarEclipseCentralLine(quiet)).toEqual([]);
  });

  it('validates its inputs', () => {
    const e = walk.find(x => x.peak.toISOString().startsWith('2026-08-12'))!;
    expect(solarEclipseCentralLine(e.peak, 1).length).toBeGreaterThan(5000);
    expect(solarEclipseCentralLine(e.peak, 3600).length).toBeGreaterThanOrEqual(2);
    for (const step of [0, -60, 0.5, 60.5, 3601, NaN, Infinity])
      expect(() => solarEclipseCentralLine(e.peak, step), `step ${step}`).toThrow(RangeError);
    expect(() => solarEclipseAxisPoint(new Date(NaN))).toThrow(RangeError);
    expect(() => solarEclipseAxisPoint(new Date(NaN))).not.toThrow(AlmanacOutOfRangeError);
    expect(() => solarEclipseAxisPoint(new Date(SUPPORTED_MAX))).toThrow(AlmanacOutOfRangeError);
    expect(() => solarEclipseCentralLine(new Date(NaN))).toThrow(RangeError);
    expect(() => solarEclipseCentralLine(new Date(SUPPORTED_MIN - 1))).toThrow(AlmanacOutOfRangeError);
  });
});
