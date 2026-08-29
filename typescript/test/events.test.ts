import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunEvents, moonEvents, searchMoonPhases, moonIllumination, AlmanacOutOfRangeError } from '../src/index.js';
import { topoAltAzUnrefracted } from '../src/transforms.js';
import { sunGeoVectorEqj } from '../src/sun.js';
import { moonGeoVectorEqj } from '../src/moon.js';
import { ttDaysFromUt, utDays } from '../src/time.js';
import type { Observer } from '../src/types.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

const SEC = 1000;
const DAY = 86400 * SEC;
const VICTORIA: Observer = { latitudeDeg: 48.7621, longitudeDeg: -123.052, elevationM: 0 };

// ---------------------------------------------------------------- USNO grid

interface UsnoRow {
  date: string;
  latitudeDeg: number;
  longitudeDeg: number;
  sun: Record<string, string>;
  moon: Record<string, string>;
}

// USNO's one-day service reports only these crossing phenomena, so an absent
// key is meaningful evidence of "no such event that UT day" only for them.
// Nautical/astronomical twilight are outside its vocabulary entirely (they are
// checked against Horizons below), and it suppresses Upper Transit whenever the
// body is below the horizon, while this package reports transit unconditionally
// (spec: "polar day/night drops crossings; transit still reported").
const USNO_SUN_CROSSINGS = ['rise', 'set', 'civilDawn', 'civilDusk'] as const;
const USNO_MOON_CROSSINGS = ['rise', 'set'] as const;

const usnoGrid: UsnoRow[] = load('events/usno-grid.json');

// Spec, Fixture corpus > Far-future event rows: USNO fixtures are UT-based, so
// rows after 2050 measure Espenak-Meeus against USNO's DeltaT projection on top
// of the astronomy. Those rows assert scatter about their per-date mean offset,
// with the mean itself bounded as documented divergence.
const DELTA_T_QUARANTINE_AFTER_YEAR = 2050;
const DELTA_T_MEAN_BOUND_SEC = 120;
const isFarFuture = (row: UsnoRow) => +row.date.slice(0, 4) > DELTA_T_QUARANTINE_AFTER_YEAR;

interface Diff { label: string; seconds: number }

/**
 * Signed (ours - USNO) difference for every crossing USNO reports in the row's
 * UT day, having first asserted the absences: an absent key means "no such
 * event that day" only for the kinds USNO's vocabulary contains.
 */
