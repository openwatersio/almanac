# Scope

Almanac provides the same offline Sun and Moon calculations in TypeScript and Swift. The [v1 design spec](superpowers/specs/2026-08-28-almanac-v1-design.md) defines the binding behavior, and [GitHub issues](https://github.com/openwatersio/almanac/issues) track proposed work.

## Included

- Geocentric and topocentric Sun and Moon positions, including right ascension, declination, altitude, and azimuth.
- Sunrise, sunset, civil, nautical, and astronomical twilight, and upper transit.
- Moonrise and moonset using the upper-limb convention.
- Moon illumination, phase angle, named phase, waxing or waning state, and quarter-phase events.
- Lunar eclipse next, previous, and range searches, including eclipse kind, magnitudes, contact times, and geometric local visibility.
- A shared fixture and parity corpus for both ports, plus a performance regression harness.

The supported interval is `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Instants outside it raise a typed error.

## Boundaries

- Solar eclipse search and local circumstances remain outside the public API until a consumer needs the required geoid intersection, path classification, obscuration, and safe-viewing behavior.
- Planets, planetary transits, libration, apparent magnitudes, and constellations require models or catalogs outside the current Sun and Moon scope.
- Visibility is geometric. Weather, terrain, and cloud cover require separate data sources.
- The library does not extrapolate outside the supported interval because the series truncations and Delta-T model do not support reliable results there.
- Migrations from astronomy implementations in consumer applications are tracked in those repositories and do not block Almanac releases.
