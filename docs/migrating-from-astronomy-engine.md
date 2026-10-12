# Migrating from Astronomy Engine

Almanac translates the astronomy models it uses from [Astronomy Engine](https://github.com/cosinekitty/astronomy) at a pinned commit. It exposes task-level calls with matching TypeScript and Swift behavior: observer positions, altitude crossings, phases, and eclipses. Its supported interval is `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Astronomy Engine accepts dates outside that interval and has features outside Almanac's scope; check the [comparison](comparison.md#astronomy-engine) before replacing a dependency.

The examples below run in `typescript/test/astronomy-engine-migration.test.ts` and `swift/Tests/AlmanacTests/AstronomyEngineMigrationTests.swift`. Position and Moon-state examples are checked against pinned Astronomy Engine 2.1.19 references. Search and visibility examples use known event dates already covered by Almanac's external fixtures.

## Coordinates, observers, and time

Replace `new Astronomy.Observer(lat, lon, elevation)` with `{ latitudeDeg: lat, longitudeDeg: lon, elevationM: elevation }` in TypeScript or `try Observer(latitudeDeg:longitudeDeg:elevationM:)` in Swift. Latitude is north-positive and longitude east-positive in both libraries.

Pass JavaScript or Foundation `Date` values directly. Almanac returns `Date` values rather than Astronomy Engine's `AstroTime` with a `.date` member. Angles are degrees, azimuth is measured from north through east, and right ascension is degrees rather than Astronomy Engine's hours. Multiply a right ascension in hours by 15 when comparing it with `raDeg`.

Observer elevation affects parallax; eye height above an unobstructed surface is a separate input to rise/set and eclipse visibility. At sea, a viewer two meters above the water typically has both `elevationM: 2` and `heightAboveGroundM: 2`. See [horizon conventions](CONTRACT.md#coordinates-and-physical-conventions).

Almanac uses lowercase planet identifiers in TypeScript and Swift enum cases such as `.venus`. The Sun and Moon have their own functions. Earth is accepted for `planetHeliocentricPosition` and rejected by Earth-based planetary position, illumination, and event calls.

## Mapping

| Astronomy Engine | Almanac | Difference |
| --- | --- | --- |
| `Horizon(time, observer, Equator(body, time, observer, true, true).ra, …dec, 'normal')` | `sunAltAz`, `moonAltAz`, or `planetAltAz` | One refracted topocentric call returns `azDeg`, `altDeg`. |
| `SearchRiseSet(body, observer, direction, start, limitDays, height)` | `sunEvents`, `moonEvents`, or `planetEvents` over an explicit window; select `rise` or `set` | Every crossing is returned, sorted. No matching crossing is an absent event, not a null search result. |
| `SearchAltitude(Body.Sun, observer, direction, start, limitDays, angle)` | `sunAltitudeEvents(start, end, observer, angle)` | Kinds are `rising` and `falling`. The altitude is the Sun's unrefracted geometric center. |
| Sun twilight searches at −6°, −12°, −18° | `sunEvents` kinds `civilDawn` / `civilDusk`, `nauticalDawn` / `nauticalDusk`, `astroDawn` / `astroDusk` | Query the window once instead of searching each crossing separately. |
| `SearchHourAngle(body, observer, 0 or 12, start)` | `sunTransits` or `moonTransits` kinds `upper`, `lower` | Arbitrary hour angles and planetary transits are outside this API. |
| `MoonPhase(time)` | `moonIllumination(time).phase * 360` | Phase cycle: 0° new, 90° first quarter, 180° full, 270° last quarter. Almanac uses apparent ecliptic longitudes. |
| `Illumination(Body.Moon, time).phase_fraction` | `moonIllumination(time).fraction` | Use the illuminated fraction directly. |
| `Elongation(planet, time).elongation` | `planetIllumination(planet, time).elongationDeg` | Apparent geocentric angular separation from the Sun. |
| `SearchMoonPhase` / `SearchMoonQuarter` / `NextMoonQuarter` | `searchMoonPhases(start, end)` | Returns the new, first-quarter, full, and last-quarter instants in the window; arbitrary phase targets are outside this API. |
| `SearchLunarEclipse` / `NextLunarEclipse` | `nextLunarEclipse`, `previousLunarEclipse`, `lunarEclipses` | Contacts are explicit dates; apply `lunarEclipseVisibility` for an observer. |
| `SearchLocalSolarEclipse` / `NextLocalSolarEclipse` | `nextSolarEclipse`, `previousSolarEclipse`, `solarEclipses` | Observer-bound contacts and peak obscuration; the horizon filter applies before results are returned. |
| `SearchGlobalSolarEclipse` / `NextGlobalSolarEclipse` | `nextGlobalSolarEclipse`, `previousGlobalSolarEclipse`, `globalSolarEclipses` | Global peak and the place of greatest eclipse; no observer required. |

Rise and set use the Sun's true semidiameter and the supplied horizon dip. Twilights use fixed geometric center altitudes and do not move with eye height. Horizontal positions remain measured from the horizontal plane, so an altitude above the visible sea horizon is `altDeg - horizonDip(observer, eyeHeightM)`.

## Position and Moon-state examples

TypeScript imports for these examples:

```ts
import {
  sunAltAz, moonAltAz, planetAltAz, moonIllumination,
  sunEvents, moonEvents, searchMoonPhases, lunarEclipses, lunarEclipseVisibility,
  type Observer,
} from '@openwaters/almanac';
```

Swift imports:

```swift
import Almanac
import Foundation
```

```ts
function briefingPositions(time: Date, observer: Observer) {
  return {
    sun: sunAltAz(time, observer),
    moon: moonAltAz(time, observer),
    venus: planetAltAz('venus', time, observer),
  };
}

function briefingMoon(time: Date) {
  const { phase, fraction } = moonIllumination(time);
  return { phaseDeg: phase * 360, fraction };
}
```

```swift
func briefingPositions(_ time: Date, _ observer: Observer) throws -> (sun: AltAz, moon: AltAz, venus: AltAz) {
    (try sunAltAz(time, observer: observer), try moonAltAz(time, observer: observer),
     try planetAltAz(.venus, at: time, observer: observer))
}

func briefingMoon(_ time: Date) throws -> (phaseDeg: Double, fraction: Double) {
    let illumination = try moonIllumination(time)
    return (illumination.phase * 360, illumination.fraction)
}
```

`briefingMoon` preserves a UI's 0° to 360° phase cycle and supplies the actual illuminated fraction. Do not substitute `phaseAngleDeg`: it is 0° at full Moon and 180° at new Moon, and it does not distinguish waxing from waning. A cosine approximation from the phase cycle is unnecessary when `fraction` is available.

The position example preserves Astronomy Engine's `'normal'` refraction choice. Almanac's public altitude/azimuth calls always use that convention; they do not provide the unrefracted output requested by Astronomy Engine's `Horizon(…, '')`.

### Angular separation

`AngleBetween(Equator(bodyA, …).vec, Equator(bodyB, …).vec)` measures separation between unrefracted equatorial directions. Computing a separation from Almanac's refracted altitudes and azimuths changes that measurement, especially near the horizon.

For a planet's separation from the Sun, use `planetIllumination(planet, time).elongationDeg` if geocentric apparent separation suits the application. `sunPosition`, `moonPosition`, and `planetPosition` expose apparent geocentric right ascension and declination, not observer-specific equatorial vectors. Almanac has no direct public replacement for arbitrary unrefracted topocentric vector separation; applications that require that behavior still need an API that supplies it.

## Searches over a passage

A search window is an explicit duration or calendar interval. A 1.5-day Astronomy Engine limit becomes a window spanning 36 elapsed hours in the intended search direction. Polar regions can have no matching crossing within that limit. A civil day needs the observer's time zone and actual local midnight-to-midnight bounds, which can span 23 or 25 hours.

Compute the lists once and reuse them:

```ts
function passageCrossings(start: Date, end: Date, observer: Observer) {
  return {
    sun: sunEvents(start, end, observer),
    moon: moonEvents(start, end, observer),
    phases: searchMoonPhases(start, end),
  };
}
```

```swift
func passageCrossings(_ start: Date, _ end: Date, _ observer: Observer) throws -> (sun: [SunEvent], moon: [MoonEvent], phases: [MoonPhaseEvent]) {
    (try sunEvents(from: start, to: end, observer: observer),
     try moonEvents(from: start, to: end, observer: observer),
     try searchMoonPhases(from: start, to: end))
}
```

The lists are sorted and include events at `start` while excluding events at `end`. Select the first matching kind strictly after an anchor for a next-event query, or the last matching kind at or before it for an inclusive previous-event query. The query must extend past an anchor you intend to include. See the [bounded selection and night-window recipes](migrating-from-suncalc.md#selecting-events-in-a-bounded-window).

A night can lack astronomical dusk while retaining nautical or civil twilight. Keep each crossing independently and pair evening bounds with the following morning. The list format needs no arbitrary two-minute gap between twilight kinds.

## Eclipse visibility

Lunar eclipse searches are global. Filter them for the observer when the Moon needs to be above the horizon at the peak:

```ts
function visibleLunarEclipses(start: Date, end: Date, observer: Observer) {
  return lunarEclipses(start, end).filter(eclipse => lunarEclipseVisibility(eclipse, observer).visibleAtPeak);
}
```

```swift
func visibleLunarEclipses(_ start: Date, _ end: Date, _ observer: Observer) throws -> [LunarEclipse] {
    try lunarEclipses(from: start, to: end).filter { try lunarEclipseVisibility($0, observer: observer).visibleAtPeak }
}
```

`visibleAtPeak` is geometric visibility of the Moon's center; `contactsVisible` reports the individual contacts. It does not account for clouds or terrain. A briefing's cloud-cover and darkness requirements remain application policy.

`solarEclipses(start, end, observer)` omits an eclipse only when the Sun is below the supplied horizon at C1, peak, and C4. It can return an eclipse whose peak is below the horizon but whose beginning or end is visible. Apply `sunAltDeg.peak` if the application specifically requires visibility at peak, comparing it with the horizon dip when eye height is supplied. A peak-only filter discards useful partial visibility, so choose it deliberately.

Window membership is based on the eclipse peak; contacts may fall outside the window. Next and previous eclipse searches skip peaks within 100 milliseconds of the anchor, while range searches use exact half-open bounds. Contacts in Almanac's records have different shapes from Astronomy Engine's duration fields; map the fields your application consumes explicitly. See [the contract](CONTRACT.md#public-api) for their presence rules.

## Errors and loading

A missing crossing is a valid result. An unsupported date throws `AlmanacOutOfRangeError` in TypeScript or `AlmanacError.outOfRange` in Swift, and invalid arguments raise validation errors. Catch only the outcomes your application intentionally degrades; the [typed fallback example](migrating-from-suncalc.md#missing-events-and-errors) preserves other failures.

The npm package is ESM. A CommonJS plugin can use synchronous `require('@openwaters/almanac')` on the documented Node versions, or initialize through asynchronous `import()`. See [module loading](../README.md#javascript-module-loading).
