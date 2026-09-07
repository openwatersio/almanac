# Roadmap

What Almanac does today, what it will do next, and what it will not do. The binding
detail lives in the [v1 design spec](superpowers/specs/2026-08-28-almanac-v1-design.md);
this page is the short version.

## Shipped — v0.3.0

Both ports, one behavior, validated against the shared fixture corpus.

- **Positions** — geocentric and topocentric Sun and Moon, right ascension and
  declination, altitude and azimuth.
- **Stars** — altitude and azimuth of any fixed star from its J2000 catalog
  position, precessed and nutated to date and refracted, checked against USNO's
  navigational-star almanac.
- **Sun events** — rise and set, civil / nautical / astronomical twilight, and upper
  transit.
- **Moon events** — moonrise and moonset on the upper-limb convention.
- **Moon illumination** — illuminated fraction, phase angle, phase, waxing or waning,
  and the four quarter-phase events.
- **Lunar eclipses** — next, previous, and range searches; kind, penumbral and umbral
  magnitude, the six contact times, and geometric local visibility per contact.

Supported interval: `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Instants outside it
raise a typed error rather than returning a wrong answer.

## New in v0.3.0

**A fixed star's altitude and azimuth** ([#12](https://github.com/openwatersio/almanac/issues/12)).
`starAltAz(raDeg, decDeg, time, observer)` takes a J2000 catalog position and
returns where the star stands, precessed and nutated to date and refracted,
through the same topocentric path as the Sun and Moon. Checked against USNO's
celestial-navigation almanac within an arcminute. Consumers drawing a sky no
longer carry their own sidereal time.

## New in v0.2.0

**Backward and range lunar eclipse searches** ([#6](https://github.com/openwatersio/almanac/issues/6)).
`previousLunarEclipse` searches directly backward; `lunarEclipses` returns peaks
in a half-open window. Consumers no longer need a fixed lookback or a forward
loop.

**Performance regression harness** ([#7](https://github.com/openwatersio/almanac/pull/7)).
Shared workloads compare TypeScript and Swift release builds against the base
revision in CI, including the original consumer loops for eclipse searches.
A median slowdown above 20% fails the check. The macOS performance job runs only
after the cheaper TypeScript performance job passes.

## Next

**Solar eclipse search and local circumstances.** The shadow-geometry architecture
already generalizes to it. It has waited because local solar circumstances add geoid
intersection, path classification, obscuration, and safe-viewing semantics, and no
consumer has needed them yet. It ships when an app flow does.

## Not planned

Each of these was considered and left out on purpose:

- **Planets, and transits of Mercury and Venus** — a different body model, and no
  consumer.
- **Libration and apparent magnitudes** — presentation detail beyond what marine and
  timeline use cases read.
- **Constellations and star catalogs** — a catalog dependency, which is exactly what
  "zero runtime data files" rules out. `starAltAz` takes the coordinates a consumer
  already carries.
- **Annual aberration and proper motion for stars** — at most 20.5″ and, for all but
  a few fast movers, a few arcseconds a decade: under the arcminute a sky drawing
  or a sight reduction reads. Aberration is a translation of upstream's VSOP
  velocity when a consumer needs it.
- **Weather and terrain in visibility** — visibility here is geometric, meaning whether
  a body is above your horizon. Cloud and topography are a different problem with
  different data.
- **Dates outside the supported interval** — the series truncations and the ΔT model
  stop being honest there, so the API refuses rather than extrapolating.

## Consumers

Almanac exists to end three separate astronomy implementations: it is the shared
replacement for `slackwater-ios`'s `SunMoon.swift` and `slackwater-web`'s suncalc.
Those migrations are tracked as issues in their own repositories. They do not gate
library releases — a library gated on two app codebases inverts the dependency — but
deleting each replaced implementation is the acceptance criterion for its issue.
