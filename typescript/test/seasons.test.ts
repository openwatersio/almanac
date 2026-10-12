import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { seasons, AlmanacOutOfRangeError } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const SEC = 1000;
const DAY = 86400 * SEC;

interface SeasonRow { kind: string; utc: string; }
const rows: SeasonRow[] = load('seasons/usno-seasons.json');
const byYear = new Map<number, SeasonRow[]>();
for (const row of rows) {
  const year = +row.utc.slice(0, 4);
  byYear.set(year, [...(byYear.get(year) ?? []), row]);
}
const usnoMs = (utc: string) => Date.parse(utc.replace('Z', ':00Z'));   // minute precision

// A season is a Terrestrial Time event reported in UT, so like a moon phase its
// UT label moves one-for-one with DeltaT; rows after 2050 are quarantined as
// the phases are (see events.test.ts).
const DELTA_T_QUARANTINE_AFTER_YEAR = 2050;
const DELTA_T_MEAN_BOUND_SEC = 120;

// USNO rounds to the minute, 30 s on its own, and the truncated VSOP87 Earth
// series sits within about 1.5 arcseconds of the full theory in longitude,
// 35 s of the Sun's motion: Horizons puts the 2035-03-20 equinox at 19:02:45,
// this port 34 s later, and USNO's 19:02 another 45 s earlier. The measured
// worst through 2050 is 79 s.
const SEASON_TOL_SEC = 90;

it('USNO seasons through 2050 within 90 s, four per year in order', () => {
  const found = seasons(new Date(SUPPORTED_MIN), new Date(Date.UTC(DELTA_T_QUARANTINE_AFTER_YEAR + 1, 0, 1)));
  const expected = rows.filter((r) => +r.utc.slice(0, 4) <= DELTA_T_QUARANTINE_AFTER_YEAR);
  expect(found.length).toBe(expected.length);
  let worst = 0;
  let worstLabel = '';
  for (let i = 0; i < expected.length; i++) {
    expect(found[i].kind, `kind @ ${expected[i].utc}`).toBe(expected[i].kind);
    const signed = (found[i].time.getTime() - usnoMs(expected[i].utc)) / SEC;
    if (Math.abs(signed) > Math.abs(worst)) { worst = signed; worstLabel = expected[i].utc; }
    expect(Math.abs(signed), `${expected[i].kind} @ ${expected[i].utc}`).toBeLessThan(SEASON_TOL_SEC);
  }
  console.log(`USNO seasons 1950-2050: worst ${worst.toFixed(1)} s (${worstLabel})`);
}, 60_000);

it('seasons after 2050 quarantine the DeltaT projection offset', () => {
  let checked = 0;
  for (const [year, run] of byYear) {
    if (year <= DELTA_T_QUARANTINE_AFTER_YEAR) continue;
    const mine = seasons(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)));
    expect(mine.length, `count for ${year}`).toBe(run.length);
    const diffs = run.map((r, i) => (mine[i].time.getTime() - usnoMs(r.utc)) / SEC);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    expect(Math.abs(mean), `${year}: DeltaT projection offset`).toBeLessThan(DELTA_T_MEAN_BOUND_SEC);
    for (let i = 0; i < run.length; i++) {
      expect(mine[i].kind, `kind @ ${run[i].utc}`).toBe(run[i].kind);
      expect(Math.abs(diffs[i] - mean), `${run[i].kind} @ ${run[i].utc}: scatter`).toBeLessThan(SEASON_TOL_SEC);
    }
    checked++;
  }
  expect(checked, 'the catalogue carries post-2050 years').toBe(2100 - DELTA_T_QUARANTINE_AFTER_YEAR);
}, 60_000);

it('a season at endUtc is excluded, at startUtc included', () => {
  const [equinox] = seasons(new Date('2026-03-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'));
  expect(equinox.kind).toBe('marchEquinox');
  expect(seasons(new Date('2026-03-01T00:00:00Z'), equinox.time)).toEqual([]);
  const fromIt = seasons(equinox.time, new Date('2026-04-01T00:00:00Z'));
  expect(fromIt.length).toBe(1);
  expect(fromIt[0].time.getTime()).toBe(equinox.time.getTime());
  // Adjacent windows split at the instant without losing or duplicating it.
  const before = seasons(new Date('2026-01-01T00:00:00Z'), equinox.time);
  const after = seasons(equinox.time, new Date('2027-01-01T00:00:00Z'));
  expect(before.length + after.length).toBe(4);
});

it('empty, reversed, and out-of-range windows', () => {
  const t = new Date('2026-06-01T00:00:00Z');
  expect(seasons(t, t)).toEqual([]);
  expect(seasons(new Date(t.getTime() + DAY), t)).toEqual([]);
  expect(() => seasons(new Date(SUPPORTED_MIN - 1), t)).toThrow(AlmanacOutOfRangeError);
  expect(() => seasons(t, new Date(SUPPORTED_MAX + 1))).toThrow(AlmanacOutOfRangeError);
  expect(() => seasons(new Date(NaN), t)).toThrow();
  // Validation precedes the reversed-window short circuit.
  expect(() => seasons(new Date(SUPPORTED_MAX + DAY), t)).toThrow(AlmanacOutOfRangeError);
});

it('the full supported window is legal and holds 604 seasons', () => {
  const all = seasons(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX));
  expect(all.length).toBe(604);
  for (let i = 1; i < all.length; i++) {
    expect(all[i].time.getTime()).toBeGreaterThan(all[i - 1].time.getTime());
    expect(Number.isInteger(all[i].time.getTime())).toBe(true);
  }
}, 60_000);
