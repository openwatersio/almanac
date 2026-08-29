import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunEvents, moonEvents, searchMoonPhases, moonIllumination, AlmanacOutOfRangeError } from '../src/index.js';
import { refractionDeg, sunAltAz } from '../src/transforms.js';
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

// Two grid entries disagree with USNO by more than 60 s for a reason that is a
// convention mismatch, not an error in this layer: USNO computes sunrise/sunset
// from the Sun's *true* semidiameter at the date, while the spec's normative
// target folds in a fixed 16'. On 2026-05-14 the true semidiameter is 15.826',
// so USNO's effective target sits 10.5" above -0.8333 deg — invisible on a
// normal day, but that day at 70.5N the Sun grazes the target at 0.166"/s, so
// 10.5" is 63 s. They are asserted at the plan's tolerance in the `it.fails`
// case below and analysed in
// .superpowers/sdd/2026-08-28-almanac-v1/task-14-report.md. Nothing is skipped:
// removing that report's finding must turn the `it.fails` case into a failure.
const SOLAR_SEMIDIAMETER_DIVERGENT = new Set([
  'sun rise 2026-05-14 70.5',
  'sun set 2026-05-14 70.5',
]);

// Worst-case margin across the whole grid, printed so a regression that stays
// inside tolerance still shows up as a number moving.
let worstUsnoMs = 0;
let worstUsnoLabel = '';

