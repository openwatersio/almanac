# Almanac contract

Almanac provides pure astronomy functions with matching behavior in TypeScript and Swift. It uses no network service or runtime data files. The two implementations share this contract and the fixture corpus; neither port defines behavior by itself.

## Models and architecture

The algorithms are translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross at pinned commit `865d3da7d8112bbc7911238052c6af4aaf877181`. Its lunar theory derives from Montenbruck and Pfleger's *Astronomy on the Personal Computer*, and its solar theory uses truncated VSOP87. The complete upstream MIT license is in [NOTICE](../NOTICE) and ships with both packages.

Maintaining the translation keeps both languages on the same contract, avoids giving one port a separate foreign API, and retains zero runtime dependencies and data files. The package carries only the models its public functions use.

Both ports implement four matching layers:

- Time: Julian date and Delta-T from the Espenak–Meeus piecewise polynomials.
- Positions: truncated VSOP87 for the Sun, Montenbruck–Pfleger MOON2 for the Moon, and truncated IAU 2000B nutation and aberration translated from upstream.
- Transforms: ecliptic and equatorial conversion on the equator of date, equatorial to horizontal conversion, topocentric parallax, precession for fixed-star catalog positions, and atmospheric refraction.
- Events: root finding over the position and transform layers for rise, set, twilight, transit, phase, lunar eclipse, and solar eclipse searches.

Event searches use the same position models returned by the position functions. Lunar eclipses are found from the Moon's distance to the Earth's shadow axis rather than from a separate precomputed eclipse series. Solar eclipses are found from an observer's distance to the Moon's shadow axis at each new moon, and global solar eclipses from the Earth's center's distance to the same axis, whose crossing of the ground between its first and last contact is the central line.

## Time and supported interval

API instants are JavaScript `Date` or Foundation `Date` values with millisecond precision. Civil timestamps are interpreted as UT1-like labels. During the leap-second era, the difference from UTC stays within 0.9 seconds. The package carries no leap-second or DUT1 table, so unknown future DUT1 is outside the civil-UTC accuracy promise; the calculations remain UT1-accurate.

Terrestrial Time is calculated as `TT = UT1 + Delta-T` using the Espenak–Meeus polynomials. Delta-T is projected beyond the present, while sources such as JPL Horizons may freeze or use another projection. Coarse position fixtures therefore compare the models in TT so the fixture checks astronomy rather than disagreement between time projections.

The supported interval is `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`, the intersection of the external fixture evidence. Inputs outside it return the typed out-of-range outcome. Widening the interval requires external boundary fixtures first.

## Coordinates and physical conventions

