# Almanac v1 — Design

An offline sun & moon astronomy engine in Swift and TypeScript. Computes positions,
rise/set/twilight, moon phase and illumination, and lunar eclipses — pure functions,
zero network, zero runtime data files. Built for Slackwater (first consumer:
[slackwater-ios#222](https://github.com/openwatersio/slackwater-ios/issues/222),
lunar eclipses in the tide timeline) but generic: nothing in the API knows about tides.

## Scope

**v1:** sun & moon positions (geocentric and topocentric alt/az), sun rise/set +
civil/nautical/astronomical twilight + transit, moonrise/moonset, moon illumination
and phase events, lunar eclipse search with contact times and geometric local
visibility.

**v1.1 (deferred):** solar eclipse search and local circumstances. The shadow-geometry
architecture below generalizes to it; it ships when an app flow needs it, because local
solar circumstances add geoid intersection, path classification, obscuration, and
safe-viewing semantics that no current consumer requires.

**Out of scope:** planets, transits of Mercury/Venus, libration, apparent magnitudes,
constellations, weather/terrain in visibility, dates outside the supported interval.

## Upstream provenance

Algorithms are translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy)
(Don Cross, MIT), pinned at commit `865d3da7d8112bbc7911238052c6af4aaf877181` — its
lunar theory derives from Montenbruck & Pfleger's *Astronomy on the Personal Computer*;
its solar theory from truncated VSOP87. Upstream activity: last release v2.1.19
(2023-12-14), last commit 2025-01-27, and the author has
[stated](https://github.com/cosinekitty/astronomy/issues/398#issuecomment-3591702921)
the project is no longer actively developed. Don Cross's complete MIT license text
ships in NOTICE, included in every distribution of both packages.

**Why translate rather than wrap the upstream npm package:**

1. **Twin-port contract.** Both ports implement this one normative spec and pass one
   fixture corpus. Wrapping a foreign API on the TypeScript side only would leave
   Swift as the sole port, with nothing holding the two behaviors together.
2. **Bundle budget.** `astronomy-engine@2.1.19` is a 1.8 MB unpacked single-module
   package (not tree-shakeable) carrying planets and a Pluto gravity simulator.
   slackwater-web is a no-signal PWA; the lunar-focused subset is a small fraction
   of that.
3. **No Swift target upstream** — a Swift translation is required regardless.

## Why geometry-first

Position models come first; every feature above them is root-finding over the same two
models. An eclipse is found by searching the moon's distance from the real shadow axis —
not a separate precomputed eclipse series with its own error budget. One error budget,
and the eclipse answer is always consistent with the moon position the caller draws.

## Repo & packaging

`openwatersio/almanac`, public, MIT + NOTICE.

```
almanac/
  Package.swift      # at the ROOT — Git-URL SwiftPM consumers resolve the manifest here
  swift/             #   targets point into swift/Sources and swift/Tests via path:
  typescript/        # npm @openwatersio/almanac (ESM, zero dependencies)
  fixtures/          # shared corpus: raw sources, derived fixtures, parity corpus
  docs/
```

One version spans both ports; every release is a `vX.Y.Z` tag. npm publishes via OIDC
trusted publishing; SwiftPM consumers pin the tag.

## Architecture — four layers, identical in both ports

- **L0 time** — Julian date; ΔT via the Espenak–Meeus piecewise polynomials.
- **L1 positions** — sun: truncated VSOP87 (earth); moon: Montenbruck–Pfleger MOON2
  (arcsecond-class, with distance); nutation (truncated IAU 1980) and aberration.
- **L2 transforms** — ecliptic↔equatorial (equator-of-date), equatorial→horizontal,
  topocentric parallax, atmospheric refraction.
- **L3 event searches** — root-finding over L1/L2: rise/set/twilights, transit,
  phase events, lunar eclipse search.

## Time scales & supported interval

- API instants are platform dates (JS `Date`, Foundation `Date`) — UTC-shaped,
  millisecond precision.
- Calculations treat UTC as UT1: |UT1−UTC| < 0.9 s, far inside the ±60 s event
  tolerance. No leap-second table ships (the zero-runtime-data promise holds), so
  results are UT1-accurate, not exact-UTC-accurate.
- TT = UT1 + ΔT (Espenak–Meeus polynomials).
- **Supported interval: 1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z** — the
  intersection of the fixture evidence (Horizons positions 1950–2100, Espenak
  eclipses 1900–2100, USNO events 1700–2100). Inputs outside it produce the typed
  out-of-range outcome, never a silently degraded answer. Widening the interval
  requires new boundary fixtures first.

## Conventions (normative)

- **Observer** — WGS-84 geodetic: `latitudeDeg` north-positive [−90, 90],
  `longitudeDeg` east-positive [−180, 180], `elevationM` default 0, [−500, 10000].
  Elevation feeds topocentric parallax only; horizon dip is not modeled. Out-of-range
  values are a validation error (TS: throw `RangeError`; Swift: throws).
- **Angles** — degrees everywhere, `Double`. RA [0, 360) on the equator of date;
  dec [−90, 90]; azimuth [0, 360) from true north through east; altitude [−90, 90].
- **Distances** — moon in km; sun in AU.
- **Refraction** — sea-level standard atmosphere, fixed (no pressure/temperature
  inputs in v1); 34′ at the horizon.
- **Sun rise/set** — geometric center altitude −0.8333° (34′ refraction + 16′
  semidiameter: the upper-limb convention). Twilights: center altitude −6°/−12°/−18°,
  no refraction term.
- **Moonrise/set** — apparent topocentric upper limb crosses altitude 0: refraction,
  topocentric parallax, and true semidiameter at distance all included.
- **Lunar eclipse** — shadow model as translated from the pinned Astronomy Engine
  commit; its agreement with the Espenak catalog within tolerance is what the
  fixtures assert, so the enlargement convention is checked, not just cited. Output:
  type `penumbral | partial | total`; peak time; umbral and penumbral magnitudes;
  contacts P1/P4 always, U1/U4 for partial+, U2/U3 for total (absent otherwise).
  Visibility is **geometric only** — moon topocentric altitude > 0° at the queried
  instant; no weather, terrain, or safe-viewing guidance.

## Public API contract

Pure functions, no shared state. Same names and semantics in both ports; containers are
idiomatic (TS object / Swift struct). All time arguments and results are UTC instants.

| Function | Arguments | Result |
|---|---|---|
| `sunPosition(time)` | instant | `raDeg, decDeg, distanceAu, eclipticLonDeg, eclipticLatDeg` — geocentric, equator/ecliptic of date |
| `moonPosition(time)` | instant | `raDeg, decDeg, distanceKm, eclipticLonDeg, eclipticLatDeg` — geocentric, of date |
| `sunAltAz(time, observer)` | instant, Observer | `azDeg, altDeg` — topocentric, refracted |
| `moonAltAz(time, observer)` | instant, Observer | `azDeg, altDeg` — topocentric (parallax applied), refracted |
| `moonIllumination(time)` | instant | `fraction` [0,1], `phaseAngleDeg`, `phase` [0,1) (0 new, 0.5 full), `waxing` |
| `sunEvents(startUtc, endUtc, observer)` | half-open window, Observer | sorted `[{time, kind}]`, kind ∈ rise, set, civilDawn/Dusk, nauticalDawn/Dusk, astroDawn/Dusk, transit; empty list is valid (polar day/night drops crossings; transit still reported) |
| `moonEvents(startUtc, endUtc, observer)` | half-open window, Observer | sorted `[{time, kind}]`, kind ∈ rise, set |
| `searchMoonPhases(startUtc, endUtc)` | half-open window | sorted `[{time, phase}]`, phase ∈ new, firstQuarter, full, lastQuarter |
| `nextLunarEclipse(after)` | instant | `LunarEclipse` (fields per the eclipse convention above) or the out-of-range outcome |
| `lunarEclipseVisibility(eclipse, observer)` | LunarEclipse, Observer | `visibleAtPeak`, `moonAltAtPeakDeg`, per-contact visibility flags |

**Window and search contracts:**

- Event windows are half-open `[startUtc, endUtc)`; an event at `endUtc` belongs to the
  next window. Callers own all timezone/civil-day logic. Any window inside the
  supported interval is valid — searches are linear-time and cheap.
- `nextLunarEclipse` scans forward at most 2 years (some lunar eclipse, penumbral
  included, always occurs within ~6 months); a scan crossing the supported-interval
  end returns the out-of-range outcome (TS: typed error; Swift: typed throw).
- Internal iteration caps exist on every root-finder; hitting one is a bug, asserted
  never to occur across the whole fixture corpus.

## Fixture corpus

`fixtures/` is the authority both ports answer to. Every fixture directory carries
`meta.json`: source name and version, the exact request (URL + parameters), and the
retrieval date. Raw responses are committed, so git itself is their integrity hash.

- **Positions** — sun/moon RA/dec/distance across 1950–2100, from the JPL Horizons API
  (deliberately not generated from Astronomy Engine). Raw responses committed under
  `fixtures/raw/`.
- **Events** — USNO rise/set/twilight across a latitude grid including polar edge
  cases; USNO moon-phase catalog.
- **Lunar eclipses** — Espenak Five Millennium catalog subset (1950–2100): types,
  greatest-eclipse times, magnitudes; plus spot-checked contact times.
- **Tolerances are data**, in fixture metadata: sun ≤ 1′, moon ≤ 1′, event times
  ≤ 60 s, eclipse peak and contact times ≤ 60 s.
- `fixtures/generate/` scripts run **offline** from the committed raw responses;
  `--check` fails on drift between raw and derived. A separate explicit `refresh`
  command is the only thing that touches the network.

## Parity corpus

External fixtures decide correctness; the parity corpus catches port drift below
physical tolerances, symmetrically:

- `fixtures/parity/` holds canonical inputs and quantized outputs (angles to 1e-6°,
  distances to 1e-3 km / 1e-9 AU, times to 1 ms) densely sampled across the interval.
- **Both** suites compare their computed values to the canonical file, field-wise, at
  tolerances stated in the file. Neither port is the oracle: on a mismatch, the
  external fixtures arbitrate which port is wrong, and the corpus is regenerated
  from the corrected port at a recorded commit.

## Testing, CI & release verification

TDD per layer; each layer lands fixtures-first. CI: a node job (TS suite) and a macOS
job (`swift test`), both reading `fixtures/`.

A release tag additionally verifies the **deliverables**, not just the source: a clean
temp project resolves the Swift package from the pushed tag and builds an import smoke
test; `npm pack` output is installed into a clean temp project, imported, and called.
npm publish happens only after both pass.

## Build order

TypeScript leads each layer (fixture tooling shares the language), Swift follows
immediately — the ports never sit more than one layer apart, and the parity corpus
covers every layer as it lands.
