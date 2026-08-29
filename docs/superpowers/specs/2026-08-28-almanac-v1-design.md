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
- All timestamps are civil labels interpreted as **UT1-like**. In the leap-second
  era (1972 – present) that costs |UT1−UTC| < 0.9 s, far inside the ±60 s event
  tolerance. Pre-1972 labels are proleptic. Post-leap-second civil UTC (the 2026
  CGPM draft makes UTC continuous from 2027, permitting DUT1 up to 3600 s) may
  diverge by an amount unknowable today — **future civil-UTC error from unknown DUT1
  is outside the accuracy promise**; results remain UT1-accurate. No leap-second or
  DUT1 table ships; caller-supplied DUT1 arrives only if a consumer needs exact
  future civil time. ΔT itself is a projection past the present: Espenak–Meeus
  reaches ~205 s at 2100 where JPL Horizons freezes ~69 s — far-future UT-labeled
  positions inherit whichever projection is wrong, which is why position fixtures
  compare in TT.
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
- **Coordinate semantics** — geocentric RA/dec are **apparent**: true equator/equinox
  of date with nutation and aberration applied, exactly the upstream
  `Equator(body, date, observer, ofdate: true, aberration: true)` transform.
  Ecliptic-of-date quantities exist internally (phases, eclipses) but are not public:
  no consumer needs them and no fixture independently checks them — public fields
  without an external oracle don't ship.
- **Distances** — moon in km; sun in AU.
- **Refraction** — the translated upstream `Refraction('normal')` formula, including
  its below-horizon taper, at fixed sea-level standard atmosphere (no
  pressure/temperature inputs in v1). It yields ≈ 34′ at the horizon; that constant
  by itself is only the folded rise/set threshold, not the refraction function.
- **Sun rise/set** — unrefracted geometric center altitude at −(34′ + true solar
  semidiameter at distance): the upper-limb convention with the actual disc, symmetric
  with the moon's rule and matching USNO practice (a fixed 16′ SD sits ~10″ off USNO
  near aphelion/perihelion — measurable on high-latitude grazes). Twilights: center
  altitude −6°/−12°/−18°, no refraction term.
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
| `sunPosition(time)` | instant | `raDeg, decDeg, distanceAu` — geocentric apparent, equator of date |
| `moonPosition(time)` | instant | `raDeg, decDeg, distanceKm` — geocentric apparent, equator of date |
| `sunAltAz(time, observer)` | instant, Observer | `azDeg, altDeg` — topocentric, refracted |
| `moonAltAz(time, observer)` | instant, Observer | `azDeg, altDeg` — topocentric (parallax applied), refracted |
| `moonIllumination(time)` | instant | `fraction` [0,1], `phaseAngleDeg` [0,180] (0 = full, 180 = new; `fraction = (1 + cos θ)/2`), `phase` [0,1) (0 new, 0.5 full), `waxing` |
| `sunEvents(startUtc, endUtc, observer)` | half-open window, Observer | sorted `[{time, kind}]`, kind ∈ rise, set, civilDawn/Dusk, nauticalDawn/Dusk, astroDawn/Dusk, transit; empty list is valid (polar day/night drops crossings; transit still reported) |
| `moonEvents(startUtc, endUtc, observer)` | half-open window, Observer | sorted `[{time, kind}]`, kind ∈ rise, set |
| `searchMoonPhases(startUtc, endUtc)` | half-open window | sorted `[{time, phase}]`, phase ∈ new, firstQuarter, full, lastQuarter |
| `nextLunarEclipse(after)` | instant | `LunarEclipse` (fields per the eclipse convention above) or the out-of-range outcome |
| `lunarEclipseVisibility(eclipse, observer)` | LunarEclipse, Observer | `visibleAtPeak`, `moonGeometricAltAtPeakDeg` (unrefracted), per-contact visibility flags; the eclipse argument is structurally validated (finite times, contact chronology, kind ↔ contact shape) |

**Cross-port contract** (identical in both ports):

