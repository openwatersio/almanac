// Runs every TypeScript example in docs/migrating-from-suncalc.md. The guide's
// `ts` blocks appear in this file verbatim (the first test checks that), with
// the package import pointing at the source tree.
//
// The expected values come from SunCalc 2.1.1 (npm `suncalc`), run once with
// `addTime(-4, 'blueHourEnd', 'blueHour')` and these inputs, each with its
// utcOffset and with it omitted; SunCalc is not a dependency of this repository.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  sunAltAz, sunEvents, sunAltitudeEvents, sunTransits, horizonDip,
  moonAltAz, moonPosition, moonIllumination, moonOrientation, moonEvents, moonTransits,
  AlmanacOutOfRangeError,
  type SunEvent, type SunEventKind, type Observer,
} from '../src/index.js';

// --- guide examples ---------------------------------------------------------

function nauticalSunPosition(date: Date, lat: number, lng: number) {
  const { azDeg, altDeg } = sunAltAz(date, { latitudeDeg: lat, longitudeDeg: lng });
  const radians = Math.PI / 180;
  return { azimuth: ((azDeg + 180) % 360 - 180) * radians, altitude: altDeg * radians };
}

function nextSunEvent(events: SunEvent[], after: Date, kind: SunEventKind): Date | null {
  return events.find(e => e.kind === kind && e.time > after)?.time ?? null;
}

function lastSunEvent(events: SunEvent[], at: Date, kind: SunEventKind): Date | null {
  return events.findLast(e => e.kind === kind && e.time <= at)?.time ?? null;
}

function nightBounds(events: SunEvent[]) {
  const civilDusk = events.find(e => e.kind === 'civilDusk')?.time ?? null;
  const civilDawn = civilDusk
    ? events.find(e => e.kind === 'civilDawn' && e.time > civilDusk)?.time ?? null
    : null;
  return { civilDusk, civilDawn };
}

function sunEventsOrEmpty(start: Date, end: Date, observer: Observer): SunEvent[] {
  try {
    return sunEvents(start, end, observer);
  } catch (error) {
    if (error instanceof AlmanacOutOfRangeError) return [];
    throw error;
  }
}

function getPosition(date: Date, lat: number, lng: number) {
  const { azDeg, altDeg } = sunAltAz(date, { latitudeDeg: lat, longitudeDeg: lng });
  return { azimuth: azDeg, altitude: altDeg };
}

// SunCalc's table of [angle, morning name, evening name], without its -0.833° sunrise row.
// The angles are the Sun's geometric center altitude, which is what sunAltitudeEvents takes.
const times: [number, string, string][] = [
  [-0.3, 'sunriseEnd', 'sunsetStart'],
  [-6, 'dawn', 'dusk'],
  [-12, 'nauticalDawn', 'nauticalDusk'],
  [-18, 'nightEnd', 'night'],
  [6, 'goldenHourEnd', 'goldenHour'],
];

