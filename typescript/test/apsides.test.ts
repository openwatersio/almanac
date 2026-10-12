import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { moonApsides, moonPosition, AlmanacOutOfRangeError } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const SEC = 1000;
const DAY = 86400 * SEC;

interface ApsisRow { utc: string; kind: string; distanceKm: number; }
const rows: ApsisRow[] = load('apsides/horizons-apsides.json');

// Three Horizons windows; group by contiguous run so a window's count can be
// compared without inventing gaps.
const runs: ApsisRow[][] = [];
for (const row of rows) {
  const last = runs[runs.length - 1];
  if (!last || Date.parse(row.utc) - Date.parse(last[last.length - 1].utc) > 20 * DAY) runs.push([row]);
  else last.push(row);
}

// The distance curve is flat at an apsis, so its timing is ill-conditioned:
// MOON2's periodic distance residual against JPL, about 140 ppm, moves the
// extremum by minutes, most at apogee where the curve is flattest. The
// measured worst is 14.8 minutes and 54 km across the three windows.
const APSIS_TIME_TOL_SEC = 20 * 60;
const APSIS_DIST_TOL_KM = 70;

it('Horizons apsides within 20 minutes and 70 km, alternating kinds', () => {
  let worstTime = 0;
  let worstDist = 0;
  let label = '';
  for (const run of runs) {
    const mine = moonApsides(new Date(Date.parse(run[0].utc) - DAY), new Date(Date.parse(run[run.length - 1].utc) + DAY));
    expect(mine.length, `count for run starting ${run[0].utc}`).toBe(run.length);
    for (let i = 0; i < run.length; i++) {
      expect(mine[i].kind, `kind @ ${run[i].utc}`).toBe(run[i].kind);
      const dt = (mine[i].time.getTime() - Date.parse(run[i].utc)) / SEC;
      const dd = mine[i].distanceKm - run[i].distanceKm;
      if (Math.abs(dt) > Math.abs(worstTime)) { worstTime = dt; label = `${run[i].kind} @ ${run[i].utc}`; }
      if (Math.abs(dd) > Math.abs(worstDist)) worstDist = dd;
      expect(Math.abs(dt), `${run[i].kind} @ ${run[i].utc}`).toBeLessThan(APSIS_TIME_TOL_SEC);
      expect(Math.abs(dd), `${run[i].kind} distance @ ${run[i].utc}`).toBeLessThan(APSIS_DIST_TOL_KM);
    }
  }
  console.log(`Horizons apsides: worst ${(worstTime / 60).toFixed(1)} min (${label}), ${worstDist.toFixed(1)} km`);
});

it('reported distance is the position model distance at that instant', () => {
  for (const a of moonApsides(new Date('2026-01-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'))) {
    expect(Math.abs(a.distanceKm - moonPosition(a.time).distanceKm)).toBeLessThan(1e-3);
    // An apsis is an extremum: the distance an hour either side lies on the same side of it.
    const before = moonPosition(new Date(a.time.getTime() - 3600 * SEC)).distanceKm - a.distanceKm;
    const after = moonPosition(new Date(a.time.getTime() + 3600 * SEC)).distanceKm - a.distanceKm;
    const sign = a.kind === 'perigee' ? 1 : -1;
    expect(sign * before).toBeGreaterThan(0);
    expect(sign * after).toBeGreaterThan(0);
  }
});

it('an apsis at endUtc is excluded, at startUtc included', () => {
  const [first] = moonApsides(new Date('2026-03-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'));
  expect(moonApsides(new Date('2026-03-01T00:00:00Z'), first.time)).toEqual([]);
  const fromIt = moonApsides(first.time, new Date('2026-04-01T00:00:00Z'));
  expect(fromIt[0].time.getTime()).toBe(first.time.getTime());
  const before = moonApsides(new Date('2026-01-01T00:00:00Z'), first.time);
  const after = moonApsides(first.time, new Date('2027-01-01T00:00:00Z'));
  expect(before.length + after.length).toBe(moonApsides(new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z')).length);
});

it('empty, reversed, and out-of-range windows', () => {
  const t = new Date('2026-06-01T00:00:00Z');
  expect(moonApsides(t, t)).toEqual([]);
  expect(moonApsides(new Date(t.getTime() + DAY), t)).toEqual([]);
  expect(() => moonApsides(new Date(SUPPORTED_MIN - 1), t)).toThrow(AlmanacOutOfRangeError);
  expect(() => moonApsides(t, new Date(SUPPORTED_MAX + 1))).toThrow(AlmanacOutOfRangeError);
  expect(() => moonApsides(new Date(NaN), t)).toThrow();
  expect(() => moonApsides(new Date(SUPPORTED_MAX + DAY), t)).toThrow(AlmanacOutOfRangeError);
});

it('the full supported window is legal, sorted, and alternates', () => {
  const all = moonApsides(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX));
  expect(all.length).toBe(4003);
  for (let i = 1; i < all.length; i++) {
    expect(all[i].time.getTime()).toBeGreaterThan(all[i - 1].time.getTime());
    expect(all[i].kind).not.toBe(all[i - 1].kind);
  }
}, 60_000);
