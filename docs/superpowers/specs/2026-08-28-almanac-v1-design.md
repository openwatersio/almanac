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

**Consumers & retirement.** Almanac is the shared replacement for slackwater-ios's
`SunMoon.swift` and slackwater-web's suncalc — three astronomy implementations is the
divergence this package exists to end. App migrations do not gate the library release
(a library gate on two app codebases inverts the dependency), but the v0.1.0 release
includes filing a migration issue in each app repo; deleting the replaced
implementation is that issue's acceptance criterion.

## Upstream provenance

Algorithms are translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy)
(Don Cross, MIT), pinned at commit `865d3da7d8112bbc7911238052c6af4aaf877181` — its
lunar theory derives from Montenbruck & Pfleger's *Astronomy on the Personal Computer*;
its solar theory from truncated VSOP87. Upstream activity: last release v2.1.19
(2023-12-14), last commit 2025-01-27, and the author has
[stated](https://github.com/cosinekitty/astronomy/issues/398#issuecomment-3591702921)
that no new features are planned — feature-frozen, not abandoned. Don Cross's complete MIT license text
ships in NOTICE, included in every distribution of both packages.

**Why translate rather than wrap the upstream npm package:**

1. **Twin-port contract.** Both ports implement this one normative spec and pass one
   fixture corpus. Wrapping a foreign API on the TypeScript side only would leave
   Swift as the sole port, with nothing holding the two behaviors together.
2. **Bundle budget.** `astronomy-engine@2.1.19` is a single non-tree-shakeable
   module (116,485 bytes minified; 1.8 MB unpacked on disk) carrying planets and a
   Pluto gravity simulator no consumer here calls. slackwater-web is a no-signal
   PWA; the lunar-focused subset is a fraction of that. This argument is secondary —
   the twin-port contract above is the primary reason — and the actual gzip delta
   gets measured when slackwater-web adopts the package.
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
  (arcsecond-class, with distance); nutation (IAU 2000B truncated, as translated from upstream `iau2000b`) and aberration.
- **L2 transforms** — ecliptic↔equatorial (equator-of-date), equatorial→horizontal,
  topocentric parallax, atmospheric refraction.
- **L3 event searches** — root-finding over L1/L2: rise/set/twilights, transit,
  phase events, lunar eclipse search.

## Time scales & supported interval

- API instants are platform dates (JS `Date`, Foundation `Date`) — UTC-shaped,
  millisecond precision.
- Calculations treat UTC as UT1: |UT1−UTC| < 0.9 s in the leap-second era (1972+),
  far inside the ±60 s event tolerance. No leap-second table ships (the
  zero-runtime-data promise holds), so results are UT1-accurate, not
  exact-UTC-accurate. Pre-1972 timestamps are proleptic civil labels interpreted as
  UT1-like; the fixture tolerances are the accuracy promise for that period.
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
- **Coordinate semantics** — geocentric RA/dec and ecliptic lon/lat are **apparent**:
  true equator/equinox of date with nutation and aberration applied, exactly the
  upstream `Equator(body, date, observer, ofdate: true, aberration: true)` transform.
- **Distances** — moon in km; sun in AU.
- **Refraction** — the translated upstream `Refraction('normal')` formula, including
  its below-horizon taper, at fixed sea-level standard atmosphere (no
  pressure/temperature inputs in v1). It yields ≈ 34′ at the horizon; that constant
  by itself is only the folded rise/set threshold, not the refraction function.
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
  Visibility is **geometric only** — **unrefracted** topocentric center altitude > 0°
  at the queried instant (note `moonAltAz` itself is refracted); no weather, terrain,
  or safe-viewing guidance. Visibility needs no dedicated fixture: it is by definition
  the sign of an altitude the alt-az fixtures already cover.

## Public API contract

Pure functions, no shared state. Same names and semantics in both ports; containers are
idiomatic (TS object / Swift struct). All time arguments and results are UTC instants.

| Function | Arguments | Result |
|---|---|---|
| `sunPosition(time)` | instant | `raDeg, decDeg, distanceAu, eclipticLonDeg, eclipticLatDeg` — geocentric, equator/ecliptic of date |
| `moonPosition(time)` | instant | `raDeg, decDeg, distanceKm, eclipticLonDeg, eclipticLatDeg` — geocentric, of date |
| `sunAltAz(time, observer)` | instant, Observer | `azDeg, altDeg` — topocentric, refracted |
| `moonAltAz(time, observer)` | instant, Observer | `azDeg, altDeg` — topocentric (parallax applied), refracted |
| `moonIllumination(time)` | instant | `fraction` [0,1], `phaseAngleDeg` [0,180] (0 = full, 180 = new; `fraction = (1 + cos θ)/2`), `phase` [0,1) (0 new, 0.5 full), `waxing` |
| `sunEvents(startUtc, endUtc, observer)` | half-open window, Observer | sorted `[{time, kind}]`, kind ∈ rise, set, civilDawn/Dusk, nauticalDawn/Dusk, astroDawn/Dusk, transit; empty list is valid (polar day/night drops crossings; transit still reported) |
| `moonEvents(startUtc, endUtc, observer)` | half-open window, Observer | sorted `[{time, kind}]`, kind ∈ rise, set |
| `searchMoonPhases(startUtc, endUtc)` | half-open window | sorted `[{time, phase}]`, phase ∈ new, firstQuarter, full, lastQuarter |
| `nextLunarEclipse(after)` | instant | `LunarEclipse` (fields per the eclipse convention above) or the out-of-range outcome |
| `lunarEclipseVisibility(eclipse, observer)` | LunarEclipse, Observer | `visibleAtPeak`, `moonAltAtPeakDeg`, per-contact visibility flags |

**Cross-port contract** (identical in both ports):

| Concern | Rule |
|---|---|
| Instant precision | Every input and returned instant is normalized to integer epoch milliseconds (floor). Foundation's sub-ms precision never reaches the math or the results. |
| Non-finite input | Any NaN/±∞ number, or a TS invalid `Date`, is a validation error (invalid `Date` is TS-only; Swift `Date` cannot be invalid). |
| Out-of-interval time | TS `AlmanacOutOfRangeError` ↔ Swift `AlmanacError.outOfRange`. |
| Invalid observer/argument | TS `RangeError` ↔ Swift `AlmanacError.invalidObserver` / `.invalidArgument`. |
| Reversed/empty window | `startUtc ≥ endUtc` → empty list, no error. |
| Search anchor | `nextLunarEclipse(after)`: strictly `peak > after`. |

**Window and search contracts:**

- Event windows are half-open `[startUtc, endUtc)`; an event at `endUtc` belongs to the
  next window. Callers own all timezone/civil-day logic. Any window inside the
  supported interval is valid; cost is linear in window length (extrema-bracketed
  search, a few dozen position evaluations per day), and the suite carries a
  whole-range performance smoke so a full 151-year call stays a measured cost, not
  a guess. `startUtc ≥ endUtc` returns an empty list. Windows must lie inside the
  supported interval; any overlap outside is the out-of-range outcome.
- `nextLunarEclipse` is strictly after its argument (`peak > after`) and scans
  forward at most 2 years (some lunar eclipse, penumbral
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
- **Twilight** — USNO's one-day service reports civil twilight only; nautical and
  astronomical crossings are checked against a dedicated Horizons airless-altitude
  fine grid (1-minute steps around twilight), an independent ephemeris rather than
  self-consistency.
- **Contact shapes** — the contact fixtures span all three kinds: a total eclipse
  (U2/U3 present), a partial (U1/U4 but no U2/U3), and a penumbral (P1/P4 only), so
  absent-contact cases are asserted, not assumed.
- **Tolerances are data**, in fixture metadata: sun ≤ 1′, moon ≤ 1′, event times
  ≤ 60 s, eclipse peak and contact times ≤ 60 s, eclipse magnitudes ≤ 0.03.
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
  external fixtures arbitrate which port is wrong. Replacing the committed corpus
  requires **both** ports to regenerate byte-identical quantized output — a corpus
  only one port can reproduce is that port smuggled back in as the oracle.

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