- Observers use WGS-84 geodetic coordinates. `latitudeDeg` is north-positive in `[-90, 90]`, `longitudeDeg` is east-positive in `[-180, 180]`, and `elevationM` defaults to zero with a valid range of `[-500, 10000]`. Elevation affects topocentric parallax; horizon dip is not modeled.
- Angles are degrees. Right ascension is in `[0, 360)`, declination and altitude are in `[-90, 90]`, and azimuth is in `[0, 360)` from true north through east.
- Geocentric Sun and Moon right ascension and declination are apparent coordinates on the true equator and equinox of date, with nutation and aberration applied. Internal ecliptic-of-date values are not part of the public API.
- Moon distance is in kilometers. Sun distance is in astronomical units.
- Horizontal positions use the translated Astronomy Engine `Refraction('normal')` formula with its below-horizon taper and a fixed sea-level standard atmosphere. The model has no pressure or temperature inputs and gives about 34 arcminutes of refraction at the horizon.
- `starAltAz` accepts J2000 ICRS catalog right ascension and declination, precesses and nutates them to date, and applies refraction. It does not apply annual aberration, proper motion, or parallax.
- Sunrise and sunset occur when the unrefracted geometric center crosses `-(34 arcminutes + the true solar semidiameter at the current distance)`. Civil, nautical, and astronomical twilight use center altitudes of `-6°`, `-12°`, and `-18°` without a refraction term.
- Moonrise and moonset occur when the apparent topocentric upper limb crosses altitude zero, including refraction, topocentric parallax, and the true semidiameter at the current distance.
- Moon phase events and `moonIllumination.phase` use apparent geocentric ecliptic longitudes, including aberration and nutation.
- Lunar eclipse visibility is geometric: the unrefracted topocentric altitude of the Moon's center must be above zero. It does not account for weather, terrain, refraction, or safe-viewing conditions.
- Solar eclipse circumstances are observer-bound. The peak is the closest approach of the Moon's shadow axis to the observer, not greatest eclipse. The Sun's altitude at each contact is the refracted topocentric value `sunAltAz` reports for that instant. An eclipse whose Sun is below the horizon at C1, the peak, and C4 is not returned. `solarObscuration` is purely geometric and does not test the horizon.
- Global solar eclipse circumstances need no observer. The peak is greatest eclipse, the closest approach of the Moon's shadow axis to the Earth's center and the instant the Espenak catalog tabulates. The ground point is where the axis first meets the WGS-84 ellipsoid at the peak, as geodetic latitude and east longitude in `(-180, 180]`, and the kind and obscuration are what an observer standing there sees. An axis that misses the Earth gives a partial eclipse with no ground point, even when part of the umbra reaches the surface. Greatest eclipse always has a place: the ground point when there is one, and otherwise the point on the Earth's limb nearest the axis, where the Sun's center is on the geometric horizon, with no refraction. The axis point is the same ground point at any instant, and the central line samples it from the axis's first ground contact to its last, where the axis grazes the Earth with the Sun on the horizon.

## Public API

The functions have the same names and semantics in both ports. TypeScript returns objects and Swift returns structs. All time arguments and results are UTC-shaped instants.

| Function | Arguments | Result |
| --- | --- | --- |
| `sunPosition(time)` | Instant | Geocentric apparent `raDeg`, `decDeg`, and `distanceAu` on the equator of date. |
| `moonPosition(time)` | Instant | Geocentric apparent `raDeg`, `decDeg`, and `distanceKm` on the equator of date. |
| `sunAltAz(time, observer)` | Instant and observer | Refracted topocentric `azDeg` and `altDeg`. |
| `moonAltAz(time, observer)` | Instant and observer | Refracted topocentric `azDeg` and `altDeg`, including parallax. |
| `starAltAz(raDeg, decDeg, time, observer)` | J2000 ICRS catalog coordinates, instant, and observer | Precessed, nutated, and refracted `azDeg` and `altDeg`; no annual aberration, proper motion, or parallax. |
| `moonIllumination(time)` | Instant | `fraction` in `[0, 1]`, `phaseAngleDeg` in `[0, 180]`, `phase` in `[0, 1)`, and `waxing`. Phase angle is zero at full Moon and 180 degrees at new Moon; phase is zero at new Moon and 0.5 at full Moon; `fraction = (1 + cos θ) / 2`. |
| `sunEvents(startUtc, endUtc, observer)` | Half-open window and observer | Sorted `{time, kind}` values where `kind` is `rise`, `set`, `civilDawn`, `civilDusk`, `nauticalDawn`, `nauticalDusk`, `astroDawn`, `astroDusk`, or `transit`. Polar windows may omit crossings; transit is still returned. |
| `moonEvents(startUtc, endUtc, observer)` | Half-open window and observer | Sorted `{time, kind}` values where `kind` is `rise` or `set`. |
| `searchMoonPhases(startUtc, endUtc)` | Half-open window | Sorted `{time, phase}` values where `phase` is `new`, `firstQuarter`, `full`, or `lastQuarter`. |
| `nextLunarEclipse(after)` | Instant | The lunar eclipse strictly after the anchor, or the out-of-range outcome. |
| `previousLunarEclipse(before)` | Instant | The lunar eclipse strictly before the anchor, or the out-of-range outcome. |
| `lunarEclipses(startUtc, endUtc)` | Half-open window | Every lunar eclipse whose peak is in the window, sorted by peak. Contacts may extend outside the window. |
| `lunarEclipseVisibility(eclipse, observer)` | Structurally valid lunar eclipse and observer | `visibleAtPeak`, unrefracted `moonGeometricAltAtPeakDeg`, and `contactsVisible`. |
| `nextSolarEclipse(after, observer)` | Instant and observer | The solar eclipse the observer can see strictly after the anchor, or the out-of-range outcome. |
| `previousSolarEclipse(before, observer)` | Instant and observer | The solar eclipse the observer can see strictly before the anchor, or the out-of-range outcome. |
| `solarEclipses(startUtc, endUtc, observer)` | Half-open window and observer | Every solar eclipse the observer can see whose peak is in the window, sorted by peak. Contacts may extend outside the window. |
| `solarObscuration(time, observer)` | Instant and observer | Fraction of the Sun's disc area the Moon covers, in `[0, 1]`. |
| `nextGlobalSolarEclipse(after)` | Instant | The solar eclipse anywhere on Earth strictly after the anchor, or the out-of-range outcome. |
| `previousGlobalSolarEclipse(before)` | Instant | The solar eclipse anywhere on Earth strictly before the anchor, or the out-of-range outcome. |
| `globalSolarEclipses(startUtc, endUtc)` | Half-open window | Every solar eclipse anywhere on Earth whose greatest eclipse is in the window, sorted by peak. |
| `solarEclipseAxisPoint(time)` | Instant | Where the Moon's shadow axis meets the ground, with the kind and obscuration there, or none when the axis misses the Earth. |
| `solarEclipseCentralLine(peak, stepSeconds)` | Instant inside a central eclipse, normally its greatest eclipse, and a whole-second step from 1 to 3600, 60 by default | The axis points from the first to the last ground contact, sorted by time; empty when the axis misses the Earth at the instant. |

