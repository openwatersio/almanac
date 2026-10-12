# How Almanac compares

Almanac is for apps that need Sun, Moon, planet, star, and eclipse answers offline, with the same results in TypeScript, Swift, and Kotlin. The Kotlin/JVM package is validated against the shared fixtures and consumed as a Gradle source dependency; see [Kotlin installation](../kotlin/README.md). It ships no runtime data files and calls no network service, and its test suite checks results against external evidence from JPL Horizons, USNO, NASA, and the Espenak catalogs across 1950–2100, the only dates it accepts. Other libraries win in several places. SunCalc is about a sixth of Almanac's minified and gzipped size, never refuses a date, and covers sunrise, twilight, and the Moon with typical rise and set errors of about 15 seconds, enough when you need nothing else. Astronomy Engine, which Almanac is translated from, runs in C, C#, Python, and Kotlin as well as JavaScript, adds Pluto, Jupiter's moons, planetary transits, constellations, and libration, and works for millennia either side of today. SwiftAA covers far more of Meeus's *Astronomical Algorithms* than anything else in Swift.

Each library below was checked at the version named in its column, on 2026-10-10. Projects move, so check a library's own documentation before relying on a row here.

## Feature matrix

| | Almanac 0.8.0 | SunCalc 2.1.1 | Astronomy Engine 2.1.19 | astronomia 4.2.0 | Solar 4.0.1 | SwiftAA 3.0.1 | EDSunriseSet 1.0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Languages | TypeScript, Swift, Kotlin/JVM (Android minSdk 26) | JavaScript | C, C#, JavaScript/TypeScript, Python, Kotlin | JavaScript | Swift (Apple platforms) | Swift over C++ (AA+) | Objective-C |
| Footprint | 21.9 KB whole package, 6.9 KB for `sunEvents` alone; Swift: 7,400 lines, no data | 3.8 KB whole, 2.2 KB for `getTimes` | 44.0 KB whole, 24.2 KB for rise/set and altitude search | 52.7 KB without planet data, 20.6 KB for sunrise; VSOP87 and ELP data add 2.5 MB | One 250-line file | About 430,000 lines, mostly series tables compiled in as C++ (31 MB of source) | About 500 lines |
| Date range | 1950–2100, enforced | No limit; its ΔT model is fitted for about 1900–2150 | No limit; "millennia before or after the present" | No stated limit | Not stated | Not stated; its ΔT table runs 1657–2033 | 1801–2099 |
| Sun position | ✓ | ✓ | ✓ | ✓ from building blocks | — | ✓ without refraction | — |
| Sunrise, sunset, twilights | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Any Sun altitude | ✓ | ✓ `addTime` | ✓ | ✓ | — | ✓ | — |
| Transits | Upper and lower, Sun and Moon | Solar noon, nadir, Moon upper and lower | Any hour angle, any body | ✓ | — | Upper | — |
| Moon position | ✓ | ✓ | ✓ | ✓ geocentric | — | ✓ | — |
| Moonrise and moonset | ✓ | ✓ | ✓ | Build from `rise.times` | — | ✓ | — |
| Moon phase and illumination | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| Moon orientation | Bright limb and parallactic angle | Bright limb and parallactic angle | — | Bright limb and parallactic angle | — | Bright limb and parallactic angle | — |
| Planets | Mercury to Neptune | — | Mercury to Pluto, Jupiter's moons | Mercury to Pluto, with data files | — | Mercury to Pluto, Jupiter's and Saturn's moons | — |
| Stars | From catalog coordinates you supply | — | Up to eight user-defined stars | From coordinates you supply | — | From coordinates you supply | — |
| Lunar eclipses | Search, contacts, local visibility | — | Search, peak, phase durations | Per lunation: kind, peak, magnitude, durations | — | Per lunation: kind, peak, magnitude, durations | — |
| Solar eclipses, local | ✓ contacts, Sun altitude, obscuration | — | ✓ contacts, Sun altitude, obscuration | — | — | — | — |
| Solar eclipses, global | ✓ greatest eclipse and its place | — | ✓ greatest eclipse and its place | Kind, peak, gamma, magnitude | — | Kind, peak, gamma, magnitude | — |
| Central line | ✓ | — | — | — | — | — | — |
| Horizon dip from eye height | Every rise/set and eclipse visibility, with terrestrial refraction | Every `getTimes` angle, twilights included; not Moon times | Rise and set | — | — | — | — |
| Licence | MIT | BSD-2-Clause | MIT | MIT | MIT | MIT, with AA+ under its own terms | MIT |
| Accuracy evidence | Horizons, USNO, Espenak, and NASA path tables with stated tolerances | Horizons and USNO, typical errors stated | NOVAS, Horizons, and cross-language checks | Meeus's worked examples | 237 cities on one date, within 5 minutes | Meeus, USNO, SkySafari, XEphem | None |
| Latest release | 2026-10-06 | 2026-10-05 | 2023-12-14 | 2025-08-30 | 2026-08-30 | 2025-11-06 tag | 2014-12-02; repository archived |

