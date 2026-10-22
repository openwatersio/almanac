# Almanac

Offline sky engine for the Salish Sea and everywhere else: Sun, Moon, and planet positions, apparent horizon dip, rise, set, twilight, any Sun altitude, upper and lower transits, Moon phase and orientation, equinoxes and solstices, lunar perigee and apogee, the equation of time, planetary brightness, lunar and solar eclipses, fixed-star apparent places, altitude, and azimuth from catalog positions, and Greenwich sidereal time for sight reduction, computed from pure geometry with zero network and zero runtime data files.

Three implementations, one behavior:

- `swift/` — SwiftPM package `Almanac`
- `typescript/` — npm `@openwaters/almanac`
- `kotlin/` — Kotlin/JVM `io.openwaters.almanac`, source-consumed with Gradle
- `fixtures/` — the shared test corpus (JPL Horizons, USNO, Espenak) all three suites
  must pass; the contract that keeps the ports identical

Supported interval: 1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z; results outside it raise a typed error. All instants are UT1-accurate, while unknown future DUT1 is outside the civil-UTC accuracy promise. See the [public contract](docs/CONTRACT.md#time-and-supported-interval) for the time model.

- Contract: [`docs/CONTRACT.md`](docs/CONTRACT.md), including coordinates, public behavior, accuracy, and fixture evidence.
- Scope: [`docs/SCOPE.md`](docs/SCOPE.md), including supported behavior and deliberate boundaries.
- Development and releases: [`CONTRIBUTING.md`](CONTRIBUTING.md), including pinned tools and required checks.
- Landing page: [openwaters.io/sky](https://openwaters.io/sky), with the library running live in a browser.

Algorithms translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy)
(MIT, Don Cross) — see [NOTICE](NOTICE). MIT licensed.

## Performance

Almanac includes a shared performance harness for TypeScript and Swift: **34 workloads**
cover positions, a 228-hour sky track, short/year/polar event windows, full-range
moon phases, next/previous/range lunar, solar, and global solar eclipse searches,
including empty windows, solar obscuration over a 228-hour track, and the central
line of the 2024-04-08 eclipse, five-planet sky tracks, planetary rise/set, a
year of golden-hour crossings and Sun and Moon transits, and a 228-hour Moon
orientation track.

Event searches find altitude extrema with Brent's method and altitude crossings
with a cosine-seeded secant solver, each root proven inside a half-second
bracket, and the TypeScript Sun series evaluates its terms as straight-line
arithmetic. Median query time relative to v0.4.1:

| Workload | TypeScript: less time | Swift: less time |
| --- | ---: | ---: |
| Sun events / year | 73.4% | 62.8% |
| Moon events / year | 57.6% | 57.4% |
| Sun events / 228 hours | 73.4% | 61.9% |
| Moon events / 228 hours | 57.1% | 57.0% |
| Sun positions / 1,024 hours | 35.5% | — |
| Lunar eclipses / 1950–2100 | 24.6% | — |

Swift already evaluated the Sun series efficiently, so its gains are confined to
the searches. Each comparison builds both revisions with the same harness and toolchain, then takes seven interleaved process pairs with 300 ms warmup per process. Build and startup time are excluded. Timings vary by machine; the shared correctness fixtures and parity tolerances remain the accuracy gates.

Reproduce the comparison locally from the repository root with mise 2026.9.1 or newer after installing the configured Node and Swift versions in `mise.toml`:

```bash
mise install
mise exec -- npm ci --prefix typescript
mise exec -- node benchmarks/run.mjs --base v0.4.1 --skip '^(global|planets|suncalc)/'
```

The `--skip` pattern leaves out global eclipse, planetary, and SunCalc-parity workloads absent from that base. Use `--skip '^(solar|global|planets|suncalc)/'` when the base predates 0.4.0, which is when the solar eclipse workloads arrived. For a base that lacks only the SunCalc-parity APIs, use `--skip '^suncalc/'`.

CI runs the harness on code changes and fails on **median regressions over 20%**.
Results include timing tables, raw samples, checksums, and revision/toolchain
metadata. See [the harness guide](CONTRIBUTING.md#performance) for choosing a
baseline, running one port, and inspecting reports.

Event searches scale with window length. Run a full 151-year sweep in a worker or
background task; use shorter windows for interactive queries.

## Usage

Migration guides for [SunCalc](docs/migrating-from-suncalc.md), [Astronomy Engine](docs/migrating-from-astronomy-engine.md), and [Solar](docs/migrating-from-solar.md) include tested examples. The [library comparison](docs/comparison.md) explains the features and limits of each library.

Angles use degrees. All three ports provide `degreesToRadians(angle)` and `radiansToDegrees(angle)` for callers that use radians. These functions preserve sign and full turns without wrapping or changing the angle's origin; non-finite inputs and conversion overflow raise validation errors. Swift calls use `try`.

For an instantaneous day/night decision, `sunIsUp(time, observer, heightAboveGroundM = 0)` uses the same upper-limb convention as sunrise and sunset, including polar periods. See the [day/night recipe](docs/cookbook.md).

### JavaScript module loading

The npm package is ESM and has no separate CommonJS build. Use Node 22.12 or later for the Node examples; CI and release checks load the packed package on Node 22.12 and Node 24. Browser applications can import it through their ESM bundler.

In an ES module (`.mjs` or a package with `"type": "module"`):

```js
import { sunAltAz } from '@openwaters/almanac';
const observer = { latitudeDeg: 48.5, longitudeDeg: -123.0 };
console.log(sunAltAz(new Date(), observer));
```

A CommonJS application can keep synchronous initialization. [Node's `require(esm)` support](https://nodejs.org/docs/latest-v22.x/api/modules.html#loading-ecmascript-modules-using-require) is enabled without a flag from Node 22.12:

```js
const { sunAltAz } = require('@openwaters/almanac');
const observer = { latitudeDeg: 48.5, longitudeDeg: -123.0 };
console.log(sunAltAz(new Date(), observer));
```

CommonJS can also load ESM asynchronously if its initialization flow already supports it:

```js
async function initializeSky() {
  const { sunAltAz } = await import('@openwaters/almanac');
  return sunAltAz(new Date(), { latitudeDeg: 48.5, longitudeDeg: -123.0 });
}
```

### TypeScript

```bash
npm install @openwaters/almanac
```

```ts
import {
  nextLunarEclipse, lunarEclipseVisibility, nextSolarEclipse, solarObscuration, nextGlobalSolarEclipse, sunEvents, starAltAz,
  starPosition, greenwichSiderealTime,
  seasons, moonApsides, earthApsides, equationOfTime
} from '@openwaters/almanac';

const observer = { latitudeDeg: 48.5, longitudeDeg: -123.0 };

const eclipse = nextLunarEclipse(new Date());
const visibility = lunarEclipseVisibility(eclipse, observer);
console.log(eclipse.kind, eclipse.peak, visibility.visibleAtPeak);

const solar = nextSolarEclipse(new Date(), observer);
console.log(solar.kind, solar.peak, solar.obscuration, solar.sunAltDeg.peak);
console.log(solarObscuration(solar.peak, observer));   // fraction of the Sun's disc covered, 0 to 1

const anywhere = nextGlobalSolarEclipse(new Date());   // no observer: the next solar eclipse on Earth
console.log(anywhere.kind, anywhere.peak, anywhere.latitudeDeg, anywhere.longitudeDeg);   // where the shadow axis lands; null for a partial

const today = new Date();
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
for (const { kind, time } of sunEvents(today, tomorrow, observer)) {
  console.log(kind, time.toISOString());
}

// Betelgeuse from its J2000 catalog position: az/alt in degrees, refracted.
const { azDeg, altDeg } = starAltAz(88.792939, 7.407064, today, observer);

// Its apparent place and Greenwich hour angle for sight reduction, in degrees.
const place = starPosition(88.792939, 7.407064, today);
const ghaDeg = (greenwichSiderealTime(today) - place.raDeg + 360) % 360;

// The year's equinoxes and solstices, the Moon's perigees and apogees with
// distances, and the equation of time in minutes.
const year = new Date(today.getUTCFullYear() + 1, 0, 1);
for (const { kind, time } of seasons(today, year)) console.log(kind, time.toISOString());
for (const { kind, time, distanceKm } of moonApsides(today, year)) console.log(kind, time.toISOString(), distanceKm);
for (const { kind, time, distanceKm } of earthApsides(today, year)) console.log(kind, time.toISOString(), distanceKm);
console.log(equationOfTime(today));   // sundial minus clock, minutes
```

For an unobstructed sea horizon, supply eye height above the water separately from elevation above sea level. Body altitudes remain measured from the horizontal plane:

```ts
import { horizonDip, sunAltAz } from '@openwaters/almanac';
const eyeHeightM = 2;
const viewer = { latitudeDeg: 48.5, longitudeDeg: -123.0, elevationM: 2 };
const horizonAltDeg = horizonDip(viewer, eyeHeightM);
const sunAltitudeAboveHorizonDeg = sunAltAz(new Date(), viewer).altDeg - horizonAltDeg;
const crossings = sunEvents(today, tomorrow, viewer, eyeHeightM);
```

### Swift

Requires a Swift 6 or newer toolchain.

```swift
.package(url: "https://github.com/openwatersio/almanac.git", exact: "0.12.0")
```

```swift
import Almanac
import Foundation

let observer = try Observer(latitudeDeg: 48.5, longitudeDeg: -123.0)

let eclipse = try nextLunarEclipse(after: Date())
let visibility = try lunarEclipseVisibility(eclipse, observer: observer)
print(eclipse.kind, eclipse.peak, visibility.visibleAtPeak)

let solar = try nextSolarEclipse(after: Date(), observer: observer)
print(solar.kind, solar.peak, solar.obscuration, solar.sunAltDeg.peak)
print(try solarObscuration(at: solar.peak, observer: observer))   // fraction of the Sun's disc covered, 0 to 1

let anywhere = try nextGlobalSolarEclipse(after: Date())   // no observer: the next solar eclipse on Earth
print(anywhere.kind, anywhere.peak, anywhere.axisDistanceKm)
if let lat = anywhere.latitudeDeg, let lon = anywhere.longitudeDeg {
  print(lat, lon)   // where the shadow axis lands; nil for a partial
}

let today = Date()
let tomorrow = today.addingTimeInterval(24 * 60 * 60)
for event in try sunEvents(from: today, to: tomorrow, observer: observer) {
  print(event.kind, event.time)
}

// Betelgeuse from its J2000 catalog position: az/alt in degrees, refracted.
let star = try starAltAz(raDeg: 88.792939, decDeg: 7.407064, at: today, observer: observer)

// Its apparent place and Greenwich hour angle for sight reduction, in degrees.
let place = try starPosition(raDeg: 88.792939, decDeg: 7.407064, at: today)
let ghaDeg = (try greenwichSiderealTime(today) - place.raDeg + 360).truncatingRemainder(dividingBy: 360)

// The year's equinoxes and solstices, the Moon's perigees and apogees with
// distances, and the equation of time in minutes.
let year = today.addingTimeInterval(366 * 24 * 60 * 60)
for event in try seasons(from: today, to: year) { print(event.kind, event.time) }
for apsis in try moonApsides(from: today, to: year) { print(apsis.kind, apsis.time, apsis.distanceKm) }
for apsis in try earthApsides(from: today, to: year) { print(apsis.kind, apsis.time, apsis.distanceKm) }
print(try equationOfTime(today))   // sundial minus clock, minutes
```

### Kotlin/JVM and Android

The Kotlin library provides the same functions and result fields, using `java.time.Instant` and immutable data classes. It targets JVM 8 and Android minSdk 26, builds with JDK 17, and has no runtime dependencies beyond the Kotlin standard library and platform APIs. Maven publication and a Kotlin benchmark runner are deferred; consume the source at a reviewed Git SHA as described in [`kotlin/README.md`](kotlin/README.md).

```kotlin
import io.openwaters.almanac.*
import java.time.Instant

val observer = Observer(48.5, -123.0)
val today = Instant.now()
val tomorrow = today.plusSeconds(86400)
val events = sunEvents(today, tomorrow, observer)
val moon = moonIllumination(today)
val next = nextGlobalSolarEclipse(today)
val line = solarEclipseCentralLine(next.peak)
val minutes = equationOfTime(today)
```

### Golden hour, transits, and the Moon's tilt

`sunAltitudeEvents` finds the Sun's center crossing any altitude, with the twilight convention, so `6` gives golden hour and `-6` civil twilight. `sunTransits` and `moonTransits` give each body's highest (`upper`) and lowest (`lower`) meridian crossings. `moonOrientation` turns the Moon's disc: subtracting the parallactic angle from the bright-limb angle gives the bright limb's direction from the zenith.

```ts
import { sunAltitudeEvents, sunTransits, moonTransits, moonOrientation } from '@openwaters/almanac';
const golden = sunAltitudeEvents(today, tomorrow, observer, 6);       // 'rising' ends morning golden hour, 'falling' starts the evening one
const solarMidnight = sunTransits(today, tomorrow, observer).find(e => e.kind === 'lower');
const moonHighest = moonTransits(today, tomorrow, observer).find(e => e.kind === 'upper');
const { brightLimbAngleDeg, parallacticAngleDeg } = moonOrientation(today, observer);
const brightLimbFromZenithDeg = brightLimbAngleDeg - parallacticAngleDeg;
```

```swift
let golden = try sunAltitudeEvents(from: today, to: tomorrow, observer: observer, altitudeDeg: 6)
let solarMidnight = try sunTransits(from: today, to: tomorrow, observer: observer).first { $0.kind == .lower }
let moonHighest = try moonTransits(from: today, to: tomorrow, observer: observer).first { $0.kind == .upper }
let orientation = try moonOrientation(at: today, observer: observer)
let brightLimbFromZenithDeg = orientation.brightLimbAngleDeg - orientation.parallacticAngleDeg
```

### Planetary views

Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune have geometric Sun-centered positions in AU, in fixed J2000 equatorial coordinates. Place the Sun at `(0, 0, 0)` and orient the scene's camera for the desired view:

```ts
import { planetHeliocentricPosition, planetAltAz, planetIllumination, planetEvents,
  horizonDip, sunAltAz } from '@openwaters/almanac';
import type { Planet } from '@openwaters/almanac';

const planets: Planet[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const now = new Date();
const positions = planets.map(planet => ({ planet, ...planetHeliocentricPosition(planet, now) }));

const viewer = { latitudeDeg: 48.5, longitudeDeg: -123.0, elevationM: 2 };
const horizonAltDeg = horizonDip(viewer, 2);
const venus = planetAltAz('venus', now, viewer);
const brightness = planetIllumination('venus', now);
console.log(venus.azDeg, venus.altDeg - horizonAltDeg, sunAltAz(now, viewer).altDeg,
  brightness.magnitude, brightness.elongationDeg);
const crossings = planetEvents('venus', now, new Date(now.getTime() + 86400000), viewer, 2);
```

```swift
let now = Date()
let positions = try Planet.allCases.map { try planetHeliocentricPosition($0, at: now) }
let viewer = try Observer(latitudeDeg: 48.5, longitudeDeg: -123.0, elevationM: 2)
let horizon = try horizonDip(observer: viewer, heightAboveGroundM: 2)
let venus = try planetAltAz(.venus, at: now, observer: viewer)
let brightness = try planetIllumination(.venus, at: now)
print(venus.azDeg, venus.altDeg - horizon, brightness.magnitude, brightness.elongationDeg)
let crossings = try planetEvents(.venus, from: now, to: now.addingTimeInterval(86400),
  observer: viewer, heightAboveGroundM: 2)
```

Earth is included for the solar-system view. Earth-based position, altitude/azimuth, illumination, and rise/set reject Earth. Sky coordinates include light-time and apparent corrections; heliocentric scene coordinates do not.

A viewing-window policy can combine planet altitude above the horizon, Sun altitude, elongation, and brightness. Actual visibility also depends on weather and observing conditions. Magnitude is approximate: the pinned model and Horizons differ by up to 0.75 magnitudes for extreme Venus crescents in the fixture interval.

### Eclipse searches

Search for a previous eclipse or all eclipses in a time window:

```ts
import { previousLunarEclipse, lunarEclipses } from '@openwaters/almanac';
const last = previousLunarEclipse(new Date());
const eclipses = lunarEclipses(new Date('2026-08-24T00:00:00Z'), new Date('2026-09-02T12:00:00Z'));
```

```swift
let last = try previousLunarEclipse(before: Date())
let eclipses = try lunarEclipses(from: today, to: tomorrow)
```

Ranges include peaks at the start and exclude peaks at the end. Contacts may
extend outside the range. Previous/next searches skip peaks within 100 ms of the
anchor. Search results are global; apply `lunarEclipseVisibility` for an observer.

Solar eclipses are searched for an observer, because their contacts only exist for a place: `nextSolarEclipse(after, observer)`, `previousSolarEclipse(before, observer)`, and `solarEclipses(startUtc, endUtc, observer)`. An eclipse whose Sun is below the horizon at C1, the peak, and C4 is not returned.

To ask about the whole Earth instead, `nextGlobalSolarEclipse(after)`, `previousGlobalSolarEclipse(before)`, and `globalSolarEclipses(startUtc, endUtc)` need no observer. Each eclipse reports its greatest eclipse, the shadow axis's distance from the Earth's center, and where the axis meets the ground, with the kind and obscuration seen there. When the axis misses the Earth the eclipse is partial and has no ground point, and greatest eclipse falls on the Earth's limb nearest the axis, with the Sun on the horizon: `greatestLatitudeDeg`, `greatestLongitudeDeg`, and `greatestObscuration` give that place for every eclipse.

`solarEclipseCentralLine(peak, stepSeconds)` samples where the axis meets the ground from its first contact to its last, and `solarEclipseAxisPoint(time)` gives that point at any instant. How far the next totality passes from a place is a distance to each point of a line:

```ts
import { nextGlobalSolarEclipse, solarEclipseCentralLine } from '@openwaters/almanac';
let next = nextGlobalSolarEclipse(new Date());
while (next.kind !== 'total') next = nextGlobalSolarEclipse(next.peak);
const line = solarEclipseCentralLine(next.peak);   // every whole minute of the path, and its two ends
```

```swift
var next = try nextGlobalSolarEclipse(after: Date())
while next.kind != .total { next = try nextGlobalSolarEclipse(after: next.peak) }
let line = try solarEclipseCentralLine(peak: next.peak)   // every whole minute of the path, and its two ends
```

Points are a median 47 km apart at the default step but hundreds apart beside an end, where the shadow races along the horizon; pass a smaller `stepSeconds` for a finer line.
