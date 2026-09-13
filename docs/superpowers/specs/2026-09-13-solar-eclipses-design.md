# Solar eclipses for one observer

Almanac gains a local solar eclipse search and an instantaneous obscuration query, in both ports, translated from the pinned Astronomy Engine commit. The consumer is Slackwater (slackwater-ios#307): the sky view draws the Moon over the Sun and darkens by the covered fraction during a real eclipse, and the strip, schedule, and Moon sheet give solar eclipses the treatment lunar eclipses already have.

## Scope

In:

- `nextSolarEclipse`, `previousSolarEclipse`, and `solarEclipses`, each taking an observer, returning the eclipse's kind, peak obscuration, the four contacts, and the Sun's altitude at each.
- `solarObscuration(time, observer)`: the fraction of the Sun's disc covered at that instant.
- External fixtures from USNO local circumstances and the Espenak solar catalog, parity cases, benchmark workloads, contract and roadmap updates.

Out, until a consumer asks:

- The global search (peak instant with no observer, and where the shadow axis lands). The roadmap keeps it as a boundary.
- Eclipse magnitude (fraction of the Sun's diameter covered). One line when someone prints it.
- A hybrid kind. Hybrid is a global classification; one observer sees total or annular.
- Safe-viewing guidance. The contract already says visibility is geometric.

## Public surface

```ts
type SolarEclipseKind = 'partial' | 'annular' | 'total';

interface SolarEclipse {
  kind: SolarEclipseKind;
  /** Fraction of the Sun's disc area covered at peak; exactly 1 for a total eclipse. */
  obscuration: number;
  /** First contact: the partial phase begins. */
  c1: Date;
  /** Second contact: the total or annular phase begins; null for a partial eclipse. */
  c2: Date | null;
  /** Closest approach of the Moon's shadow axis to the observer. */
  peak: Date;
  /** Third contact: the total or annular phase ends; null for a partial eclipse. */
  c3: Date | null;
  /** Fourth contact: the partial phase ends. */
  c4: Date;
  /** Refracted topocentric altitude of the Sun's centre at each contact, degrees; null exactly where the contact is absent. */
  sunAltDeg: { c1: number; c2: number | null; peak: number; c3: number | null; c4: number };
}

function nextSolarEclipse(after: Date, observer: Observer): SolarEclipse;
function previousSolarEclipse(before: Date, observer: Observer): SolarEclipse;
function solarEclipses(startUtc: Date, endUtc: Date, observer: Observer): SolarEclipse[];
function solarObscuration(time: Date, observer: Observer): number;
```

Swift mirrors the names with argument labels `after:observer:`, `before:observer:`, `from:to:observer:`, and `at:observer:`. `SolarEclipseKind` is an enum, `c2` and `c3` are optionals, `sunAltDeg` is a nested struct with the same five fields, and every function throws the same `AlmanacError` cases the lunar functions do.

The altitude at each contact is the number `sunAltAz` returns for that instant, so "above the horizon" in a result agrees with the Sun the consumer draws. There is no separate visibility function: the eclipse is already the observer's.

`solarObscuration` returns 0 when the apparent discs do not overlap, the ratio of the disc areas when the Moon sits inside the Sun's disc (annular), 1 when the Sun is fully covered, and the lens overlap fraction between. It is purely geometric and does not test the horizon; a consumer that draws the Sun already knows whether it is up. It is cheap enough to call per frame: one Sun vector, one Moon vector, one observer vector.

## Algorithm

New files `typescript/src/solar.ts` and `swift/Sources/Almanac/Solar.swift`. The lunar file keeps its name and content; its `ShadowInfo` regains upstream's `target` and `dir` fields and `calcShadow` is shared. Each translated function cites its upstream location in `source/js/astronomy.ts` at commit `865d3da7d8112bbc7911238052c6af4aaf877181`:

| This package | Upstream | Notes |
| --- | --- | --- |
| `localMoonShadow(ut, observer)` | `LocalMoonShadow` ~8494 | Lunacentric observer against the heliocentric Moon. The observer's geocentric vector is `observerGeoVectorOfDate` gyrated to J2000, which is upstream's `geo_pos`. |
| `peakLocalMoonShadow(newmoonUt, observer)` | `PeakLocalMoonShadow` ~8587 | Ascending zero of the axis-distance slope inside ±0.2 day. |
| `localPartialDistance`, `localTotalDistance` | ~9126, ~9130 | The total variant takes `|k|` so annular eclipses work. |
| `localEclipse(shadow, observer)` | `LocalEclipse` ~9137 | Partial contacts inside ±0.2 day, total contacts inside ±0.01 day. |
| `localEclipseTransition` | ~9165 | Shared root finder, 1 s tolerance, 20 iterations. |
| `eclipseKindFromUmbra(k)` | `EclipseKindFromUmbra` ~8834 | Keeps upstream's 14 m bias, which matches Espenak. |
| `obscuration(a, b, c)` | `Obscuration` ~8622 | Two-disc overlap. |
| `solarEclipseObscuration(hm, lo)` | `SolarEclipseObscuration` ~8670 | Uses `MOON_POLAR_RADIUS_KM` (1736.0) and `SUN_RADIUS_AU`. |
| contact altitude | `SunAltitude` ~9181 | This package's `sunAltAz`. |
| new-moon loop | `SearchLocalSolarEclipse` ~9211 | Prune at 1.8° ecliptic latitude; a candidate is an eclipse when `shadow.r < shadow.p`. |

`solarObscuration` evaluates the observer-centred geometry at the instant and returns the two-disc overlap directly, without upstream's 0.9999 clamp. The clamp exists upstream only because that function is never called for a total eclipse.

Departures from upstream, all documented in the file header as the lunar port does:

1. The new-moon probe is this package's `searchMoonPhase(0, …)`, which uses apparent longitudes. It only seeds the peak search, so the difference cannot change a result.
2. Previous and range searches, the fixed whole-UT-day new-moon seed, and the 100 ms same-eclipse band come from the lunar port. Upstream only searches forward.
3. Night filter. Upstream keeps an eclipse when the Sun's centre is above the horizon at C1 or C4. This port also accepts the peak, so a short polar day between C1 and C4 is not dropped. A day that starts after C1 and ends before the peak still drops; the code marks that ceiling with a `ponytail:` comment naming a sunrise search as the upgrade.
4. No scan limit. Next and previous walk new moons to the supported boundary and then throw out-of-range. A place can go years without a visible solar eclipse, so the lunar two-year guard does not apply. A pruned new moon costs one Moon evaluation, so the cost tracks the real gap.

## Search semantics

- The peak is the closest approach of the Moon's shadow axis to the observer, not greatest eclipse. Range membership and the same-eclipse band use it.
- `solarEclipses` returns every eclipse this observer can see whose peak is in `[startUtc, endUtc)`, sorted by peak. Contacts may fall outside the window. The scan margin is ±0.2 day because the local peak can be that far from the new moon.
- Next and previous are strict, skip peaks within 100 ms of the anchor, and reach the supported boundary as the out-of-range outcome.
- Candidate peaks use a fixed whole-UT-day seed so search direction and window boundaries do not shift the returned millisecond. Adjacent ranges can split at a returned peak without losing or duplicating it.
- Validation order, bounded root finders, and TimeClip truncation follow the existing shared-behavior rules. A root finder exhausting its iterations is an implementation failure, not a result.

## Fixtures and tolerances

Two sources, both already in use. Their refresh scripts gain the new requests; raw responses, derived JSON, and metadata are committed together.

**USNO local circumstances** (`aa.usno.navy.mil/api/eclipses/solar/date`, coverage 1800 through 2050) for these eclipse-and-place pairs. The derive script reads what USNO reports; the labels here are expectations, not inputs.

| Eclipse | Place | Coordinates | Why |
| --- | --- | --- | --- |
| 2017-08-21 | Salem, Oregon | 44.94, -123.03 | Total, the Slackwater home latitude |
| 2024-04-08 | Victoria, British Columbia | 48.43, -123.37 | Partial, the Slackwater home waters |
| 2023-10-14 | Albuquerque, New Mexico | 35.08, -106.65 | Annular |
| 2012-05-20 | Redding, California | 40.59, -122.39 | Annular, late afternoon |
| 1979-02-26 | Goldendale, Washington | 45.82, -120.82 | Total, an earlier Delta-T polynomial piece |
| 2021-06-10 | Toronto, Ontario | 43.65, -79.38 | Partial already underway at sunrise: C1 below the horizon |
| 2020-12-14 | Pucón, Chile | -39.28, -71.95 | Total, southern hemisphere |
| 2044-08-23 | Calgary, Alberta | 51.05, -114.07 | Total near sunset, close to the USNO coverage limit |

Each case checks kind, every contact time, the altitude at every contact, and peak obscuration.

**Espenak solar catalog** (`SE1901-2000.html` and `SE2001-2100.html`) for every eclipse from 1950 through 2100. UT is TD minus the catalog's Delta-T, as the lunar fixture does. The observer is the catalog's whole-degree greatest-eclipse coordinates, which put it up to about 80 km off the axis. Per-row checks:

- `solarObscuration` at the catalog instant: about 1 for total rows, about magnitude squared for annular rows, above zero for partial rows. The annular check holds because the disc-area ratio does not depend on where inside the Sun's disc the Moon sits.
- For central total, annular, and hybrid rows the search must find the eclipse with a peak inside tolerance and the peak altitude within 2° of the catalog's Sun altitude.
- Kind must match the catalog when the path is at least 200 km wide. Narrower paths also accept partial, because the coordinate rounding can place the observer outside the path. Hybrid rows accept total or annular.
- Partial rows and non-central rows (second type letter `+` or `-`) skip the search checks. Their greatest-eclipse point is on the terminator, where the night filter's answer is not evidence of anything.
- Night filter: for each central row with `|gamma|` below 0.25, the antipode of the greatest-eclipse point lies inside the penumbra geometrically (its axis distance is about twice gamma times the Earth's radius) but has the Sun below the horizon throughout. `solarObscuration` there is above zero, and the search must return no eclipse for that new moon. Rows with larger gamma put the antipode outside the penumbra, where a miss proves nothing about the filter.

**Parity corpus** gains solar cases: several observers and windows for the range search, next and previous anchors, and obscuration samples through an eclipse. Both suites compare decoded values under the existing 5-scaled-unit and 1-time-quantum rule.

New contract tolerance rows:

| Quantity | Tolerance |
| --- | ---: |
| Solar eclipse contacts (C1 to C4) | 60 seconds |
| Solar eclipse peak | 5 minutes |
| Solar eclipse obscuration | 0.01 |
| Sun altitude at a contact | 0.5° |

The peak is looser than the contacts because the axis-distance curve is flat at its minimum, so the root of its derivative is ill-conditioned while the contacts are steep crossings. Upstream's own test allows 7.7 minutes for the local peak, and the whole-degree catalog coordinates alone are worth about 3 minutes at the shadow's ground speed. Altitude gets 0.5° because 60 seconds of contact error is at most 0.25° of altitude.

The residuals are measured before these rows are fixed in the contract. If the model is worse than a row, that is a finding to report with numbers, not a tolerance to loosen.

## Tests

Both suites, in the same structure:

- Every USNO case and every catalog row, with the rules above.
- Seed determinism: splitting a range at a returned peak yields the same peaks, no more and no fewer.
- The same-eclipse band: next from a returned peak skips it; next from 101 ms before it returns it.
- Night filter: an eclipse whose Sun is below the horizon at C1, peak, and C4 is not returned; one with the Sun up only at C4 is.
- Boundary: next from late 2100 and previous from early 1950 throw out-of-range once the boundary is reached without an eclipse.
- `solarObscuration` is 0 a day away from any eclipse, 1 between C2 and C3 of a total eclipse, and between 0 and 1 at a partial peak.
- Validation order: an invalid observer with an empty window throws rather than returning an empty list.
- `PublicSurfaceTests.swift` constructs or calls every new symbol with plain `import Almanac`.

## Benchmarks

New workloads in `benchmarks/cases.json`: next solar eclipse, an occupied and an empty 228-hour window, the full 1950 through 2100 range for the fixed observer, and `solarObscuration` over the 228-hour sky track. The comparison fails on a workload the base revision cannot run, and no older revision can emulate a solar search the way the runners emulate the previous-eclipse API with a forward loop. The workloads therefore land in the release pull request, whose base already carries the API, not in the feature pull request.

## Documentation

- `docs/CONTRACT.md`: four API rows, the shape paragraph, shared-behavior rows for the local peak definition, the night filter, and the boundary walk, fixture-evidence bullets for both sources, and the tolerance rows.
- `docs/ROADMAP.md`: the local search and obscuration move to Included. The global search, path classification, and safe-viewing guidance stay as boundaries.
- `README.md`: a usage snippet for both ports beside the lunar one.
- `typescript/src/index.ts` allow-list.

## Delivery

One feature pull request carrying both ports, fixtures, parity, and docs, with `typescript`, `swift`, and `fixtures` checks green. A separate release pull request adds the benchmark workloads, bumps the version to 0.4.0, and tags it, following the existing release process. After the release: slackwater-ios#307 for the sky drawing, and a follow-up issue there for the strip, schedule, and Moon sheet.