A lunar eclipse has `kind`, `peak`, `magUmbral`, `magPenumbral`, `p1`, `u1`, `u2`, `u3`, `u4`, and `p4`. Kind is `penumbral`, `partial`, or `total`; P1 and P4 are always present, U1 and U4 are present for partial and total eclipses, and U2 and U3 are present only for total eclipses. `lunarEclipseVisibility` validates finite times, contact chronology, and agreement between the kind and contact shape.

A solar eclipse has `kind`, `obscuration`, `c1`, `c2`, `peak`, `c3`, `c4`, and `sunAltDeg`. Kind is `partial`, `annular`, or `total`; C1, peak, and C4 are always present, and C2 and C3 are present only for annular and total eclipses. `sunAltDeg` carries the Sun's altitude at each contact with the same presence pattern. `obscuration` is the fraction of the Sun's disc area covered at the peak, exactly 1 for a total eclipse.

A global solar eclipse has `kind`, `peak`, `axisDistanceKm`, `latitudeDeg`, `longitudeDeg`, and `obscuration`. Kind is the solar eclipse kind at the ground point, and `partial` when the shadow axis misses the Earth. `axisDistanceKm` is the distance from the axis to the Earth's center at the peak, the catalog's gamma in kilometers. The latitude, longitude, and obscuration are present exactly when the kind is `annular` or `total`, and `obscuration` is exactly 1 for a total eclipse. `greatestLatitudeDeg`, `greatestLongitudeDeg`, and `greatestObscuration` are present for every eclipse: they equal the ground point and its obscuration when there is one, and for a partial eclipse they are the point on the limb nearest the axis and the obscuration seen there. That obscuration is 1 when the point lies inside a total eclipse's grazing umbra, which happens for a non-central eclipse, and otherwise below 1. Hybrid is not a kind: the classification is for one point, and every hybrid path in the catalog is total at greatest eclipse.

An axis point has `time`, `latitudeDeg`, `longitudeDeg`, `kind`, and `obscuration`, with the same meanings as a global solar eclipse's ground point; kind is `total` or `annular`, never `partial`, and can change along a hybrid path; Swift gives it a two-case `SolarEclipseAxisKind`. A central line's first and last points are the ground contacts, and the points between fall on every whole multiple of the step.

## Shared behavior

