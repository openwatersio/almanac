import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { solarObscuration, AlmanacOutOfRangeError } from '../src/index.js';
import type { Observer } from '../src/index.js';
import { SUPPORTED_MAX } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

const DAY = 86400000;
const VICTORIA: Observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0 };
/** A path at least this wide keeps the catalog's whole-degree observer inside it. */
const WIDE_PATH_KM = 200;

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
const observerOf = (row: CatalogRow): Observer => ({ latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg });
const isWide = (row: CatalogRow) => row.pathWidthKm !== null && row.pathWidthKm >= WIDE_PATH_KM;

describe('solarObscuration at the point of greatest eclipse', () => {
  it('covers 1950-2100', () => {
    expect(catalog.length).toBeGreaterThan(300);
    expect(catalog[0].peakUtc.startsWith('1950')).toBe(true);
    expect(catalog[catalog.length - 1].peakUtc.startsWith('2100')).toBe(true);
  });

  it('matches every catalog row\'s kind', () => {
    const bad: string[] = [];
    for (const row of catalog) {
      const obs = solarObscuration(new Date(row.peakUtc), observerOf(row));
      const wide = isWide(row);
      let ok: boolean;
      if (row.kind === 'partial') ok = obs > 0;
      else if (row.kind === 'annular') ok = wide ? Math.abs(obs - row.magnitude ** 2) <= 0.01 : obs >= row.magnitude ** 2 - 0.1;
      else ok = wide ? obs === 1 : obs >= 0.9;   // total and hybrid
      if (!ok) bad.push(`${row.peakUtc} ${row.kind}${wide ? '' : ' (narrow)'}: obscuration ${obs.toFixed(4)}, magnitude ${row.magnitude}`);
    }
    expect(bad).toEqual([]);
  });

  it('is zero a day away from any eclipse', () => {
    expect(solarObscuration(new Date('2026-01-15T20:00:00Z'), VICTORIA)).toBe(0);
  });

  it('validates its inputs', () => {
    expect(() => solarObscuration(new Date(SUPPORTED_MAX), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => solarObscuration(new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => solarObscuration(new Date('2026-01-15T20:00:00Z'), { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  });
});