Footprints for npm packages are minified and gzipped bundles: each package installed in a scratch project, bundled with `esbuild --bundle --minify --format=esm --platform=neutral` (esbuild 0.25.10) from an entry that re-exports either the whole package or the named functions, and measured with `gzip -9`. The Swift and Objective-C footprints are source line counts, because a compiled size depends on the app and toolchain.

## JavaScript and TypeScript

### SunCalc

[SunCalc](https://github.com/mourner/suncalc) 2.1.1 (2026-10-05) computes Sun position, sunlight phases, Moon position, moonrise and moonset, and Moon illumination from Meeus's series, and states typical errors of about 0.08° for Sun position and about 15 seconds for rise and set against JPL Horizons and USNO. It is the smallest library here and accepts any date, but has no planets, stars, eclipses, or Swift version. The [SunCalc migration guide](migrating-from-suncalc.md) maps every SunCalc 2 call to Almanac and gives drop-in `getTimes` and `getMoonTimes` adapters.

### Astronomy Engine

[Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 (2023-12-14, latest commit 2025-01-27) by Don Cross is the library Almanac is translated from, at a pinned commit. It uses truncated VSOP87, NOVAS-derived reductions, and the Montenbruck–Pfleger Moon, is tested against NOVAS and JPL Horizons to within 1 arcminute, and checks its five language ports produce identical results. Its features reach well past Almanac's, and Almanac keeps its 1-arcminute accuracy for the parts it carries and adds a Swift port, a date range tested end to end, Moon orientation, solar eclipse central lines, and horizon dip for rise, set, and eclipse visibility. The [Astronomy Engine migration guide](migrating-from-astronomy-engine.md) covers position calls, bounded searches, Moon phase, and eclipse visibility, including the differences in refraction, right ascension units, and supported dates.

### astronomia

[astronomia](https://github.com/commenthol/astronomia) 4.2.0 (2025-08-30) is a JavaScript port of the Go `meeus` package, a translation of Meeus's *Astronomical Algorithms*. It exposes the book's chapters as modules, so most answers are assembled from building blocks, and its tests check the book's worked examples. Planet positions need the VSOP87 data modules, which are megabytes. Migration: `new Sunrise(calendar, lat, lon)` with its `rise()`, `set()`, `noon()`, `dawn()`, and `dusk()` becomes one `sunEvents` call; astronomia's longitude is positive west, Almanac's positive east.

## Swift

### Solar

[Solar](https://github.com/ceeK/Solar) 4.0.1 (2026-08-30) gives sunrise, sunset, and civil, nautical, and astronomical twilight for one day from the low-precision *Almanac for Computers* algorithm in a single file. Its tests compare 237 cities on one date within 5 minutes. It has no Sun position, Moon, or custom altitude. The [Solar migration guide](migrating-from-solar.md) maps each property to Almanac.

### SwiftAA

[SwiftAA](https://github.com/onekiloparsec/SwiftAA) 3.0.1 (tagged 2025-11-06) wraps P. J. Naughter's AA+ 2.63, a C++ implementation of Meeus's *Astronomical Algorithms* with full VSOP87 and ELP/MPP02, in a Swift API. It is the broadest library here and is tested against Meeus, USNO, SkySafari, and XEphem, but positions follow Meeus's conventions rather than ICRS, eclipses come from Meeus's per-lunation elements without local circumstances, and AA+ allows redistributing its source only as the author releases it. Migration: `RiseTransitSetTimes(celestialBody: Sun(julianDay:), geographicCoordinates:)` becomes `sunEvents(from:to:observer:)`, `Earth.twilights(forSunAltitude:coordinates:)` becomes `sunAltitudeEvents`, and `Moon.illuminatedFraction()` becomes `moonIllumination(_:)`; SwiftAA's longitude is positive west and takes a Julian day, Almanac's positive east and takes a `Date`.

### EDSunriseSet

[EDSunriseSet](https://github.com/erndev/EDSunriseSet) 1.0 (2014-12-02) is an Objective-C wrapper over Paul Schlyter's public-domain `sunriset.c`, giving sunrise, sunset, and the three twilights for 1801–2099. The repository is archived and has no tests. Migration: `sunrisesetWithDate:timezone:latitude:longitude:` and its `sunrise`, `sunset`, and twilight properties become one `sunEvents(from:to:observer:)` call over the local day.

## Kotlin and Android

Almanac provides all 38 functions as native Kotlin, with the same shared fixtures and parity tolerances as TypeScript and Swift. The source Gradle library targets JVM 8 and uses `java.time.Instant`; Android requires minSdk 26. See [Kotlin installation](../kotlin/README.md). Kotlin has no published Maven artifact or benchmark runner yet, and JVM verification does not establish Android device performance.
