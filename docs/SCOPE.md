# Scope

Almanac provides the same offline Sun, Moon, planet, and fixed-star calculations in TypeScript, Swift, and Kotlin. The [public contract](CONTRACT.md) defines the binding behavior, and [GitHub issues](https://github.com/openwatersio/almanac/issues) track proposed work. The [library comparison](comparison.md) sets this scope beside other Sun and Moon libraries for TypeScript, JavaScript, and Swift.

## Included

- Geocentric and topocentric Sun and Moon positions, including right ascension, declination, altitude, and azimuth.
- The apparent place of any fixed star from its J2000 catalog position, with annual aberration, precession, and nutation, and its altitude and azimuth through the same refracted topocentric path as the Sun and Moon. The shared fixtures check navigational stars' Greenwich hour angle and declination against the USNO almanac within an arcsecond once the test propagates each star's catalog proper motion, and their altitude and azimuth within an arcminute.
- Greenwich apparent sidereal time, so a caller can form any body's Greenwich hour angle for sight reduction.
- Sunrise, sunset, civil, nautical, and astronomical twilight, and upper transit.
- The Sun crossing any altitude a caller picks, such as golden hour at `+6°`, and the Sun's and Moon's upper and lower transits.
- Moonrise and moonset using the upper-limb convention.
- The Moon's bright-limb position angle and parallactic angle, for drawing its disc as the observer sees it.
- Apparent horizon dip from eye height above an unobstructed surface, including terrestrial refraction, with height-aware rise/set and local eclipse visibility.
- Apparent Earth-based positions, altitude/azimuth, point-center rise/set, illumination, approximate visual magnitude, and solar elongation for Mercury, Venus, Mars, Jupiter, Saturn, Uranus, and Neptune.
- Geometric Sun-centered positions for those seven planets and Earth in fixed J2000 equatorial coordinates, for a solar-system view.
- Moon illumination, phase angle, named phase, waxing or waning state, and quarter-phase events.
- Equinoxes and solstices, lunar perigees and apogees, and Earth's perihelion and aphelion, each with its distance, and the equation of time.
- Lunar eclipse next, previous, and range searches, including eclipse kind, magnitudes, contact times, and geometric local visibility.
- Solar eclipse next, previous, and range searches for an observer, including eclipse kind, contact times with the Sun's altitude at each, peak obscuration, and the fraction of the Sun's disc covered at any instant.
- Solar eclipse next, previous, and range searches anywhere on Earth, including greatest eclipse, the shadow axis's distance from the Earth's center, and where the axis meets the ground, with the kind and obscuration seen there.
- The central line of a total or annular eclipse, sampled from the axis's first ground contact to its last, and the axis point at any instant, so a consumer can measure how far the nearest totality passes.
- Every value SunCalc computes; the [migration guide](migrating-from-suncalc.md) maps each SunCalc call to Almanac.
- Every value the Solar Swift library computes; the [Solar migration guide](migrating-from-solar.md) maps each Solar property to Almanac.
- A shared fixture and parity corpus for all three ports, plus a TypeScript/Swift performance regression harness.

The supported interval is `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Instants outside it raise a typed error.

## Boundaries

- A solar eclipse's path width and limits, hybrid as a kind, eclipse magnitude, and safe-viewing guidance remain outside the public API until a consumer needs them. The global `kind` describes the shadow axis's ground intersection: an axis that misses the Earth returns `partial`, including non-central eclipses cataloged as total or annular. Use the observer-specific search for the kind seen at a place.
- Pluto, planetary transits, libration, and constellations remain outside the current scope. Earth is accepted by heliocentric positions and rejected by Earth-based planetary queries.
- Planet viewing windows are a consumer policy combining altitude above the apparent horizon, Sun altitude, elongation, and magnitude. These quantities do not promise actual naked-eye visibility. Venus's extreme-crescent brightness model differs from Horizons by up to 0.75 magnitudes in the shared evidence; see the [accuracy contract](CONTRACT.md).
- Almanac does not ship a star catalog because runtime data files are outside its design. `starPosition` and `starAltAz` take the J2000 coordinates a consumer already carries.
- Star positions omit proper motion and stellar parallax. Parallax is under an arcsecond for every star. Proper motion is not small at sight-reduction precision: by 2026 a J2000 catalog position is more than 0.1 arcminute off for navigational stars moving faster than about 230 milliarcseconds a year, among them Vega, Fomalhaut, Capella, Pollux, Altair, Procyon, and Sirius. Arcturus is about a full arcminute off, and Rigil Kentaurus, the fastest, about 1.6 arcminutes. A caller that needs those stars at that precision propagates its catalog's proper motion to the date of interest and passes the result, still referred to the J2000 equator and equinox, because the library precesses from J2000.
- Sky positions include atmospheric refraction in a standard sea-level atmosphere. Observer elevation affects parallax. `horizonDip` reports the apparent horizon from a supplied eye height above the unobstructed surface; event and eclipse visibility APIs accept that height, defaulting to zero. Eclipse obscuration is geometric; local solar eclipse searches use refracted Sun altitudes, while lunar eclipse visibility uses unrefracted Moon altitudes. Weather, terrain, and cloud cover require separate data sources.
- The library does not extrapolate outside the supported interval because the series truncations and Delta-T model do not support reliable results there.
- Migrations from astronomy implementations in consumer applications are tracked in those repositories and do not block Almanac releases.

Kotlin/JVM targets JVM 8 and Android minSdk 26 with `java.time.Instant`. It is consumed from source through Gradle; Maven publication, Kotlin benchmarks, and Android device validation are deferred.
