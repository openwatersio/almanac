import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunPosition, moonPosition, starPosition, greenwichSiderealTime, equationOfTime, AlmanacOutOfRangeError } from '../src/index.js';
import { sunApparentAtTT, moonApparentAtTT, equationOfTimeAtTT } from '../src/positions.js';
import { earthHelioState, earthHelioVector, vsopEarth, type VsopFormula } from '../src/sun.js';
import { PI2, equatorialFromVector, wrapDeg360 } from '../src/nutation.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const sep = (ra1: number, dec1: number, ra2: number, dec2: number) => {
  const r = Math.PI / 180, c = Math.sin(dec1*r)*Math.sin(dec2*r) + Math.cos(dec1*r)*Math.cos(dec2*r)*Math.cos((ra1-ra2)*r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r * 60; // arcmin
};
// MOON2 runs ~27 ppm low on distance vs JPL ephemerides — model-inherent, not a
// port defect (the reference implementation reproduces it exactly); angular 1' unaffected.
const MOON_DIST_TOL_KM = 70;

// Coarse fixtures are TT-labeled: feed row.tt straight to the internal TT entry
// points, so no ΔT model sits between the ephemeris and the reference data.
const ttDaysOf = (tt: string) => (Date.parse(tt) - Date.UTC(2000, 0, 1, 12)) / 86400000;

for (const [file, fn, distKey, tolDist] of [
  ['positions/sun-coarse.json', sunApparentAtTT, 'distanceAu', 1e-4],
  ['positions/moon-coarse.json', moonApparentAtTT, 'distanceKm', MOON_DIST_TOL_KM],
] as const) {
  it(`${file} within 1 arcmin`, () => {
    for (const row of load(file)) {
      const p: any = fn(ttDaysOf(row.tt));
      expect(sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), `${file} @ ${row.tt}`).toBeLessThan(1);
      expect(Math.abs(p[distKey] - row[distKey]), `${file} @ ${row.tt}`).toBeLessThan(tolDist);
    }
  });
}

// Dense fixtures stay UT-labeled and exercise the public API end to end.
for (const [file, fn, distKey, tolDist] of [
  ['positions/sun-dense.json', sunPosition, 'distanceAu', 1e-4],
  ['positions/moon-dense.json', moonPosition, 'distanceKm', MOON_DIST_TOL_KM],
] as const) {
  it(`${file} within 1 arcmin`, () => {
    for (const row of load(file)) {
      const p: any = fn(new Date(row.utc));
      expect(sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), `${file} @ ${row.utc}`).toBeLessThan(1);
      expect(Math.abs(p[distKey] - row[distKey]), `${file} @ ${row.utc}`).toBeLessThan(tolDist);
    }
  });
}
it('out of range throws', () => expect(() => sunPosition(new Date('1949-12-31T23:59:59Z'))).toThrow());

// Horizons' local apparent solar time at longitude 0 is UT plus the equation of
// time. The 2100 rows carry Horizons' frozen Delta-T, which moves the UT label
// by up to 134 s; the equation of time changes under 0.5 min a day, so that is
// below a thousandth of a minute here.
const EOT_TOL_MIN = 2 / 60;
it('equation-of-time/horizons-eot.json within 2 s', () => {
  let worst = 0;
  for (const row of load('equation-of-time/horizons-eot.json')) {
    const diff = equationOfTime(new Date(row.utc)) - row.minutes;
    worst = Math.max(worst, Math.abs(diff));
    expect(Math.abs(diff), `equation of time @ ${row.utc}`).toBeLessThan(EOT_TOL_MIN);
  }
  expect(worst).toBeGreaterThan(0);
});
// Meeus, Astronomical Algorithms, example 28.a: 1992 October 13 at 0h TD, E = +13m42.6s.
it('Meeus example 28.a', () => {
  expect(Math.abs(equationOfTimeAtTT(ttDaysOf('1992-10-13T00:00:00Z')) - (13 + 42.6 / 60))).toBeLessThan(0.05);
});
it('equation of time out of range throws', () => expect(() => equationOfTime(new Date('2101-01-01T00:00:00Z'))).toThrow());