| Concern | Rule |
|---|---|
| Instant precision | Every input and returned instant is normalized to integer epoch milliseconds by **truncation toward zero** (ECMAScript TimeClip — what JS `Date` already did to its input; Swift must match it, not floor, or negative sub-ms tails diverge). Foundation's sub-ms precision never reaches the math or the results. |
| Non-finite input | Any NaN/±∞ number, or a TS invalid `Date`, is a validation error (invalid `Date` is TS-only; Swift `Date` cannot be invalid). |
| Out-of-interval time | TS `AlmanacOutOfRangeError` ↔ Swift `AlmanacError.outOfRange`. |
| Invalid observer/argument | TS `RangeError` ↔ Swift `AlmanacError.invalidObserver` / `.invalidArgument`. |
| Reversed/empty window | `startUtc ≥ endUtc` → empty list, no error. |
| Validation precedence | Arguments are validated (finite, observer ranges, interval containment) **before** the empty/reversed-window short-circuit — a garbage argument never returns a clean empty list. |
| Window end | Instants validate on `[min, max)`; a **window end** validates on `[min, max]`, so the exact full-range window `[min, max)` is legal. |
| Search anchor | `nextLunarEclipse(after)`: strictly `peak > after`, with a 100 ms same-eclipse band — a candidate peak within 100 ms of `after` is treated as the eclipse the caller already has and is skipped, never returned again; the ceiling is documented in both ports and can never skip a distinct real eclipse (minimum catalog gap 29 d). |

**Window and search contracts:**

- Event windows are half-open `[startUtc, endUtc)`; an event at `endUtc` belongs to the
  next window. Callers own all timezone/civil-day logic. Any window inside the
  supported interval is valid; cost is linear in window length (extrema-bracketed
  search, a few dozen position evaluations per day), and the suite carries a
  whole-range performance smoke so a full 151-year call stays a measured cost, not
  a guess (measured: full-range phases ~0.6 s; full-range sun+moon events ~68 s,
  smoke bound 120 s). `startUtc ≥ endUtc` returns an empty list. Windows must lie inside the
  supported interval; any overlap outside is the out-of-range outcome.
- `nextLunarEclipse` is strictly after its argument (`peak > after`), with a 100 ms
  same-eclipse band: a candidate peak landing within 100 ms of `after` is judged the
  same eclipse the caller already has and is skipped rather than returned again — the
  band is documented in both ports' source and cannot skip a distinct real eclipse
  (the catalog's minimum gap between consecutive lunar eclipses over 1950–2100 is 29
  days, ~25 million times the band). It scans forward at most 2 years (some lunar
  eclipse, penumbral included, always occurs within ~6 months); a scan crossing the
  supported-interval end returns the out-of-range outcome (TS: typed error; Swift:
  typed throw).
- Internal iteration caps exist on every root-finder; hitting one is a bug, asserted
  never to occur across the whole fixture corpus.

## Fixture corpus

`fixtures/` is the authority both ports answer to. Every fixture directory carries
`meta.json`: source name and version, the exact request (URL + parameters), and the
retrieval date. Raw responses are committed, so git itself is their integrity hash.

- **Positions** — sun/moon RA/dec/distance across 1950–2100, from the JPL Horizons API
  (deliberately not generated from Astronomy Engine). Raw responses committed under
  `fixtures/raw/`. The 151-year coarse files are **TT-labeled** (`TIME_TYPE='TT'`)
  and compared through the models' TT entry points: Horizons freezes ΔT at its
  present value for future dates while this library projects Espenak–Meeus
  (~205 s by 2100), so a UT-labeled comparison would measure that ΔT-model
  disagreement (~75″ of lunar motion), not astronomy. The 2026 dense files stay
  UT-labeled and exercise the public UTC API. Measured ΔT divergence (Espenak–Meeus
  − Horizons): −40 s at 1950, **+5.9 s at 2026** (EM's 2005–2050 parabola over-predicts
  the present; real ΔT ≈ 69 s), +45 s at 2060, +134 s at 2100. At 2026 that costs the
  dense moon tests ~2–3″ of their 60″ budget, and it costs every UT-based event
  comparison (USNO fixtures) ~6 s of its 60 s budget before any astronomy happens —
  a known, bounded floor, not a bug to chase.
