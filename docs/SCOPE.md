# Scope

Almanac provides the same offline Sun, Moon, planet, and fixed-star calculations in TypeScript and Swift. The [public contract](CONTRACT.md) defines the binding behavior, and [GitHub issues](https://github.com/openwatersio/almanac/issues) track proposed work.

## Included

- Geocentric and topocentric Sun and Moon positions, including right ascension, declination, altitude, and azimuth.
- Altitude and azimuth for any fixed star from its J2000 catalog position, precessed and nutated to date and refracted through the same topocentric path as the Sun and Moon. The shared fixtures check navigational stars against the USNO almanac within an arcminute.
- Sunrise, sunset, civil, nautical, and astronomical twilight, and upper transit.
- Moonrise and moonset using the upper-limb convention.
- Apparent horizon dip from eye height above an unobstructed surface, including terrestrial refraction, with height-aware rise/set and local eclipse visibility.
- Apparent Earth-based positions, altitude/azimuth, point-center rise/set, illumination, approximate visual magnitude, and solar elongation for Mercury, Venus, Mars, Jupiter, and Saturn.
- Geometric Sun-centered positions for those five planets and Earth in fixed J2000 equatorial coordinates, for a solar-system view.
- Moon illumination, phase angle, named phase, waxing or waning state, and quarter-phase events.
- Lunar eclipse next, previous, and range searches, including eclipse kind, magnitudes, contact times, and geometric local visibility.
- Solar eclipse next, previous, and range searches for an observer, including eclipse kind, contact times with the Sun's altitude at each, peak obscuration, and the fraction of the Sun's disc covered at any instant.
- Solar eclipse next, previous, and range searches anywhere on Earth, including greatest eclipse, the shadow axis's distance from the Earth's center, and where the axis meets the ground, with the kind and obscuration seen there.
- The central line of a total or annular eclipse, sampled from the axis's first ground contact to its last, and the axis point at any instant, so a consumer can measure how far the nearest totality passes.
- A shared fixture and parity corpus for both ports, plus a performance regression harness.

The supported interval is `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Instants outside it raise a typed error.

## Boundaries

- A solar eclipse's path width and limits, hybrid as a kind, eclipse magnitude, and safe-viewing guidance remain outside the public API until a consumer needs them. The global `kind` describes the shadow axis's ground intersection: an axis that misses the Earth returns `partial`, including non-central eclipses cataloged as total or annular. Use the observer-specific search for the kind seen at a place.
- Uranus, Neptune, Pluto, planetary transits, libration, and constellations remain outside the current scope. Earth is accepted by heliocentric positions and rejected by Earth-based planetary queries.
- Planet viewing windows are a consumer policy combining altitude above the apparent horizon, Sun altitude, elongation, and magnitude. These quantities do not promise actual naked-eye visibility. Venus's extreme-crescent brightness model differs from Horizons by up to 0.75 magnitudes in the shared evidence; see the [accuracy contract](CONTRACT.md).
- Almanac does not ship a star catalog because runtime data files are outside its design. `starAltAz` takes the J2000 coordinates a consumer already carries.
- Star positions omit annual aberration and proper motion. Annual aberration is at most 20.5 arcseconds, and all but a few fast-moving stars shift only a few arcseconds per decade, below the arcminute used by a sky drawing or sight reduction.
- Sky positions include atmospheric refraction in a standard sea-level atmosphere. Observer elevation affects parallax. `horizonDip` reports the apparent horizon from a supplied eye height above the unobstructed surface; event and eclipse visibility APIs accept that height, defaulting to zero. Eclipse obscuration is geometric; local solar eclipse searches use refracted Sun altitudes, while lunar eclipse visibility uses unrefracted Moon altitudes. Weather, terrain, and cloud cover require separate data sources.
- The library does not extrapolate outside the supported interval because the series truncations and Delta-T model do not support reliable results there.
- Migrations from astronomy implementations in consumer applications are tracked in those repositories and do not block Almanac releases.
