import { describe, it, expect } from 'vitest';
import { julianDay, deltaTSeconds, ttDays, utDays } from '../src/time.js';

describe('julian day', () => {
  it('J2000 epoch', () => {
    expect(julianDay(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545.0, 9);
  });
  it('1950 boundary', () => {
    expect(julianDay(new Date('1950-01-01T00:00:00Z'))).toBeCloseTo(2433282.5, 9);
  });
});
describe('deltaT (Espenak–Meeus)', () => {
  it('year 2000 ≈ 63.9 s', () => {
    expect(deltaTSeconds(2000)).toBeGreaterThan(63);
    expect(deltaTSeconds(2000)).toBeLessThan(65);
  });
  it('year 1955 ≈ 31 s', () => expect(Math.abs(deltaTSeconds(1955) - 31.1)).toBeLessThan(1));
  it('year 2050 ≈ 93 s', () => expect(Math.abs(deltaTSeconds(2050) - 93.0)).toBeLessThan(2));
});
describe('tt', () => {
  it('tt exceeds ut by deltaT', () => {
    const d = new Date('2026-08-28T00:00:00Z');
    expect((ttDays(d) - utDays(d)) * 86400).toBeCloseTo(deltaTSeconds(2026.65), 1);
  });
});