- **Events** — USNO rise/set/twilight across a latitude grid including polar edge
  cases; USNO moon-phase catalog.
- **Lunar eclipses** — Espenak Five Millennium catalog subset (1950–2100): types,
  greatest-eclipse times, magnitudes; plus spot-checked contact times.
- **Twilight** — USNO's one-day service reports civil twilight only; nautical and
  astronomical crossings are checked against a dedicated Horizons airless-altitude
  fine grid (1-minute steps around twilight), an independent ephemeris rather than
  self-consistency.
- **Far-future event rows** — USNO fixtures are UT-based, so grid rows after 2050
  measure ΔT-projection disagreement (Espenak–Meeus vs USNO's model: ~43 s at 2075,
  ~85 s at 2098) on top of astronomy. Rows ≤ 2050 assert absolute ≤ 60 s; later rows
  assert scatter about their per-date mean offset ≤ 60 s, with the mean itself
  bounded as documented ΔT divergence — the same quarantine the TT position fixtures
  apply, adapted to a UT-only source.
- **Moon-phase definition** — phase events and `moonIllumination.phase` both use
  **apparent** geocentric ecliptic longitudes (aberration + nutation), matching the
  USNO/almanac definition of syzygy; upstream Astronomy Engine's geometric-sun
  elongation is a deliberate, documented departure (it sits a flat ~40 s off USNO).
- **Contact shapes** — the contact fixtures span all three kinds: a total eclipse
  (U2/U3 present), a partial (U1/U4 but no U2/U3), and a penumbral (P1/P4 only), so
  absent-contact cases are asserted, not assumed.
- **Tolerances are normative values, enforced by both test suites**: sun position
  ≤ 1′, sun distance ≤ 1e-4 AU, moon position ≤ 1′, moon distance ≤ 70 km (the
  Montenbruck–Pfleger lunar theory shows a measured mean −27.3 ppm scale bias
  versus JPL ephemerides plus a periodic residual up to ~−139 ppm, max |Δ| 53.3 km
  — model-inherent, reproduced by the reference implementation; angular accuracy
  is unaffected), event times ≤ 60 s, eclipse peak and contact times ≤ 60 s,
  eclipse magnitudes ≤ 0.03. Only the positions/altaz fixtures carry their angular
  tolerance in `meta.json` (`toleranceArcmin`); the rest of this list is pinned as
  constants in the test suites, not read from fixture metadata. The parity
  corpus's own tolerances (`fixtures/parity/meta.json`) are a separate, tighter
  concern — they bound cross-port drift below these physical values and are read
  by both ports' parity tests.
- `fixtures/generate/` scripts run **offline** from the committed raw responses;
  `--check` fails on drift between raw and derived. A separate explicit `refresh`
  command is the only thing that touches the network.

## Parity corpus

External fixtures decide correctness; the parity corpus catches port drift below
physical tolerances, symmetrically:

- `fixtures/parity/` holds canonical inputs and quantized outputs (angles to 1e-6°,
  distances to 1e-3 km / 1e-9 AU, times to 1 ms) densely sampled across the interval.
- The corpus format is canonical — fixed row order, quantized values stored as
  scaled integers, provenance in a separate uncompared meta file — so both ports can
  reproduce it exactly. CI compares **decoded structures**, not serializer bytes
  (key order and float formatting can't fail a correct port), and runs both
  emitters against the committed corpus — which CI separately byte-checks against a
  fresh TS regeneration, so the committed corpus IS the TS candidate and the two
  legs together compare the ports against each other. Neither port is
  the oracle: external fixtures arbitrate any mismatch, and replacing the corpus
  requires both ports to reproduce it — a corpus only one port can regenerate is
  that port smuggled back in as the oracle. Every public function appears in the
  corpus, including `searchMoonPhases` and `lunarEclipseVisibility`.

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