// `earthHelioVector` evaluates the VSOP87 Earth series term by term. This is
// upstream's `VsopFormula` loop over the same table; the unrolled functions
// must reproduce it bit for bit across the supported interval.
it('unrolled VSOP Earth series matches the upstream loop bit for bit', () => {
  const vsopFormula = (formula: VsopFormula, t: number, clampAngle: boolean) => {
    let tpower = 1, coord = 0;
    for (const series of formula) {
      let sum = 0;
      for (const [ampl, phas, freq] of series) sum += ampl * Math.cos(phas + (t * freq));
      let incr = tpower * sum;
      if (clampAngle) incr %= PI2;
      coord += incr;
      tpower *= t;
    }
    return coord;
  };
  const reference = (tt: number) => {
    const t = tt / 365250;
    const eclip = {
      lon: vsopFormula(vsopEarth[0], t, true), lat: vsopFormula(vsopEarth[1], t, false), rad: vsopFormula(vsopEarth[2], t, false)
    };
    const rCosLat = eclip.rad * Math.cos(eclip.lat);
    const e = { x: rCosLat * Math.cos(eclip.lon), y: rCosLat * Math.sin(eclip.lon), z: eclip.rad * Math.sin(eclip.lat) };
    return {
      x: e.x + 0.000000440360*e.y - 0.000000190919*e.z,
      y: -0.000000479966*e.x + 0.917482137087*e.y - 0.397776982902*e.z,
      z: 0.397776982902*e.y + 0.917482137087*e.z
    };
  };
  for (let tt = -73048; tt <= 36525; tt += 7.3) {   // 1800 through 2100, an odd stride
    expect(earthHelioVector(tt)).toEqual(reference(tt));
  }
});

// USNO's celestial-navigation GHA and declination for the navigational stars,
// from each star's SIMBAD J2000 position. The places include proper motion and
// starPosition does not, so the test first moves each star along its catalog
// proper motion to the date, linearly, keeping the J2000 equinox. Every row is
// then held to 1″ on the sky; annual aberration alone is up to 20.5″.
it('positions/stars-usno.json GHA and declination within 1″', () => {
  const rows = load('positions/stars-usno.json');
  expect(rows.length).toBeGreaterThan(100);
  for (const row of rows) {
    const t = new Date(row.utc);
    const years = (t.getTime() - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
    const decDeg = row.decDeg + row.pmDecMasPerYear * years / 3.6e6;
    const raDeg = (row.raDeg + row.pmRaMasPerYear * years / 3.6e6 / Math.cos(row.decDeg * Math.PI / 180) + 360) % 360;
    const p = starPosition(raDeg, decDeg, t);
    const gha = greenwichSiderealTime(t) - p.raDeg;
    const dGha = ((((gha - row.ghaDeg) % 360) + 540) % 360) - 180;
    expect(Math.abs(dGha) * Math.cos(p.decDeg * Math.PI / 180) * 3600, `${row.star} GHA @ ${row.utc}`).toBeLessThan(1);
    expect(Math.abs(p.decDeg - row.decOfDateDeg) * 3600, `${row.star} dec @ ${row.utc}`).toBeLessThan(1);
  }
});

it('starPosition returns right ascension in [0, 360)', () => {
  const t = new Date('2026-03-20T06:00:00Z');
  for (const ra of [0, 0.001, 359.999]) {
    const p = starPosition(ra, 0, t);
    expect(p.raDeg).toBeGreaterThanOrEqual(0);
    expect(p.raDeg).toBeLessThan(360);
  }
});

it('starPosition rejects a catalog position off the sphere and a time outside the interval', () => {
  const t = new Date('2026-03-20T06:00:00Z');
  expect(() => starPosition(360, 0, t)).toThrow(RangeError);
  expect(() => starPosition(-1, 0, t)).toThrow(RangeError);
  expect(() => starPosition(0, -90.5, t)).toThrow(RangeError);
  expect(() => starPosition(0, NaN, t)).toThrow(RangeError);
  expect(() => starPosition(0, 0, new Date(Date.UTC(2101, 0, 1)))).toThrow(AlmanacOutOfRangeError);
});

it("earthHelioState's velocity is the derivative of earthHelioVector", () => {
  const h = 0.01; // days
  for (const tt of [-18262, 0, 9573.25, 36524]) {
    const { pos, vel } = earthHelioState(tt);
    const a = earthHelioVector(tt - h), b = earthHelioVector(tt + h), here = earthHelioVector(tt);
    expect(pos).toEqual(here);
    for (const k of ['x', 'y', 'z'] as const)
      expect(Math.abs(vel[k] - (b[k] - a[k]) / (2 * h))).toBeLessThan(1e-9); // AU per day; orbital speed is ~0.0172
  }
});

it('wrapDeg360 stays below 360 when the remainder is an ulp under zero', () => {
  // 360 - 1e-14 rounds to 360 itself; a plain `+= 360` returns it.
  expect(wrapDeg360(-1e-14)).toBe(0);
  expect(wrapDeg360(360)).toBe(0);
  expect(wrapDeg360(-90)).toBe(270);
  expect(wrapDeg360(725)).toBe(5);
  expect(wrapDeg360(359.5)).toBe(359.5);
  expect(equatorialFromVector({ x: 1, y: -1e-300, z: 0 }).raDeg).toBe(0);
});
