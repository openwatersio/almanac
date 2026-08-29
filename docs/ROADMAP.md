# Roadmap

What Almanac does today, what it will do next, and what it will not do. The binding
detail lives in the [v1 design spec](superpowers/specs/2026-08-28-almanac-v1-design.md);
this page is the short version.

## Shipped — v0.1.0

Both ports, one behavior, validated against the shared fixture corpus.

- **Positions** — geocentric and topocentric Sun and Moon, right ascension and
  declination, altitude and azimuth.
- **Sun events** — rise and set, civil / nautical / astronomical twilight, and upper
  transit.
- **Moon events** — moonrise and moonset on the upper-limb convention.
- **Moon illumination** — illuminated fraction, phase angle, phase, waxing or waning,
  and the four quarter-phase events.
- **Lunar eclipses** — search, kind, penumbral and umbral magnitude, the six contact
  times, and geometric local visibility per contact.

Supported interval: `1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z`. Instants outside it
raise a typed error rather than returning a wrong answer.

## Next — v1.1

**Solar eclipse search and local circumstances.** The shadow-geometry architecture
already generalizes to it. It has waited because local solar circumstances add geoid
intersection, path classification, obscuration, and safe-viewing semantics, and no
consumer has needed them yet. It ships when an app flow does.

**`previousLunarEclipse`.** `nextLunarEclipse` searches strictly forward. The
[Sky page](https://openwaters.io/sky) is the first consumer that wanted the most recent
eclipse rather than the coming one, and had to walk forward from a year back to find
it. That workaround is sound — the longest real gap between lunar eclipses over the
supported interval is 178 days — but the search belongs in the library, not in every
caller.

## Not planned

Each of these was considered and left out on purpose:

- **Planets, and transits of Mercury and Venus** — a different body model, and no
  consumer.
- **Libration and apparent magnitudes** — presentation detail beyond what marine and
  timeline use cases read.
- **Constellations** — a catalog dependency, which is exactly what "zero runtime data
  files" rules out.
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
