# Almanac contract

Almanac provides pure astronomy functions with matching behavior in TypeScript and Swift. It uses no network service or runtime data files. The two implementations share this contract and the fixture corpus; neither port defines behavior by itself.

## Models and architecture

The algorithms are translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross at pinned commit `865d3da7d8112bbc7911238052c6af4aaf877181`. Its lunar theory derives from Montenbruck and Pfleger's *Astronomy on the Personal Computer*, and its solar theory uses truncated VSOP87. The complete upstream MIT license is in [NOTICE](../NOTICE) and ships with both packages.

Maintaining the translation keeps both languages on the same contract, avoids giving one port a separate foreign API, and retains zero runtime dependencies and data files. The package carries only the models its public functions use.

Both ports implement four matching layers:

- Time: Julian date and Delta-T from the Espenak–Meeus piecewise polynomials.
- Positions: truncated VSOP87 for the Sun, Montenbruck–Pfleger MOON2 for the Moon, and truncated IAU 2000B nutation and aberration translated from upstream.
- Transforms: ecliptic and equatorial conversion on the equator of date, equatorial to horizontal conversion, topocentric parallax, precession for fixed-star catalog positions, and atmospheric refraction.
- Events: root finding over the position and transform layers for rise, set, twilight, transit, phase, and lunar eclipse searches.

Event searches use the same position models returned by the position functions. Lunar eclipses are found from the Moon's distance to the Earth's shadow axis rather than from a separate precomputed eclipse series.

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

A lunar eclipse has `kind`, `peak`, `magUmbral`, `magPenumbral`, `p1`, `u1`, `u2`, `u3`, `u4`, and `p4`. Kind is `penumbral`, `partial`, or `total`; P1 and P4 are always present, U1 and U4 are present for partial and total eclipses, and U2 and U3 are present only for total eclipses. `lunarEclipseVisibility` validates finite times, contact chronology, and agreement between the kind and contact shape.

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

Event windows are half-open `[startUtc, endUtc)`, and callers own timezone and civil-day handling. Any window inside the supported interval is valid. Event-search cost is linear in the window length; the test suite measures the complete 151-year window and requires Sun and Moon events to finish within 120 seconds.

Next and previous lunar eclipse searches are strict and scan at most two years in their direction. The 100-millisecond same-eclipse band cannot skip a distinct eclipse because the minimum catalog gap is 29 days. Reaching the supported boundary without another eclipse returns the out-of-range outcome.

`lunarEclipses` returns every penumbral, partial, and total eclipse whose peak is in `[startUtc, endUtc)`, with no visibility filter. Candidate peaks use a fixed whole-UT-day seed so search direction and window boundaries do not shift the returned millisecond. Adjacent ranges can split at a returned peak without losing or duplicating it. Every root finder has a bounded iteration count; exhausting one is an implementation failure.

## Fixture and parity evidence

External fixtures determine physical correctness. Committed raw responses preserve the source evidence, while generator scripts derive the test data offline. Fixture metadata records the source, request, and retrieval date.

- Sun and Moon positions and distances use JPL Horizons across the supported interval. Coarse files are TT-labeled; dense current-era files exercise the public UT1-like API.
- Fixed-star horizontal positions use J2000 catalog coordinates from SIMBAD and expected altitude and azimuth from the USNO celestial-navigation almanac.
- Rise, set, twilight, and phase events use USNO data. Nautical and astronomical twilight also use a dedicated one-minute Horizons altitude grid because the USNO daily service reports only civil twilight.
- Lunar eclipse types, peaks, magnitudes, and selected contacts use the Espenak Five Millennium catalog.
- Contact fixtures cover total, partial, and penumbral shapes, including absent umbral contacts.

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

The Montenbruck–Pfleger lunar distance model has a measured mean scale bias of `-27.3 ppm` against JPL ephemerides and a periodic residual reaching about `-139 ppm`; the observed maximum absolute difference is 53.3 kilometers. Angular accuracy is unaffected.

USNO event fixtures after 2050 include disagreement between Delta-T projections. Rows through 2050 use the absolute 60-second limit. Later rows apply that limit to scatter around the mean offset for each date and separately bound the mean by the documented time-model divergence.

The parity corpus detects port drift below the physical tolerances. It stores canonical inputs and quantized outputs with angles at `1e-6°`, distances at `1e-3 km` or `1e-9 AU`, and times at 1 millisecond. Both suites compare decoded values with a tolerance of 5 scaled units or 1 time quantum. Serializer byte order and floating-point formatting are outside the comparison. Every public function appears in the corpus, and external fixtures settle any disagreement between the ports.