function usnoDayDiffs(row: UsnoRow, body: 'sun' | 'moon', crossings: readonly string[]): Diff[] {
  const observer: Observer = { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, elevationM: 0 };
  const dayStart = new Date(`${row.date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + DAY);
  const found = body === 'sun'
    ? sunEvents(dayStart, dayEnd, observer)
    : moonEvents(dayStart, dayEnd, observer);
  const expected = row[body];
  const diffs: Diff[] = [];

  for (const kind of crossings) {
    const mine = found.filter((e) => e.kind === kind);
    const label = `${body} ${kind} @ ${row.date} lat ${row.latitudeDeg}`;
    if (expected[kind] === undefined) {
      expect(mine.map((e) => e.time.toISOString()), `${label}: USNO reports none`).toEqual([]);
      continue;
    }
    expect(mine.length, `${label}: expected exactly one`).toBe(1);
    diffs.push({ label, seconds: (mine[0].time.getTime() - Date.parse(`${row.date}T${expected[kind]}:00Z`)) / SEC });
  }
  return diffs;
}

for (const [body, crossings] of [['sun', USNO_SUN_CROSSINGS], ['moon', USNO_MOON_CROSSINGS]] as const) {
  it(`USNO grid: ${body} crossings through 2050 within 60 s`, () => {
    let worst = 0;
    let worstLabel = '';
    for (const row of usnoGrid) {
      if (isFarFuture(row)) continue;
      for (const d of usnoDayDiffs(row, body, crossings)) {
        expect(Math.abs(d.seconds), d.label).toBeLessThan(60);
        if (Math.abs(d.seconds) > Math.abs(worst)) { worst = d.seconds; worstLabel = d.label; }
      }
    }
    console.log(`USNO grid ${body}: worst ${worst.toFixed(1)} s (${worstLabel})`);
  });
}

it('USNO grid: rows after 2050 quarantine the DeltaT projection offset', () => {
  const byDate = new Map<string, Diff[]>();
  for (const row of usnoGrid) {
    if (!isFarFuture(row)) continue;
    const diffs = [
      ...usnoDayDiffs(row, 'sun', USNO_SUN_CROSSINGS),
      ...usnoDayDiffs(row, 'moon', USNO_MOON_CROSSINGS),
    ];
    const forDate = byDate.get(row.date) ?? byDate.set(row.date, []).get(row.date)!;
    forDate.push(...diffs);
  }
  expect(byDate.size, 'the grid carries at least one post-2050 date').toBeGreaterThan(0);
  for (const [date, diffs] of byDate) {
    // A scatter rule over a single sample is vacuous — the mean is that sample.
    expect(diffs.length, `${date}: the scatter rule needs more than one crossing`).toBeGreaterThan(1);
    const mean = diffs.reduce((a, d) => a + d.seconds, 0) / diffs.length;
    const scatter = Math.max(...diffs.map((d) => Math.abs(d.seconds - mean)));
    console.log(`USNO grid ${date}: DeltaT offset ${mean.toFixed(1)} s over ${diffs.length} crossings, scatter ${scatter.toFixed(1)} s`);
    expect(Math.abs(mean), `${date}: DeltaT projection offset`).toBeLessThan(DELTA_T_MEAN_BOUND_SEC);
    for (const d of diffs) {
      expect(Math.abs(d.seconds - mean), `${d.label}: scatter about the date offset`).toBeLessThan(60);
    }
  }
});

// Transit stays on the strict absolute bound at every epoch: an upper transit is
// fixed by sidereal time, so a DeltaT error moves it by only DeltaT * 0.0027.
it('USNO grid: sun transit within 60 s where USNO reports one', () => {
  let worst = 0;
  for (const row of usnoGrid) {
    if (row.sun.transit === undefined) continue;
    const observer: Observer = { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, elevationM: 0 };
    const dayStart = new Date(`${row.date}T00:00:00Z`);
    const transits = sunEvents(dayStart, new Date(dayStart.getTime() + DAY), observer).filter((e) => e.kind === 'transit');
    expect(transits.length, `transit @ ${row.date} lat ${row.latitudeDeg}`).toBe(1);
    const want = new Date(`${row.date}T${row.sun.transit}:00Z`).getTime();
    worst = Math.max(worst, Math.abs(transits[0].time.getTime() - want));
  }
  console.log(`USNO worst transit margin: ${(worst / SEC).toFixed(1)} s`);
  expect(worst / SEC).toBeLessThan(60);
});

// Polar day/night suppresses USNO's Upper Transit but the spec still reports it.
it('transit is reported through polar night', () => {
  const polar: Observer = { latitudeDeg: 70.5, longitudeDeg: -123.052, elevationM: 0 };
  const dayStart = new Date('2026-12-21T00:00:00Z');
  const events = sunEvents(dayStart, new Date(dayStart.getTime() + DAY), polar);
  expect(events.filter((e) => e.kind === 'transit').length).toBe(1);
  expect(events.filter((e) => e.kind === 'rise' || e.kind === 'set')).toEqual([]);
});

// The 70.5°N polar-day onset: 2026-05-14 carries a 16-minute set/rise pair,
// 2026-05-15 has neither, and 2026-07-27..29 the Moon never clears the horizon.
// Included in the grid loops above; asserted here as named cases so a failure
// says which regime broke.
it('grazing: 70.5°N polar-day onset pair (2026-05-14 set 08:00 / rise 08:16)', () => {
  const polar: Observer = { latitudeDeg: 70.5, longitudeDeg: -123.052, elevationM: 0 };
  const day = new Date('2026-05-14T00:00:00Z');
  const events = sunEvents(day, new Date(day.getTime() + DAY), polar);
  const set = events.find((e) => e.kind === 'set')!;
  const rise = events.find((e) => e.kind === 'rise')!;
  expect(set, 'set found').toBeDefined();
  expect(rise, 'rise found').toBeDefined();
  expect(set.time.getTime()).toBeLessThan(rise.time.getTime());
  // The pair is found at all — the point of the extrema-bracketed search; a
  // fixed grid straddles all 14 minutes of it. Both times are inside 60 s only
  // because the target carries the Sun's true semidiameter: at a graze this
  // slow (0.166"/s) the old fixed 16' put set 66 s out.
  expect(Math.abs(set.time.getTime() - Date.parse('2026-05-14T08:00Z')) / SEC).toBeLessThan(60);
  expect(Math.abs(rise.time.getTime() - Date.parse('2026-05-14T08:16Z')) / SEC).toBeLessThan(60);
});

it('grazing: the day after onset has no sun crossing, the moon none for three days', () => {
  const polar: Observer = { latitudeDeg: 70.5, longitudeDeg: -123.052, elevationM: 0 };
  const d15 = new Date('2026-05-15T00:00:00Z');
  expect(sunEvents(d15, new Date(d15.getTime() + DAY), polar).filter((e) => e.kind !== 'transit')).toEqual([]);
  for (const date of ['2026-07-27', '2026-07-28', '2026-07-29']) {
    const t0 = new Date(`${date}T00:00:00Z`);
    expect(moonEvents(t0, new Date(t0.getTime() + DAY), polar), `moon @ ${date}`).toEqual([]);
  }
});

// -------------------------------------------- Horizons twilight independence

interface AltAzRow { utc: string; altDeg: number; siteLatDeg: number; siteLonDeg: number }

const TWILIGHT_LEVELS = [
  { alt: -6, dawn: 'civilDawn', dusk: 'civilDusk' },
  { alt: -12, dawn: 'nauticalDawn', dusk: 'nauticalDusk' },
  { alt: -18, dawn: 'astroDawn', dusk: 'astroDusk' },
] as const;

it('Horizons airless grid: -6/-12/-18° crossings within 60 s', () => {
  const rows: AltAzRow[] = load('altaz/sun-airless-twilight.json');
  const bySite = new Map<string, AltAzRow[]>();
  for (const r of rows) {
    const key = `${r.siteLatDeg},${r.siteLonDeg}`;
    (bySite.get(key) ?? bySite.set(key, []).get(key)!).push(r);
  }

  let worst = 0;
  let worstLabel = '';
  let checked = 0;

  for (const [key, siteRows] of bySite) {
    const [latitudeDeg, longitudeDeg] = key.split(',').map(Number);
    const observer: Observer = { latitudeDeg, longitudeDeg, elevationM: 0 };
    // The fixture is two disjoint 2-day blocks per site; only consecutive
    // 1-minute samples bracket a crossing.
    for (const level of TWILIGHT_LEVELS) {
      for (let i = 1; i < siteRows.length; i++) {
        const a = siteRows[i - 1];
        const b = siteRows[i];
        const ta = Date.parse(a.utc);
        const tb = Date.parse(b.utc);
        if (tb - ta !== 60 * SEC) continue;
        const fa = a.altDeg - level.alt;
        const fb = b.altDeg - level.alt;
        if (fa === 0 || fa * fb > 0) continue;
        const crossing = ta + ((tb - ta) * fa) / (fa - fb);
        const kind = fb > fa ? level.dawn : level.dusk;
        const found = sunEvents(new Date(ta - 2 * 3600 * SEC), new Date(tb + 2 * 3600 * SEC), observer)
          .filter((e) => e.kind === kind)
          .map((e) => Math.abs(e.time.getTime() - crossing))
          .sort((x, y) => x - y);
        const label = `${kind} @ ${a.utc} site ${key}`;
        expect(found.length, `${label}: no matching event`).toBeGreaterThan(0);
        checked++;
        if (found[0] > worst) { worst = found[0]; worstLabel = label; }
        expect(found[0] / SEC, label).toBeLessThan(60);
      }
    }
  }
  console.log(`Horizons twilight: ${checked} crossings, worst ${(worst / SEC).toFixed(1)} s (${worstLabel})`);
  expect(checked).toBeGreaterThan(20);
}, 120_000);

// -------------------------------------------------------------- moon phases

interface PhaseRow { phase: 'new' | 'firstQuarter' | 'full' | 'lastQuarter'; utc: string }
const phaseRows: PhaseRow[] = load('phases/usno-phases.json');

// The fixture is seven 99-entry USNO runs; group by contiguous run so a
// window's count can be compared without inventing gaps.
const phaseRuns: PhaseRow[][] = (() => {
  const sorted = [...phaseRows].sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc));
  const runs: PhaseRow[][] = [];
  for (const row of sorted) {
    const last = runs[runs.length - 1];
    if (!last || Date.parse(row.utc) - Date.parse(last[last.length - 1].utc) > 40 * DAY) runs.push([row]);
    else last.push(row);
  }
  return runs;
})();

// A moon phase is a Terrestrial Time event reported in UT, so unlike a rise or a
// transit its UT label moves one-for-one with DeltaT. The spec fixes DeltaT to
// Espenak-Meeus, whose far-future branch is the Morrison-Stephenson tidal
// parabola: 145.9 s at 2075 and 198.0 s at 2098, where USNO's projection of the
// recent near-flat trend is ~43 s and ~85 s lower. So the same quarantine the
// grid uses applies here, by run. The ephemeris is exonerated independently: the
// TT-labelled Horizons fixtures put this port's lunar and solar longitudes
// sub-arcsecond across the whole 1950-2100 interval, under 2 s of phase time.
const runYear = (run: PhaseRow[]) => +run[0].utc.slice(0, 4);
const isDeltaTDivergent = (run: PhaseRow[]) => runYear(run) > DELTA_T_QUARANTINE_AFTER_YEAR;

function checkPhaseRun(run: PhaseRow[], toleranceSeconds: number): { worst: number; label: string; median: number } {
  const start = new Date(Date.parse(run[0].utc) - 6 * 3600 * SEC);
  const end = new Date(Date.parse(run[run.length - 1].utc) + 6 * 3600 * SEC);
  const mine = searchMoonPhases(start, end);
  expect(mine.length, `count for run starting ${run[0].utc}`).toBe(run.length);
  const diffs: number[] = [];
  let worst = 0;
  let label = '';
  for (let i = 0; i < run.length; i++) {
    expect(mine[i].phase, `phase order @ ${run[i].utc}`).toBe(run[i].phase);
    const signed = (mine[i].time.getTime() - Date.parse(run[i].utc)) / SEC;
    diffs.push(signed);
    if (Math.abs(signed) > Math.abs(worst)) { worst = signed; label = `${run[i].phase} @ ${run[i].utc}`; }
    expect(Math.abs(signed), `${run[i].phase} @ ${run[i].utc}`).toBeLessThan(toleranceSeconds);
  }
  diffs.sort((a, b) => a - b);
  return { worst, label, median: diffs[diffs.length >> 1] };
}

it('USNO moon phases within 60 s, matching count per window', () => {
  let worst = 0;
  let worstLabel = '';
  for (const run of phaseRuns) {
    if (isDeltaTDivergent(run)) continue;   // quarantined below
    const r = checkPhaseRun(run, 60);
    if (Math.abs(r.worst) > Math.abs(worst)) { worst = r.worst; worstLabel = r.label; }
  }
  console.log(`USNO phases 1950-2050: worst ${worst.toFixed(1)} s (${worstLabel})`);
}, 60_000);

it('moon phase runs after 2050 quarantine the DeltaT projection offset', () => {
  let checked = 0;
  for (const run of phaseRuns) {
    if (!isDeltaTDivergent(run)) continue;
    const start = new Date(Date.parse(run[0].utc) - 6 * 3600 * SEC);
    const end = new Date(Date.parse(run[run.length - 1].utc) + 6 * 3600 * SEC);
    const mine = searchMoonPhases(start, end);
    expect(mine.length, `count for run starting ${run[0].utc}`).toBe(run.length);
    const diffs = run.map((r, i) => (mine[i].time.getTime() - Date.parse(r.utc)) / SEC);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const scatter = Math.max(...diffs.map((d) => Math.abs(d - mean)));
    console.log(`USNO phases ${runYear(run)}: DeltaT offset ${mean.toFixed(1)} s, scatter ${scatter.toFixed(1)} s`);
    expect(Math.abs(mean), `${runYear(run)}: DeltaT projection offset`).toBeLessThan(DELTA_T_MEAN_BOUND_SEC);
    for (let i = 0; i < run.length; i++) {
      expect(mine[i].phase, `phase order @ ${run[i].utc}`).toBe(run[i].phase);
      expect(Math.abs(diffs[i] - mean), `${run[i].phase} @ ${run[i].utc}: scatter`).toBeLessThan(60);
    }
    checked++;
  }
  expect(checked, 'the catalogue carries post-2050 runs').toBeGreaterThan(0);
}, 60_000);

it('searched quarters are self-consistent with illumination', () => {
  const found = searchMoonPhases(new Date('2026-01-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'));
  const first = found.find((e) => e.phase === 'firstQuarter')!;
  const last = found.find((e) => e.phase === 'lastQuarter')!;
  // Both read the same apparent elongation (illumination.ts moonPhaseDeg), so
  // this is exact to the search's own 0.1 s root tolerance.
  const fq = moonIllumination(first.time);
  expect(Math.abs(fq.phase - 0.25)).toBeLessThan(1e-6);
  expect(fq.waxing).toBe(true);
  const lq = moonIllumination(last.time);
  expect(Math.abs(lq.phase - 0.75)).toBeLessThan(1e-6);
  expect(lq.waxing).toBe(false);
});

// --------------------------------------------------- latitude sweep residual

// No fixture reaches the latitudes where the daily cycle flattens and the
// altitude extremum drifts hours off transit — the offset scales as 1/cos, and
// the Moon's fast declination rate puts it 2.28 h off at 88N and 5.75 h at
// 88.9N, which is why the search widens its bracket from |lat| >= 85 rather
// than 89. Inside the old 89 threshold the 85-89 band converged to a bracket
// edge and the monotonic-segment invariant failed, so this sweep covers it.
//
// The invariant that holds everywhere: at a reported rise or set the body's
// unrefracted centre altitude is exactly -(34' + its true semidiameter at the
// topocentric distance). The residual is normalised by the local altitude rate,
// so the assertion is the algorithm's own contract — the root is solved to under
// a second — at every latitude, from 15 deg/h at the equator to a near
// standstill at the pole.
const KM_PER_AU_TEST = 1.4959787069098932e8;
const BODIES = [
  { name: 'sun', vector: sunGeoVectorEqj, radiusKm: 695700, events: sunEvents },
  { name: 'moon', vector: moonGeoVectorEqj, radiusKm: 1737.4, events: moonEvents },
] as const;

it('every rise/set sits on the target altitude, pole to equator, both bodies', () => {
  let worst = 0;
  let worstLabel = '';
  for (const body of BODIES) {
    const offset = (t: Date, o: Observer) => {
      const ut = utDays(t);
      const p = topoAltAzUnrefracted(body.vector(ttDaysFromUt(ut)), ut, o);
      const target = -34 / 60 - (180 / Math.PI) * Math.asin(body.radiusKm / (p.distanceAu * KM_PER_AU_TEST));
      return p.altDeg - target;
    };
    for (const latitudeDeg of [-89.5, -35, 0, 48.7621, 70.5, 86, 88, 88.9, 89.5, 90]) {
      const observer: Observer = { latitudeDeg, longitudeDeg: -123.052, elevationM: 0 };
      // Above the flattening threshold a crossing can be months away, so those
      // latitudes get a whole year rather than a month.
      const flat = Math.abs(latitudeDeg) >= 85;
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date(start.getTime() + (flat ? 366 : 40) * DAY);
      const events = body.events(start, end, observer);
      const crossings = events.filter((e) => e.kind === 'rise' || e.kind === 'set');
      expect(crossings.length, `${body.name} lat ${latitudeDeg}: found a rise and a set`).toBeGreaterThan(1);
      for (const e of crossings) {
        const residual = Math.abs(offset(e.time, observer));
        const ratePerSec = Math.abs(offset(new Date(e.time.getTime() + 30 * SEC), observer)
          - offset(new Date(e.time.getTime() - 30 * SEC), observer)) / 60;
        const seconds = residual / ratePerSec;
        if (seconds > worst) { worst = seconds; worstLabel = `${body.name} lat ${latitudeDeg}`; }
        expect(seconds, `${body.name} lat ${latitudeDeg} ${e.kind} @ ${e.time.toISOString()}`).toBeLessThan(1);
      }
      for (let i = 1; i < events.length; i++) {
        expect(events[i].time.getTime(), `${body.name} lat ${latitudeDeg}: sorted`)
          .toBeGreaterThanOrEqual(events[i - 1].time.getTime());
      }
    }
  }
  console.log(`rise/set target residual: worst ${worst.toFixed(3)} s of time (${worstLabel})`);
}, 120_000);

// A residual test can only speak for the events that were found; a bracket that
// misses one leaves nothing to measure. So the flattening band gets an
// independent oracle: a 1-minute brute-force scan of the same unrefracted
// altitude, every sign change of which must be matched one-for-one.
//
// This is the regression for the |lat| >= 85 threshold. At the old 89 the Moon
// at -88.5 lost the 2026-09-26 rise and its set: the extremum sits 5.75 h off
// transit there, past the +/-2 h bracket, so golden section returned a bracket
// edge and the segment it produced was not monotonic.
it('flattening band: every crossing a brute-force scan finds is reported', () => {
  const observer: Observer = { latitudeDeg: -88.5, longitudeDeg: -123.052, elevationM: 0 };
  const start = Date.parse('2026-09-10T00:00:00Z');
  const end = start + 30 * DAY;
  const offset = (ms: number) => {
    const ut = utDays(new Date(ms));
    const p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer);
    return p.altDeg - (-34 / 60 - (180 / Math.PI) * Math.asin(1737.4 / (p.distanceAu * KM_PER_AU_TEST)));
  };

  const brute: { ms: number; kind: string }[] = [];
  let prev = offset(start);
  for (let ms = start + 60 * SEC; ms <= end; ms += 60 * SEC) {
    const cur = offset(ms);
    if (prev < 0 && cur >= 0) brute.push({ ms, kind: 'rise' });
    if (prev >= 0 && cur < 0) brute.push({ ms, kind: 'set' });
    prev = cur;
  }
  expect(brute.length, 'the scan window carries crossings to match').toBeGreaterThan(1);

  const mine = moonEvents(new Date(start), new Date(end), observer);
  expect(mine.length, `scan found ${brute.map((b) => `${b.kind} ${new Date(b.ms).toISOString()}`).join(', ')}`)
    .toBe(brute.length);
  for (let i = 0; i < brute.length; i++) {
    expect(mine[i].kind, `crossing ${i}`).toBe(brute[i].kind);
    // The scan brackets each crossing in the minute before its detection.
    expect(Math.abs(mine[i].time.getTime() - brute[i].ms), `crossing ${i} within the scan step`)
      .toBeLessThan(60 * SEC);
  }
}, 60_000);

// ------------------------------------------------------ window / validation

describe('window contract', () => {
  const t1 = new Date('2026-08-28T00:00:00Z');
  const t2 = new Date('2026-08-29T00:00:00Z');

  it('validation precedes the reversed-window short-circuit', () => {
    expect(() => sunEvents(new Date(NaN), t1, VICTORIA)).toThrow(RangeError);
    expect(() => sunEvents(new Date(NaN), t1, VICTORIA)).not.toThrow(AlmanacOutOfRangeError);
    expect(() => moonEvents(new Date(NaN), t1, VICTORIA)).toThrow(RangeError);
    expect(() => searchMoonPhases(new Date(NaN), t1)).toThrow(RangeError);
    expect(() => sunEvents(t2, t1, { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  });

  it('empty and reversed windows return []', () => {
    expect(sunEvents(t1, t1, VICTORIA)).toEqual([]);
    expect(sunEvents(t2, t1, VICTORIA)).toEqual([]);
    expect(moonEvents(t1, t1, VICTORIA)).toEqual([]);
    expect(moonEvents(t2, t1, VICTORIA)).toEqual([]);
    expect(searchMoonPhases(t1, t1)).toEqual([]);
    expect(searchMoonPhases(t2, t1)).toEqual([]);
  });

  it('a window overlapping outside the supported interval is out of range', () => {
    const before = new Date('1949-12-01T00:00:00Z');
    const after = new Date('1950-02-01T00:00:00Z');
    expect(() => sunEvents(before, after, VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => moonEvents(before, after, VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => searchMoonPhases(before, after)).toThrow(AlmanacOutOfRangeError);
    expect(() => sunEvents(new Date(SUPPORTED_MAX - DAY), new Date(SUPPORTED_MAX + 1), VICTORIA))
      .toThrow(AlmanacOutOfRangeError);
  });

  it('the exact full-range window end is legal', () => {
    expect(() => searchMoonPhases(new Date(SUPPORTED_MAX - DAY), new Date(SUPPORTED_MAX))).not.toThrow();
  });

  it('events are sorted ascending and carry integer ms', () => {
    const events = sunEvents(t1, new Date(t1.getTime() + 5 * DAY), VICTORIA);
    expect(events.length).toBeGreaterThan(20);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time.getTime()).toBeGreaterThanOrEqual(events[i - 1].time.getTime());
    }
    for (const e of events) expect(Number.isInteger(e.time.getTime())).toBe(true);
  });

  it('the window is half-open: an event at endUtc is excluded, at startUtc included', () => {
    const transit = sunEvents(t1, t2, VICTORIA).find((e) => e.kind === 'transit')!;
    expect(transit).toBeDefined();
    const at = transit.time.getTime();
    expect(sunEvents(t1, new Date(at), VICTORIA).some((e) => e.time.getTime() === at)).toBe(false);
    expect(sunEvents(new Date(at), t2, VICTORIA).some((e) => e.time.getTime() === at)).toBe(true);
  });

  it('a moon phase at endUtc is excluded, at startUtc included', () => {
    const phase = searchMoonPhases(new Date('2026-08-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))[0];
    const at = phase.time.getTime();
    expect(searchMoonPhases(new Date('2026-08-01T00:00:00Z'), new Date(at)).some((e) => e.time.getTime() === at)).toBe(false);
    expect(searchMoonPhases(new Date(at), new Date('2026-09-01T00:00:00Z'))[0].time.getTime()).toBe(at);
  });
});

// -------------------------------------------------------------------- perf

describe('performance smoke (10x headroom — CI timing asserts are flake factories)', () => {
  it('full-range searchMoonPhases < 10 s', () => {
    const t0 = performance.now();
    const all = searchMoonPhases(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX));
    const dt = performance.now() - t0;
    console.log(`searchMoonPhases 1950-2100: ${all.length} events in ${(dt / 1000).toFixed(2)} s`);
    expect(all.length).toBeGreaterThan(7000);
    expect(dt).toBeLessThan(10_000);
  }, 120_000);

  it('one-year sunEvents + moonEvents < 5 s', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2027-01-01T00:00:00Z');
    const t0 = performance.now();
    const sun = sunEvents(start, end, VICTORIA);
    const moon = moonEvents(start, end, VICTORIA);
    const dt = performance.now() - t0;
    console.log(`one year at Victoria: ${sun.length} sun + ${moon.length} moon events in ${(dt / 1000).toFixed(2)} s`
      + ` (full-range extrapolation ${(dt * 151 / 1000).toFixed(0)} s)`);
    expect(sun.length).toBeGreaterThan(3000);
    expect(moon.length).toBeGreaterThan(600);
    expect(dt).toBeLessThan(5_000);
  }, 60_000);

  // The documented blocking cost: the spec keeps windows unrestricted, so a
  // caller can ask for all 151 years and this is what that costs. Bound 120 s.
  it('full-range sunEvents + moonEvents < 120 s', () => {
    const start = new Date(SUPPORTED_MIN);
    const end = new Date(SUPPORTED_MAX);
    const t0 = performance.now();
    const sun = sunEvents(start, end, VICTORIA);
    const t1 = performance.now();
    const moon = moonEvents(start, end, VICTORIA);
    const dt = performance.now() - t0;
    console.log(`full range 1950-2100 at Victoria: ${sun.length} sun in ${((t1 - t0) / 1000).toFixed(1)} s`
      + ` + ${moon.length} moon in ${((dt - (t1 - t0)) / 1000).toFixed(1)} s = ${(dt / 1000).toFixed(1)} s`);
    expect(dt).toBeLessThan(120_000);
  }, 300_000);
});
