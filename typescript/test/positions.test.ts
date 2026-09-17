import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunPosition, moonPosition } from '../src/index.js';
import { sunApparentAtTT, moonApparentAtTT } from '../src/positions.js';
import { earthHelioVector, vsopEarth, type VsopFormula } from '../src/sun.js';
import { PI2 } from '../src/nutation.js';

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