| Concern | Rule |
| --- | --- |
| Instant precision | Every input and returned instant is normalized to integer epoch milliseconds by truncation toward zero, matching ECMAScript TimeClip. Swift must not floor negative fractional milliseconds. |
| Non-finite input | Any non-finite numeric or time input is a validation error in both ports. |
| Out-of-interval time | TypeScript throws `AlmanacOutOfRangeError`; Swift throws `AlmanacError.outOfRange`. |
| Invalid observer or argument | TypeScript throws `RangeError`; Swift throws `AlmanacError.invalidObserver` or `AlmanacError.invalidArgument`. |
| Reversed or empty window | `startUtc ≥ endUtc` returns an empty list. |
| Validation order | Finite values, observer ranges, and interval containment are validated before the empty-window check. Invalid input cannot return a clean empty list. |
| Window end | Ordinary instants use `[min, max)`. A window end uses `[min, max]`, making the complete supported window legal. |
| Search anchor | Next and previous eclipse searches skip peaks within 100 milliseconds of the anchor. Range bounds do not use this band. |
| Solar eclipse scan | Next and previous solar eclipse searches, local and global, walk new moons to the supported boundary, then return the out-of-range outcome. |
| Global solar eclipse | The peak is greatest eclipse. The ground point is where the shadow axis meets the WGS-84 ellipsoid at the peak; an axis that misses it gives a partial eclipse with no ground point, and greatest eclipse falls on the limb nearest the axis. |
| Central line | The ends are the first and last ground contacts, to the millisecond, at the points where the axis grazes the ellipsoid. An axis point exists only where the Moon's shadow falls: near a full moon the line through the Sun and Moon also crosses the Earth, on the Sun's side of the Moon, and that crossing is not one. |

Event windows are half-open `[startUtc, endUtc)`, and callers own timezone and civil-day handling. Any window inside the supported interval is valid. Event-search cost is linear in the window length; the test suite measures the complete 151-year window and requires Sun and Moon events to finish within 120 seconds.

Next and previous lunar eclipse searches are strict and scan at most two years in their direction. The 100-millisecond same-eclipse band cannot skip a distinct eclipse because the minimum catalog gap is 29 days. Reaching the supported boundary without another eclipse returns the out-of-range outcome.

`lunarEclipses` returns every penumbral, partial, and total eclipse whose peak is in `[startUtc, endUtc)`, with no visibility filter. Candidate peaks use a fixed whole-UT-day seed so search direction and window boundaries do not shift the returned millisecond. Adjacent ranges can split at a returned peak without losing or duplicating it. Every root finder has a bounded iteration count; exhausting one is an implementation failure.

`solarEclipses` returns every eclipse the observer can see whose peak is in `[startUtc, endUtc)`. Candidate peaks use a fixed whole-UT-day new-moon seed, so adjacent ranges can split at a returned peak without losing or duplicating it. The same-eclipse band and the bounded root finders apply as for lunar eclipses. Contacts are located to the root finder's one-second tolerance, and a grazing eclipse can have a total or annular phase shorter than that, so C2 and C3 may be a second apart.

`globalSolarEclipses` returns every solar eclipse whose greatest eclipse is in `[startUtc, endUtc)`, whether or not anyone on Earth sees a central phase. A new moon is an eclipse when the Moon's penumbra reaches a sphere of the Earth's mean radius, 6,371 kilometers, without the atmosphere the lunar search adds to the Earth's shadow. The ground point is the near intersection of the axis with the ellipsoid in equator-of-date coordinates, and its longitude subtracts Greenwich apparent sidereal time. The kind there comes from the umbra of the Moon's polar radius, 1,736 kilometers, while the local search uses its mean radius, 1,737.4 kilometers, as upstream does. The two can disagree only for an eclipse whose umbra nearly vanishes at the ground point; from 1950 through 2100 that is the 1966-05-20 annular eclipse, which the local search reports as partial there. The fixed new-moon seed, the same-eclipse band, and the bounded root finders apply as for the local search.

