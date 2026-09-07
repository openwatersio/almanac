# Scope

Almanac provides the same offline Sun, Moon, and fixed-star calculations in TypeScript and Swift. The [public contract](CONTRACT.md) defines the binding behavior, and [GitHub issues](https://github.com/openwatersio/almanac/issues) track proposed work.

## Included

- Geocentric and topocentric Sun and Moon positions, including right ascension, declination, altitude, and azimuth.
- Altitude and azimuth for any fixed star from its J2000 catalog position, precessed and nutated to date and refracted through the same topocentric path as the Sun and Moon. The shared fixtures check navigational stars against the USNO almanac within an arcminute.
- Sunrise, sunset, civil, nautical, and astronomical twilight, and upper transit.
- Moonrise and moonset using the upper-limb convention.
- Moon illumination, phase angle, named phase, waxing or waning state, and quarter-phase events.
- Lunar eclipse next, previous, and range searches, including eclipse kind, magnitudes, contact times, and geometric local visibility.
- A shared fixture and parity corpus for both ports, plus a performance regression harness.

The supported interval is `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Instants outside it raise a typed error.

## Boundaries

- Solar eclipse search and local circumstances remain outside the public API until a consumer needs the required geoid intersection, path classification, obscuration, and safe-viewing behavior.
- Planets, planetary transits, libration, apparent magnitudes, and constellations require models or catalogs outside the current scope.
- Almanac does not ship a star catalog because runtime data files are outside its design. `starAltAz` takes the J2000 coordinates a consumer already carries.
- Star positions omit annual aberration and proper motion. Annual aberration is at most 20.5 arcseconds, and all but a few fast-moving stars shift only a few arcseconds per decade, below the arcminute used by a sky drawing or sight reduction.
- Visibility is geometric. Weather, terrain, and cloud cover require separate data sources.
- The library does not extrapolate outside the supported interval because the series truncations and Delta-T model do not support reliable results there.
- Migrations from astronomy implementations in consumer applications are tracked in those repositories and do not block Almanac releases.