function checkUsnoDay(row: UsnoRow, body: 'sun' | 'moon', crossings: readonly string[], includeDivergent = false) {
  const observer: Observer = { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, elevationM: 0 };
  const dayStart = new Date(`${row.date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + DAY);
  const found = body === 'sun'
    ? sunEvents(dayStart, dayEnd, observer)
    : moonEvents(dayStart, dayEnd, observer);
  const expected = row[body];

  for (const kind of crossings) {
    const mine = found.filter((e) => e.kind === kind);
    const label = `${body} ${kind} @ ${row.date} lat ${row.latitudeDeg}`;
    if (!includeDivergent && SOLAR_SEMIDIAMETER_DIVERGENT.has(`${body} ${kind} ${row.date} ${row.latitudeDeg}`)) continue;
    if (expected[kind] === undefined) {
      expect(mine.map((e) => e.time.toISOString()), `${label}: USNO reports none`).toEqual([]);
      continue;
    }
    expect(mine.length, `${label}: expected exactly one`).toBe(1);
    const want = new Date(`${row.date}T${expected[kind]}:00Z`).getTime();
    const diff = Math.abs(mine[0].time.getTime() - want);
    if (!includeDivergent && diff > worstUsnoMs) { worstUsnoMs = diff; worstUsnoLabel = label; }
    expect(diff / SEC, `${label}: ours ${mine[0].time.toISOString()} vs USNO ${expected[kind]}`).toBeLessThan(60);
  }
}

it('USNO grid: sun rise/set/civil twilight within 60 s', () => {
  for (const row of usnoGrid) checkUsnoDay(row, 'sun', USNO_SUN_CROSSINGS);
});

it('USNO grid: moonrise/moonset within 60 s', () => {
  for (const row of usnoGrid) checkUsnoDay(row, 'moon', USNO_MOON_CROSSINGS);
});

it.fails("BLOCKED: USNO's true solar semidiameter vs the spec's fixed 16' — 2026-05-14 graze at 70.5N", () => {
  checkUsnoDay(usnoGrid.find((r) => r.date === '2026-05-14' && r.latitudeDeg === 70.5)!, 'sun', ['rise', 'set'], true);
});

it('USNO grid: worst crossing margin', () => {
  console.log(`USNO worst crossing margin: ${(worstUsnoMs / SEC).toFixed(1)} s (${worstUsnoLabel})`);
  expect(worstUsnoMs / SEC).toBeLessThan(60);
});

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
  // The pair is found — which is the point of the extrema-bracketed search; a
  // fixed grid straddles all 14 minutes of it. Its width is 63 s narrower than
  // USNO's for the semidiameter reason above, so the times are asserted to the
  // minute-and-a-bit that convention difference allows, and to 60 s in the
  // `it.fails` case that owns the discrepancy.
  expect(Math.abs(set.time.getTime() - Date.parse('2026-05-14T08:00Z')) / SEC).toBeLessThan(90);
  expect(Math.abs(rise.time.getTime() - Date.parse('2026-05-14T08:16Z')) / SEC).toBeLessThan(90);
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

// A moon phase is a Terrestrial Time event reported in UT, so its UT label moves
// one-for-one with whatever DeltaT model produced it. The spec fixes DeltaT to
// Espenak-Meeus, whose far-future branch is the Morrison-Stephenson tidal
// parabola: 145.9 s at 2075 and 198.0 s at 2098, where USNO's projection of the
// recent (near-flat) trend is ~40 s and ~86 s lower. That is the entire
// disagreement on those two runs. The ephemeris is exonerated independently: the
// TT-labelled Horizons fixtures put this port's lunar and solar longitudes
// sub-arcsecond across the whole 1950-2100 interval, i.e. under 2 s of phase
// time. See task-14-report.md.
const DELTA_T_DIVERGENT_RUN_YEARS = [2075, 2098];
const runYear = (run: PhaseRow[]) => +run[0].utc.slice(0, 4);
const isDeltaTDivergent = (run: PhaseRow[]) => DELTA_T_DIVERGENT_RUN_YEARS.includes(runYear(run));

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
    if (isDeltaTDivergent(run)) continue;   // owned by the it.fails case below
    const r = checkPhaseRun(run, 60);
    if (Math.abs(r.worst) > Math.abs(worst)) { worst = r.worst; worstLabel = r.label; }
  }
  console.log(`USNO phases 1950-2050: worst ${worst.toFixed(1)} s (${worstLabel})`);
}, 60_000);

it.fails('BLOCKED: Espenak-Meeus DeltaT vs USNO past 2050 — the 2075 and 2098 phase runs', () => {
  for (const run of phaseRuns) if (isDeltaTDivergent(run)) checkPhaseRun(run, 60);
}, 60_000);

// What does hold on those runs: every phase in them sits within 60 s of USNO
// once the run's single DeltaT offset is removed, so the astronomy is intact and
// only the timescale projection differs.
it('far-future phase runs: scatter about the run offset is still inside 60 s', () => {
  for (const run of phaseRuns) {
    if (!isDeltaTDivergent(run)) continue;
    const start = new Date(Date.parse(run[0].utc) - 6 * 3600 * SEC);
    const end = new Date(Date.parse(run[run.length - 1].utc) + 6 * 3600 * SEC);
    const mine = searchMoonPhases(start, end);
    const diffs = run.map((r, i) => (mine[i].time.getTime() - Date.parse(r.utc)) / SEC).sort((a, b) => a - b);
    const median = diffs[diffs.length >> 1];
    const scatter = Math.max(...diffs.map((d) => Math.abs(d - median)));
    console.log(`USNO phases ${runYear(run)}: DeltaT offset ${median.toFixed(1)} s, scatter ${scatter.toFixed(1)} s`);
    expect(scatter, `scatter in the ${runYear(run)} run`).toBeLessThan(60);
  }
}, 60_000);

it('searched quarters are self-consistent with illumination', () => {
  const found = searchMoonPhases(new Date('2026-01-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'));
  const first = found.find((e) => e.phase === 'firstQuarter')!;
  const last = found.find((e) => e.phase === 'lastQuarter')!;
  // moonIllumination's phase is the geometric elongation (upstream
  // PairLongitude), the search's is the apparent one — 20.5" apart, 1.6e-5 of a
  // cycle, which is why these bounds are 5e-4 rather than exact.
  const fq = moonIllumination(first.time);
  expect(Math.abs(fq.phase - 0.25)).toBeLessThan(5e-4);
  expect(fq.waxing).toBe(true);
  const lq = moonIllumination(last.time);
  expect(Math.abs(lq.phase - 0.75)).toBeLessThan(5e-4);
  expect(lq.waxing).toBe(false);
});

// --------------------------------------------------- latitude sweep residual

// No fixture reaches the latitudes where the daily cycle flattens and the
// altitude extremum drifts hours off transit (the offset scales as 1/cos, so
// the search widens its bracket at |lat| >= 89). The invariant that holds
// everywhere: at a reported rise or set the Sun's unrefracted centre altitude
// is exactly the target, which the public refracted alt/az reports as
// -0.8333 + refraction(-0.8333). The residual is normalised by the local
// altitude rate so the assertion is the algorithm's own contract — the root is
// solved to under a second — at every latitude, from 15 deg/h at the equator to
// a near-standstill at the pole.
it('every sun rise/set sits on the target altitude, pole to equator', () => {
  const expected = -0.8333 + refractionDeg(-0.8333);
  let worst = 0;
  for (const latitudeDeg of [-89.5, -35, 0, 48.7621, 70.5, 89.5, 90]) {
    const observer: Observer = { latitudeDeg, longitudeDeg: -123.052, elevationM: 0 };
    const polar = Math.abs(latitudeDeg) >= 89;
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date(start.getTime() + (polar ? 366 : 40) * DAY);
    const events = sunEvents(start, end, observer);
    const crossings = events.filter((e) => e.kind === 'rise' || e.kind === 'set');
    expect(crossings.length, `lat ${latitudeDeg}: found a rise and a set`).toBeGreaterThan(1);
    for (const e of crossings) {
      const residual = Math.abs(sunAltAz(e.time, observer).altDeg - expected);
      const ratePerSec = Math.abs(sunAltAz(new Date(e.time.getTime() + 30 * SEC), observer).altDeg
        - sunAltAz(new Date(e.time.getTime() - 30 * SEC), observer).altDeg) / 60;
      const seconds = residual / ratePerSec;
      worst = Math.max(worst, seconds);
      expect(seconds, `lat ${latitudeDeg} ${e.kind} @ ${e.time.toISOString()}`).toBeLessThan(1);
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time.getTime(), `lat ${latitudeDeg}: sorted`).toBeGreaterThanOrEqual(events[i - 1].time.getTime());
    }
  }
  console.log(`rise/set target residual: worst ${worst.toFixed(3)} s of time`);
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
});
