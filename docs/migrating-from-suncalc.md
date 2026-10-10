# Migrating from SunCalc

Almanac covers everything [SunCalc](https://github.com/mourner/suncalc) computes, so a SunCalc call becomes one or two Almanac calls. The main changes: events come back as sorted lists for any time window you choose, instead of one object of named fields for one day, so your code decides which civil day it wants; places are an observer object, `{ latitudeDeg, longitudeDeg, elevationM? }`, instead of `lat, lng` arguments; every angle is in degrees and azimuth runs from north through east, as in SunCalc 2; every time is a UTC instant; and the supported interval is 1950 through 2100, where any instant outside it throws `AlmanacOutOfRangeError` (Swift `AlmanacError.outOfRange`). Almanac reports a missing event by leaving it out of the list, never as `null` or an invalid date.

This guide maps every SunCalc 2 export to its Almanac call, then gives drop-in adapters with the same shapes as `getTimes`, `getMoonPosition`, `getMoonIllumination`, and `getMoonTimes`. Every TypeScript and Swift example here runs in the test suite (`typescript/test/migration-guide.test.ts` and `swift/Tests/AlmanacTests/MigrationGuideTests.swift`), which checks the results against SunCalc 2.1.1 within the differences stated below.

## Mapping

| SunCalc 2 | Almanac | Difference |
| --- | --- | --- |
| `getPosition(date, lat, lng)` `.azimuth`, `.altitude` | `sunAltAz(date, observer)` `.azDeg`, `.altDeg` | Both refracted. Within 0.02° above a few degrees of altitude; the refraction models differ near and below the horizon, by up to about 0.2°. |
| `getTimes(…).sunrise`, `.sunset` | `sunEvents(start, end, observer, heightAboveGroundM)` kinds `rise`, `set` | Almanac uses the Sun's true semidiameter at its current distance, not SunCalc's fixed −0.833°, and solves each event from the Sun's position at that moment rather than at noon. Times differ by seconds. |
| `.sunriseEnd`, `.sunsetStart` | `sunAltitudeEvents(start, end, observer, -0.3)` kinds `rising`, `falling` | |
| `.dawn`, `.dusk` | `sunEvents` kinds `civilDawn`, `civilDusk`, or `sunAltitudeEvents(…, -6)` | The two give the same instants. |
| `.nauticalDawn`, `.nauticalDusk` | `sunEvents` kinds `nauticalDawn`, `nauticalDusk`, or `sunAltitudeEvents(…, -12)` | |
| `.nightEnd`, `.night` | `sunEvents` kinds `astroDawn`, `astroDusk`, or `sunAltitudeEvents(…, -18)` | |
| `.goldenHourEnd`, `.goldenHour` | `sunAltitudeEvents(…, 6)` kinds `rising`, `falling` | |
| `.solarNoon` | `sunTransits(start, end, observer)` kind `upper`, or `sunEvents` kind `transit` | The same instant from both. |
| `.nadir` | `sunTransits` kind `lower` | SunCalc puts nadir exactly 12 hours before solar noon; Almanac finds the lower transit itself, up to about 20 seconds away. |
| `.alwaysUp`, `.alwaysDown` | No `rise` or `set` in the day, then whether `sunAltAz` puts the Sun up at noon | See the `getTimes` adapter. |
| `getTimes(…, height)` | `elevationM` on the observer and `heightAboveGroundM` on `sunEvents`; add `horizonDip(observer, height)` to a `sunAltitudeEvents` angle | Almanac's dip includes the Earth's shape and terrestrial refraction. |
| `getTimes(…, utcOffset)`, `getMoonTimes(…, utcOffset)` | The window you pass: the civil day from local midnight to the next | See `civilDay` below. |
| `getTimes(…)`, `getMoonTimes(…)` with no `utcOffset` | The solar day around `date`, from one lower transit of the Sun to the next | See `solarDay` below. SunCalc runs this day from exactly 12 hours before solar noon, so its edges can differ by seconds. |
| `times`, `addTime(angle, riseName, setName)` | `sunAltitudeEvents(start, end, observer, angle)` | Angles mean the same thing in both, the Sun's geometric center altitude without refraction. |
| `getMoonPosition(date, lat, lng)` `.azimuth`, `.altitude` | `moonAltAz(date, observer)` `.azDeg`, `.altDeg` | Both topocentric and refracted. SunCalc applies parallax to altitude only. |
| `.distance` | `moonPosition(date).distanceKm` | Both are Earth center to Moon center, in kilometers, within about 20 km of each other. |
| `.parallacticAngle` | `moonOrientation(date, observer).parallacticAngleDeg` | Almanac uses the topocentric Moon; SunCalc the geocentric, a difference of up to about 0.25°. |
| `getMoonIllumination(date)` `.fraction`, `.phase`, `.waxing` | `moonIllumination(date)` `.fraction`, `.phase`, `.waxing` | Same meanings. |
| `.angle` | `moonOrientation(date, observer).brightLimbAngleDeg` | Almanac needs an observer because it uses the topocentric Moon, which turns the angle by up to about 2° from SunCalc's geocentric value. Almanac's range is 0 to 360; SunCalc's is −180 to 180. |
| `getMoonTimes(…)` `.rise`, `.set` | `moonEvents(start, end, observer)` kinds `rise`, `set` | Both use the Moon's upper limb. Within a few seconds. |
| `.transit`, `.lowerTransit` | `moonTransits(start, end, observer)` kinds `upper`, `lower` | Almanac uses the topocentric hour angle. |
| `.alwaysUp`, `.alwaysDown` | No `rise` or `set` in the day, then whether `moonAltAz` puts the Moon up | See the `getMoonTimes` adapter. |

A day can hold two of an event. Near the poles the Sun can set and rise again minutes later, and Almanac returns both. The adapters below keep the first, as SunCalc's one-field-per-name shape does.

## SunCalc 1

SunCalc 1 returns angles in radians and measures azimuth from south through west. Convert its values before comparing them with Almanac's:

```js
// SunCalc 1 → SunCalc 2 / Almanac conventions
const azimuthDeg = (position.azimuth * 180 / Math.PI + 180) % 360;   // south-based radians → north-based degrees
const altitudeDeg = position.altitude * 180 / Math.PI;
const parallacticDeg = moonPosition.parallacticAngle * 180 / Math.PI;
const angleDeg = illumination.angle * 180 / Math.PI;
```

SunCalc 1's `getTimes(date, lat, lng)` has no `utcOffset` and always returns the solar day nearest `date`, which the adapter below reproduces when `utcOffset` is left out. Its `getMoonTimes(date, lat, lng, inUTC)` searches from local midnight of the computer running it, or from UTC midnight when `inUTC` is true. With Almanac, pass the window explicitly: `civilDay(date, 0)` reproduces `inUTC`, and `civilDay(date, -date.getTimezoneOffset())` the local day.

## Examples

Every TypeScript example uses these imports:

```ts
import {
  sunAltAz, sunEvents, sunAltitudeEvents, sunTransits, horizonDip,
  moonAltAz, moonPosition, moonIllumination, moonOrientation, moonEvents, moonTransits,
} from '@openwaters/almanac';
```

### Sun position

```js
// SunCalc
const { azimuth, altitude } = SunCalc.getPosition(date, lat, lng);
```

```ts
function getPosition(date: Date, lat: number, lng: number) {
  const { azDeg, altDeg } = sunAltAz(date, { latitudeDeg: lat, longitudeDeg: lng });
  return { azimuth: azDeg, altitude: altDeg };
}
```

```swift
func getPosition(_ date: Date, _ lat: Double, _ lng: Double) throws -> (azimuth: Double, altitude: Double) {
    let position = try sunAltAz(date, observer: Observer(latitudeDeg: lat, longitudeDeg: lng))
    return (position.azDeg, position.altDeg)
}
```

### Sun times for one civil day

SunCalc keeps its altitudes in `times`, and `addTime` appends to it. The same table drives the adapter; sunrise and sunset come from `sunEvents` instead, because Almanac's rise and set use the Sun's true size.

```js
// SunCalc
SunCalc.addTime(-4, 'blueHourEnd', 'blueHour');
const times = SunCalc.getTimes(date, lat, lng, 0, utcOffset);
```

```ts
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
```

The adapters search the same day SunCalc does. `civilDay` turns SunCalc's `utcOffset`, in minutes east of UTC, into the half-open window Almanac searches; with a time zone instead of a fixed offset, pass the offset in effect on that date. With no `utcOffset`, SunCalc uses the solar day around `date` instead, and `solarDay` finds it from the Sun's lower transits, so a call such as `getTimes(date, lat, lng)` returns the same day's events after migration.

```ts
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
```

The adapter returns the same field names as `getTimes`, `null` where the Sun does not reach an altitude, and `alwaysUp` or `alwaysDown` on a day with neither a sunrise nor a sunset.

```ts
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
```

Called after `addTime(-4, 'blueHourEnd', 'blueHour')`, `getTimes(new Date('2026-03-20T12:00:00Z'), 48.4284, -123.3656, 0, -420)` gives Victoria's equinox with `blueHourEnd` and `blueHour` beside SunCalc's names, every time within 10 seconds of SunCalc's and nadir within 20.

A single custom angle needs no table: `sunAltitudeEvents(start, end, observer, -4)` returns every crossing of −4° in the window, in order.

In Swift, the same day's sunrise, sunset, golden hour, and solar noon:

```swift
func sunTimes(_ day: (start: Date, end: Date), _ lat: Double, _ lng: Double) throws -> [String: Date] {
    let observer = try Observer(latitudeDeg: lat, longitudeDeg: lng)
    var result: [String: Date] = [:]
    let events = try sunEvents(from: day.start, to: day.end, observer: observer)
    result["sunrise"] = events.first { $0.kind == .rise }?.time
    result["sunset"] = events.first { $0.kind == .set }?.time
    let golden = try sunAltitudeEvents(from: day.start, to: day.end, observer: observer, altitudeDeg: 6)
    result["goldenHourEnd"] = golden.first { $0.kind == .rising }?.time
    result["goldenHour"] = golden.first { $0.kind == .falling }?.time
    result["solarNoon"] = try sunTransits(from: day.start, to: day.end, observer: observer).first { $0.kind == .upper }?.time
    return result
}
```

Its window comes from Swift versions of the same two day helpers:

```swift
/// The civil day containing `date` in a zone `utcOffset` minutes east of UTC, as a half-open window.
func civilDay(_ date: Date, _ utcOffset: Int) -> (start: Date, end: Date) {
    let offset = Double(utcOffset) * 60
    let start = ((date.timeIntervalSince1970 + offset) / 86400).rounded(.down) * 86400 - offset
    return (Date(timeIntervalSince1970: start), Date(timeIntervalSince1970: start + 86400))
}

/// SunCalc's day when `utcOffset` is omitted: from the lower transit before the solar noon nearest `date` to the one after it.
func solarDay(_ date: Date, _ observer: Observer) throws -> (start: Date, end: Date) {
    let transits = try sunTransits(from: date.addingTimeInterval(-1.5 * 86400), to: date.addingTimeInterval(1.5 * 86400), observer: observer)
    let noon = transits.filter { $0.kind == .upper }
        .min { abs($0.time.timeIntervalSince(date)) < abs($1.time.timeIntervalSince(date)) }!.time
    let lower = transits.filter { $0.kind == .lower }.map(\.time)
    return (lower.last { $0 < noon }!, lower.first { $0 > noon }!)
}
```

### Moon position, illumination, and phase name

```js
// SunCalc
const { azimuth, altitude, distance, parallacticAngle } = SunCalc.getMoonPosition(date, lat, lng);
const { fraction, phase, angle, waxing } = SunCalc.getMoonIllumination(date);
```

```ts
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
```

SunCalc gives `phase` from 0 to 1 and leaves naming it to you. Almanac's `phase` is the same number, so the usual eight names carry over:

```ts
const PHASE_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
] as const;

/** One of eight names, each centered on its phase: New Moon covers phases within 1/16 of 0. */
function phaseName(date: Date) {
  return PHASE_NAMES[Math.floor(moonIllumination(date).phase * 8 + 0.5) % 8];
}
```

For the exact instants of the four main phases, use `searchMoonPhases(start, end)`.

```swift
func moonState(_ date: Date, _ lat: Double, _ lng: Double) throws -> (altitude: Double, distance: Double, fraction: Double, angle: Double) {
    let observer = try Observer(latitudeDeg: lat, longitudeDeg: lng)
    let orientation = try moonOrientation(at: date, observer: observer)
    return (try moonAltAz(date, observer: observer).altDeg, try moonPosition(date).distanceKm,
            try moonIllumination(date).fraction, orientation.brightLimbAngleDeg)
}
```

### Drawing the Moon's bright limb

SunCalc's guidance is to subtract the parallactic angle from the bright-limb angle; the same subtraction works here, and gives the bright limb's direction from straight up, turning counterclockwise as the observer sees the sky.

```ts
/** The bright limb's angle from straight up, counterclockwise as the observer sees the sky, in degrees. */
function brightLimbFromZenith(date: Date, lat: number, lng: number) {
  const { brightLimbAngleDeg, parallacticAngleDeg } = moonOrientation(date, { latitudeDeg: lat, longitudeDeg: lng });
  return brightLimbAngleDeg - parallacticAngleDeg;
}
```

On a canvas, where a positive rotation turns clockwise, draw the lit side toward the top after `ctx.rotate(-brightLimbFromZenith(date, lat, lng) * Math.PI / 180)`, and use `moonIllumination(date).fraction` for how much of the disc is lit.

```swift
func brightLimbFromZenith(_ date: Date, _ lat: Double, _ lng: Double) throws -> Double {
    let orientation = try moonOrientation(at: date, observer: Observer(latitudeDeg: lat, longitudeDeg: lng))
    return orientation.brightLimbAngleDeg - orientation.parallacticAngleDeg
}
```

### Moon times for one civil day

```js
// SunCalc
const { rise, set, transit, lowerTransit, alwaysUp, alwaysDown } = SunCalc.getMoonTimes(date, lat, lng, utcOffset);
```

```ts
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
```

As with SunCalc, a field is absent when the day has no such event: the Moon's day is about 50 minutes longer than the Sun's, so about once a month a civil day has no moonrise, no moonset, or no transit.