When the axis misses the ellipsoid, the point of greatest eclipse is found in the same equator-of-date coordinates, with z dilated by the flattening so the ellipsoid becomes a sphere of the equatorial radius. The axis's closest approach to the sphere's center is scaled out to the sphere's surface, and that point, with z restored, is converted to geodetic latitude and longitude as the ground point is. The radius there is perpendicular to the axis, so the axis lies in the sphere's tangent plane. The dilation maps tangent planes to tangent planes, so on the ellipsoid the axis lies in the point's geodetic horizon, and the Sun's center is at geometric altitude zero to within the Sun's parallax, about 0.001°. Measured in the undilated coordinates, this is not exactly the point of the ellipsoid nearest the axis, but the difference is far smaller than the catalog's whole-degree rounding. The obscuration there is the local search's: 1 inside the umbra of the Moon's polar radius when it is total, and otherwise the covered fraction, below 1.

`solarEclipseCentralLine` finds the ground contacts as the zeros of the intersection quadratic's discriminant within six hours either side of the instant it is given; the longest central path from 1950 through 2100 lasts 3.9 hours. The line depends only on the eclipse, not on which instant inside its path is given: the ends are the contacts, and the points between are whole multiples of the step, so a step that is a whole multiple of another samples a subset of its instants. A consumer asking how far the nearest totality passes walks `globalSolarEclipses` forward and measures the distance to each total eclipse's line. At the default step, consecutive points from 1950 through 2100 lie a median of 47 kilometers apart and 155 at the 95th percentile, but up to 840 beside an end, where the shadow races along the horizon; a finer step, or `solarEclipseAxisPoint` at chosen instants, closes those gaps.

## Fixture and parity evidence

External fixtures determine physical correctness. Committed raw responses preserve the source evidence, while generator scripts derive the test data offline. Fixture metadata records the source, request, and retrieval date.

- Sun and Moon positions and distances use JPL Horizons across the supported interval. Coarse files are TT-labeled; dense current-era files exercise the public UT1-like API.
- Fixed-star horizontal positions use J2000 catalog coordinates from SIMBAD and expected altitude and azimuth from the USNO celestial-navigation almanac.
- Rise, set, twilight, and phase events use USNO data. Nautical and astronomical twilight also use a dedicated one-minute Horizons altitude grid because the USNO daily service reports only civil twilight.
- Lunar eclipse types, peaks, magnitudes, and selected contacts use the Espenak Five Millennium catalog.
- Contact fixtures cover total, partial, and penumbral shapes, including absent umbral contacts.
- Solar eclipse local circumstances (kind, contacts, Sun altitudes, obscuration) use the USNO Astronomical Applications API for eclipses from 2001 through 2026, the years that endpoint serves. USNO reports unrefracted Sun altitudes; the tests refract them with the port's own model before comparing.
- Solar eclipse kinds, peaks, and obscuration at the point of greatest eclipse use the Espenak Five Millennium Catalog of Solar Eclipses across the supported interval, with the observer placed at the catalog's whole-degree coordinates.
- Global solar eclipses use the same catalog: every eclipse from 1950 through 2100 must be found once and nothing else, with its kind, its peak, its axis distance against gamma times the 6,378.137-kilometer equatorial radius, and, where the axis passes within 6,100 kilometers of the Earth's center, its ground point against the catalog's whole-degree coordinates. The local search placed at each ground point must also peak within 2 seconds of greatest eclipse and report the same obscuration within `1e-6`. The 122 eclipses with no ground point, 115 partial and 7 non-central, check their point of greatest eclipse against the catalog's whole-degree coordinates. The Sun there must be on the geometric horizon, and the local search placed there must peak within 2 seconds of greatest eclipse, with the catalog's kind and the same obscuration within `1e-6`.
- Central lines use NASA's per-eclipse path tables for six central eclipses (2017-08-21, 2023-10-14, 2024-04-08, 2026-08-12, 2044-08-23, and 2045-08-12): greatest eclipse to 0.1 arcminute, the central line every 120 seconds, and the central line where the path meets the horizon at each end. Each table's UT is its TD minus its own Delta-T, so the tests compare at the same TD. The local search placed at every interior point of those lines must peak within 2 seconds of the point's time with its kind, and the kind sequence along every hybrid path in the catalog is pinned: annular, total, annular, except the 2013-11-03 path that Espenak types H3, which ends total.

