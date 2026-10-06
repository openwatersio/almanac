import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { horizonDip } from '../src/index.js';

const sea = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 2 };

it('matches pinned upstream dip across latitude and height', () => {
    const rows = JSON.parse(readFileSync(new URL('../../fixtures/horizon/dip.json', import.meta.url), 'utf8'));
    expect(rows).toHaveLength(25);
    for (const row of rows) expect(Math.abs(horizonDip(row.observer, row.heightAboveGroundM) - row.dipDeg)).toBeLessThan(1e-10);
});

it('returns positive zero at ground level and lowers the horizon with height', () => {
    expect(Object.is(horizonDip(sea, 0), 0)).toBe(true);
    expect(horizonDip(sea, 2)).toBeLessThan(0);
    expect(horizonDip({ ...sea, elevationM: 10 }, 10)).toBeLessThan(horizonDip(sea, 2));
});

it('validates observer, eye height, and ground elevation', () => {
    for (const height of [NaN, Infinity, -1, 10001]) expect(() => horizonDip(sea, height)).toThrow(RangeError);
    expect(() => horizonDip({ ...sea, latitudeDeg: NaN }, 0)).toThrow(RangeError);
    expect(() => horizonDip({ ...sea, elevationM: -499 }, 2)).toThrow(RangeError);
    expect(horizonDip({ ...sea, elevationM: -499 }, 1)).toBeLessThan(0);
});