function addTime(angle: number, riseName: string, setName: string) {
  times.push([angle, riseName, setName]);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The civil day containing `date` in a zone `utcOffset` minutes east of UTC, as a half-open window. */
function civilDay(date: Date, utcOffset: number): [Date, Date] {
  const offsetMs = utcOffset * 60_000;
  const start = Math.floor((date.getTime() + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
  return [new Date(start), new Date(start + DAY_MS)];
}

/** SunCalc's day when `utcOffset` is omitted: from the lower transit before the solar noon nearest `date` to the one after it. */
function solarDay(date: Date, observer: { latitudeDeg: number; longitudeDeg: number }): [Date, Date] {
  const t = date.getTime();
  const transits = sunTransits(new Date(t - 1.5 * DAY_MS), new Date(t + 1.5 * DAY_MS), observer);
  const noon = transits
    .filter((e) => e.kind === 'upper')
    .sort((a, b) => Math.abs(a.time.getTime() - t) - Math.abs(b.time.getTime() - t))[0].time;
  const lower = transits.filter((e) => e.kind === 'lower').map((e) => e.time);
  return [lower.filter((d) => d < noon).at(-1)!, lower.find((d) => d > noon)!];
}

/** How far the Sun's center sits below its upper limb, for telling polar day from polar night. */
const SUN_SEMIDIAMETER_DEG = 0.27;

function getTimes(date: Date, lat: number, lng: number, height = 0, utcOffset?: number) {
  const observer = { latitudeDeg: lat, longitudeDeg: lng, elevationM: height };
  const dip = horizonDip(observer, height);
  const [start, end] = utcOffset === undefined ? solarDay(date, observer) : civilDay(date, utcOffset);
  const result: Record<string, Date | boolean | null> = {};

  const events = sunEvents(start, end, observer, height);
  result.sunrise = events.find((e) => e.kind === 'rise')?.time ?? null;
  result.sunset = events.find((e) => e.kind === 'set')?.time ?? null;
  for (const [angle, riseName, setName] of times) {
    const crossings = sunAltitudeEvents(start, end, observer, angle + dip);
    result[riseName] = crossings.find((e) => e.kind === 'rising')?.time ?? null;
    result[setName] = crossings.find((e) => e.kind === 'falling')?.time ?? null;
  }

  // Solar noon is the upper transit nearest the middle of the day; SunCalc's nadir is the lower transit before it.
  const middle = (start.getTime() + end.getTime()) / 2;
  const noon = sunTransits(new Date(middle - 13 * HOUR_MS), new Date(middle + 13 * HOUR_MS), observer)
    .filter((e) => e.kind === 'upper')
    .sort((a, b) => Math.abs(a.time.getTime() - middle) - Math.abs(b.time.getTime() - middle))[0].time;
  result.solarNoon = noon;
  result.nadir = sunTransits(new Date(noon.getTime() - 13 * HOUR_MS), noon, observer)
    .find((e) => e.kind === 'lower')!.time;

  if (result.sunrise === null && result.sunset === null) {
    // No rise or set all day, so the Sun stays on one side of the horizon: look at noon.
    const up = sunAltAz(noon, observer).altDeg + SUN_SEMIDIAMETER_DEG > dip;
    result.alwaysUp = up;
    result.alwaysDown = !up;
  }
  return result;
}

function getMoonPosition(date: Date, lat: number, lng: number) {
  const observer = { latitudeDeg: lat, longitudeDeg: lng };
  const { azDeg, altDeg } = moonAltAz(date, observer);
  return {
    azimuth: azDeg,
    altitude: altDeg,
    distance: moonPosition(date).distanceKm,
    parallacticAngle: moonOrientation(date, observer).parallacticAngleDeg,
  };
}

function getMoonIllumination(date: Date, lat: number, lng: number) {
  const { fraction, phase, waxing } = moonIllumination(date);
  const { brightLimbAngleDeg } = moonOrientation(date, { latitudeDeg: lat, longitudeDeg: lng });
  // SunCalc's angle runs from -180 to 180; Almanac's from 0 to 360.
  const angle = brightLimbAngleDeg > 180 ? brightLimbAngleDeg - 360 : brightLimbAngleDeg;
  return { fraction, phase, angle, waxing };
}

const PHASE_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
] as const;

/** One of eight names, each centered on its phase: New Moon covers phases within 1/16 of 0. */
function phaseName(date: Date) {
  return PHASE_NAMES[Math.floor(moonIllumination(date).phase * 8 + 0.5) % 8];
}

/** The bright limb's angle from straight up, counterclockwise as the observer sees the sky, in degrees. */
function brightLimbFromZenith(date: Date, lat: number, lng: number) {
  const { brightLimbAngleDeg, parallacticAngleDeg } = moonOrientation(date, { latitudeDeg: lat, longitudeDeg: lng });
  return brightLimbAngleDeg - parallacticAngleDeg;
}

/** How far the Moon's center sits below its upper limb, for telling a day above the horizon from one below. */
const MOON_SEMIDIAMETER_DEG = 0.26;

function getMoonTimes(date: Date, lat: number, lng: number, utcOffset?: number) {
  const observer = { latitudeDeg: lat, longitudeDeg: lng };
  const [start, end] = utcOffset === undefined ? solarDay(date, observer) : civilDay(date, utcOffset);
  const result: Record<string, Date | boolean> = {};

  const events = moonEvents(start, end, observer);
  const rise = events.find((e) => e.kind === 'rise');
  const set = events.find((e) => e.kind === 'set');
  if (rise) result.rise = rise.time;
  if (set) result.set = set.time;

  const transits = moonTransits(start, end, observer);
  const upper = transits.find((e) => e.kind === 'upper');
  const lower = transits.find((e) => e.kind === 'lower');
  if (upper) result.transit = upper.time;
  if (lower) result.lowerTransit = lower.time;

  if (!rise && !set) {
    // No rise or set all day, so the Moon stays on one side of the horizon: look at the start.
    const up = moonAltAz(start, observer).altDeg + MOON_SEMIDIAMETER_DEG > 0;
    result.alwaysUp = up;
    result.alwaysDown = !up;
  }
  return result;
}

// --- checks against SunCalc 2.1.1 -------------------------------------------

it('every ts block in the guide is in this file verbatim', () => {
  const guide = readFileSync(new URL('../../docs/migrating-from-suncalc.md', import.meta.url), 'utf8');
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const blocks = [...guide.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1].replace("'@openwaters/almanac'", "'../src/index.js'"));
  expect(blocks.length).toBeGreaterThan(5);
  for (const block of blocks) expect(source, block.slice(0, 80)).toContain(block);
});

addTime(-4, 'blueHourEnd', 'blueHour');

const PLACES = {
  victoria: { lat: 48.4284, lng: -123.3656, date: '2026-03-20T12:00:00Z', utcOffset: -420, at: '2026-03-20T20:00:00Z' },
  sydney: { lat: -33.8688, lng: 151.2093, date: '2026-12-21T00:00:00Z', utcOffset: 660, at: '2026-12-21T09:00:00Z' },
  tromsoSummer: { lat: 69.6492, lng: 18.9553, date: '2026-06-21T12:00:00Z', utcOffset: 120, at: '2026-06-21T10:00:00Z' },
  tromsoWinter: { lat: 69.6492, lng: 18.9553, date: '2026-12-21T12:00:00Z', utcOffset: 60, at: '2026-12-21T10:00:00Z' },
} as const;

const SUNCALC: Record<keyof typeof PLACES, any> = JSON.parse(readFileSync(new URL('./suncalc-2.1.1.json', import.meta.url), 'utf8'));

const signed180 = (deg: number) => { const x = ((deg % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

type Place = (typeof PLACES)[keyof typeof PLACES];
const places = Object.entries(PLACES) as [keyof typeof PLACES, Place][];
const seconds = (mine: unknown, theirs: string) => Math.abs(((mine as Date).getTime() - Date.parse(theirs)) / 1000);

// The documented differences: SunCalc solves every Sun time from the declination at
// solar noon and puts nadir exactly 12 hours before it, and it uses the geocentric Moon
// for the parallactic and bright-limb angles and its own refraction near the horizon.
// With utcOffset omitted SunCalc uses the solar day around `date` instead of a
// civil day, so each place is checked both ways.
const both = places.flatMap(([name, p]) => [
  { label: `${name} civil day`, p, utcOffset: p.utcOffset as number | undefined, times: SUNCALC[name].times, moonTimes: SUNCALC[name].moonTimes },
  { label: `${name} solar day`, p, utcOffset: undefined, times: SUNCALC[name].solarDayTimes, moonTimes: SUNCALC[name].solarDayMoonTimes },
]);

it('getTimes and addTime: the same names, within 10 s, nadir within 20 s', () => {
  for (const { label: name, p, utcOffset, times: theirs } of both) {
    const mine = getTimes(new Date(p.date), p.lat, p.lng, 0, utcOffset);
    expect(Object.keys(mine).sort(), name).toEqual(Object.keys(theirs).sort());
    for (const [key, value] of Object.entries(theirs)) {
      if (typeof value !== 'string') { expect(mine[key], `${name} ${key}`).toBe(value); continue; }
      expect(seconds(mine[key], value), `${name} ${key}`).toBeLessThan(key === 'nadir' ? 20 : 10);
    }
  }
});

it('getPosition and getMoonPosition: within 0.2°, distance within 20 km', () => {
  for (const [name, p] of places) {
    const at = new Date(p.at);
    const sun = getPosition(at, p.lat, p.lng);
    expect(Math.abs(signed180(sun.azimuth - SUNCALC[name].position.azimuth)), name).toBeLessThan(0.2);
    expect(Math.abs(sun.altitude - SUNCALC[name].position.altitude), name).toBeLessThan(0.2);
    const moon = getMoonPosition(at, p.lat, p.lng);
    const theirs = SUNCALC[name].moonPosition;
    expect(Math.abs(signed180(moon.azimuth - theirs.azimuth)), name).toBeLessThan(0.2);
    expect(Math.abs(moon.altitude - theirs.altitude), name).toBeLessThan(0.2);
    expect(Math.abs(moon.distance - theirs.distance), name).toBeLessThan(20);
    expect(Math.abs(signed180(moon.parallacticAngle - theirs.parallacticAngle)), name).toBeLessThan(0.25);
  }
});

it('getMoonIllumination, phase names, and the bright limb: angle within 2°', () => {
  const names = { victoria: 'Waxing Crescent', sydney: 'Waxing Gibbous', tromsoSummer: 'First Quarter', tromsoWinter: 'Waxing Gibbous' };
  for (const [name, p] of places) {
    const at = new Date(p.at);
    const mine = getMoonIllumination(at, p.lat, p.lng);
    const theirs = SUNCALC[name].moonIllumination;
    expect(Math.abs(mine.fraction - theirs.fraction), name).toBeLessThan(1e-3);
    expect(Math.abs(mine.phase - theirs.phase), name).toBeLessThan(1e-3);
    expect(mine.waxing, name).toBe(theirs.waxing);
    expect(Math.abs(signed180(mine.angle - theirs.angle)), name).toBeLessThan(2);
    expect(phaseName(at), name).toBe(names[name]);
    const tilt = theirs.angle - SUNCALC[name].moonPosition.parallacticAngle;
    expect(Math.abs(signed180(brightLimbFromZenith(at, p.lat, p.lng) - tilt)), name).toBeLessThan(2);
  }
});

it('getMoonTimes: rise and set within 5 s, transits within 2 s', () => {
  for (const { label: name, p, utcOffset, moonTimes: theirs } of both) {
    const mine = getMoonTimes(new Date(p.date), p.lat, p.lng, utcOffset);
    expect(Object.keys(mine).sort(), name).toEqual(Object.keys(theirs).sort());
    for (const [key, value] of Object.entries(theirs)) {
      if (typeof value !== 'string') { expect(mine[key], `${name} ${key}`).toBe(value); continue; }
      expect(seconds(mine[key], value), `${name} ${key}`).toBeLessThan(key.endsWith('ransit') ? 2 : 5);
    }
  }
});

const migrationReference = JSON.parse(readFileSync(new URL('./migration-references.json', import.meta.url), 'utf8'));
const helsinki = { latitudeDeg: 60.17, longitudeDeg: 24.94 };
const victoria = { latitudeDeg: 48.4284, longitudeDeg: -123.3656 };

it('the SunCalc 1 nautical adapter preserves north-based radians', () => {
  const ref = migrationReference.suncalc[0];
  const mine = nauticalSunPosition(new Date(ref.time), ref.latitudeDeg, ref.longitudeDeg);
  expect(mine.azimuth).toBeGreaterThan(-Math.PI);
  expect(mine.azimuth).toBeLessThan(Math.PI);
  expect(Math.abs(mine.azimuth - (ref.azimuth - Math.PI))).toBeLessThan(0.2 * Math.PI / 180);
  expect(Math.abs(mine.altitude - ref.altitude)).toBeLessThan(0.2 * Math.PI / 180);
});

it('the SunCalc 1 adapter exposes the refraction change near sunrise', () => {
  const ref = migrationReference.suncalc[1];
  expect(ref.altitude).toBeLessThan(0);
  expect(nauticalSunPosition(new Date(ref.time), ref.latitudeDeg, ref.longitudeDeg).altitude).toBeGreaterThan(0);
});

it('next is strict and last includes an event at the anchor in the computed list', () => {
  const events = sunEvents(new Date('2026-03-20T00:00:00Z'), new Date('2026-03-23T00:00:00Z'), victoria);
  const sunset = events.find(e => e.kind === 'set')!.time;
  expect(lastSunEvent(events, sunset, 'set')).toEqual(sunset);
  expect(nextSunEvent(events, sunset, 'set')!.toISOString()).toMatch(/^2026-03-21T/);
  expect(lastSunEvent(events, new Date('2026-03-20T00:00:00Z'), 'set')).toBeNull();
  expect(nextSunEvent(events, new Date('2026-03-23T00:00:00Z'), 'rise')).toBeNull();
});

it('the selection recipes cannot recover an event excluded by the window end', () => {
  const start = new Date('2026-03-20T00:00:00Z');
  const events = sunEvents(start, new Date('2026-03-21T00:00:00Z'), victoria);
  const sunset = events.find(e => e.kind === 'set')!.time;
  const excluded = sunEvents(start, sunset, victoria);
  expect(lastSunEvent(excluded, sunset, 'set')).toBeNull();
  expect(lastSunEvent(events, sunset, 'set')).toEqual(sunset);
});

it('night bounds pair dusk with the following dawn', () => {
  const events = sunEvents(new Date('2026-03-20T12:00:00Z'), new Date('2026-03-22T12:00:00Z'), victoria);
  const night = nightBounds(events);
  expect(night.civilDusk!.toISOString()).toMatch(/^2026-03-21T/);
  expect(night.civilDawn!.toISOString()).toMatch(/^2026-03-21T/);
  expect(+night.civilDawn!).toBeGreaterThan(+night.civilDusk!);
  expect(nightBounds([])).toEqual({ civilDusk: null, civilDawn: null });
});

it('getTimes keeps the surviving rise on a polar transition day', () => {
  const result = getTimes(new Date('2026-05-16T12:00:00Z'), 69.6492, 18.9553, 0, 120);
  expect((result.sunrise as Date).toISOString()).toMatch(/^2026-05-15T23:32:/);
  expect(result.sunset).toBeNull();
  expect(result.alwaysUp).toBeUndefined();
  expect(result.alwaysDown).toBeUndefined();
});

it('the optional range fallback preserves invalid input errors', () => {
  expect(sunEventsOrEmpty(new Date('1900-01-01'), new Date('1900-01-02'), helsinki)).toEqual([]);
  expect(() => sunEventsOrEmpty(new Date(NaN), new Date('2026-01-02'), helsinki)).toThrow(RangeError);
  expect(() => sunEventsOrEmpty(new Date('2026-01-01'), new Date('2026-01-02'), { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  expect(sunEventsOrEmpty(new Date('2026-06-21'), new Date('2026-06-22'), { latitudeDeg: 78.22, longitudeDeg: 15.63 }).filter(e => e.kind === 'rise' || e.kind === 'set')).toEqual([]);
});

it('explicit windows work at the supported edges while padded solar days can exceed them', () => {
  for (const [start, end] of [['1950-01-01', '1950-01-03'], ['2100-12-30', '2101-01-01']]) {
    const events = sunEventsOrEmpty(new Date(start), new Date(end), victoria);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => +e.time >= +new Date(start) && +e.time < +new Date(end))).toBe(true);
  }
  expect(() => solarDay(new Date('1950-01-01'), victoria)).toThrow(AlmanacOutOfRangeError);
  expect(() => solarDay(new Date('2100-12-31T12:00:00Z'), victoria)).toThrow(AlmanacOutOfRangeError);
});
