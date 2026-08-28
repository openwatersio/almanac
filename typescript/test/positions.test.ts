import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunPosition, moonPosition } from '../src/index.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const sep = (ra1: number, dec1: number, ra2: number, dec2: number) => {
  const r = Math.PI / 180, c = Math.sin(dec1*r)*Math.sin(dec2*r) + Math.cos(dec1*r)*Math.cos(dec2*r)*Math.cos((ra1-ra2)*r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r * 60; // arcmin
};

for (const [file, fn, distKey, tolDist] of [
  ['positions/sun-coarse.json', sunPosition, 'distanceAu', 1e-4],
  ['positions/moon-coarse.json', moonPosition, 'distanceKm', 50],
  ['positions/sun-dense.json', sunPosition, 'distanceAu', 1e-4],
  ['positions/moon-dense.json', moonPosition, 'distanceKm', 50],
] as const) {
  it(`${file} within 1 arcmin`, () => {
    for (const row of load(file)) {
      const p: any = fn(new Date(row.utc));
      expect(sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), `${file} @ ${row.utc}`).toBeLessThan(1);
      expect(Math.abs(p[distKey] - row[distKey])).toBeLessThan(tolDist);
    }
  });
}
it('out of range throws', () => expect(() => sunPosition(new Date('1949-12-31T23:59:59Z'))).toThrow());