The test suites enforce these physical tolerances:

| Quantity | Tolerance |
| --- | ---: |
| Sun angular position | 1 arcminute |
| Sun distance | `1e-4` AU |
| Moon angular position | 1 arcminute |
| Moon distance | 70 kilometers |
| Star altitude and azimuth | 1 arcminute |
| Event times | 60 seconds |
| Eclipse peaks and contacts | 60 seconds |
| Eclipse magnitudes | 0.03 |
| Solar eclipse contacts C1 to C4 | 60 seconds |
| Solar eclipse peak | 5 minutes |
| Solar eclipse obscuration | 0.01 |
| Sun altitude at C1 to C4 | 0.5° |
| Sun altitude at the peak | 1.5° |
| Global solar eclipse peak | 60 seconds |
| Global solar eclipse axis distance | 5 kilometers |
| Global solar eclipse ground point | 1° |
| Greatest eclipse on the limb | 1° |
| Geometric Sun altitude there | 0.01° |
| Greatest eclipse, central line, and its ends against the path tables | 5 kilometers |
| The same with a glancing axis, beyond 6,100 kilometers | 15 kilometers |
| Central line timing against the path tables | 60 seconds |
| Annular obscuration on the central line against the tabulated diameter ratio squared | 0.002 |

The Montenbruck–Pfleger lunar distance model has a measured mean scale bias of `-27.3 ppm` against JPL ephemerides and a periodic residual reaching about `-139 ppm`; the observed maximum absolute difference is 53.3 kilometers. Angular accuracy is unaffected.

USNO event fixtures after 2050 include disagreement between Delta-T projections. Rows through 2050 use the absolute 60-second limit. Later rows apply that limit to scatter around the mean offset for each date and separately bound the mean by the documented time-model divergence.

The solar eclipse peak is looser than its contacts because the axis-distance curve is flat at its minimum, so the root of its derivative is ill-conditioned, while the contacts are steep crossings. The catalog's whole-degree coordinates alone move the local peak by up to about 3 minutes. The altitude at the peak inherits that time tolerance.

Greatest eclipse needs no observer, so no coordinate rounding moves it, and the catalog's Delta-T column is the port's Espenak–Meeus model in whole seconds, within 0.8 seconds on every row. The measured worst peak error is 8.2 seconds, and the tolerance matches the lunar eclipse peaks. Gamma is tabulated to four decimals, 0.32 kilometers of rounding; the measured axis distance error stays within 2.4 kilometers through 2049 and reaches 4.1 kilometers in 2096. The catalog rounds the ground point to whole degrees, up to 0.71° on its own, and the measured worst is 0.66°. Beyond 6,100 kilometers the axis meets the ground so obliquely that the point is hypersensitive to the axis, so the check stops there, as upstream's does.

Against the path tables, the measured worst cases are 2.6 kilometers for greatest eclipse, 3.1 kilometers across the line and 4.9 seconds along it for the tabulated rows, and 3.6 kilometers for the ends. The one glancing table, 2044-08-23 with its axis 6,129 kilometers from the Earth's center, reaches 8.1 kilometers at greatest eclipse, 9.4 kilometers and 8.1 seconds along the line, and 9.1 kilometers at the ends, because a kilometer across a glancing axis is several along the ground. Distances are to the nearest point of the line, so timing does not enter them; timing has its own row, which matches the other event-time tolerances. The tables tabulate the diameter ratio to three decimals, which bounds its square to about 0.001; the measured worst is 0.0010.

The parity corpus detects port drift below the physical tolerances. It stores canonical inputs and quantized outputs with angles at `1e-6°`, distances at `1e-3 km` or `1e-9 AU`, and times at 1 millisecond. Both suites compare decoded values with a tolerance of 5 scaled units or 1 time quantum. Serializer byte order and floating-point formatting are outside the comparison. Every public function appears in the corpus, and external fixtures settle any disagreement between the ports.
