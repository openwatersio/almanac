import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunPosition, moonPosition } from '../src/index.js';
import { sunApparentAtTT, moonApparentAtTT } from '../src/positions.js';

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
