# Almanac

Offline sun & moon engine for the Salish Sea and everywhere else — positions,
rise/set/twilight, moon phase, lunar eclipses (solar planned), and where any fixed
star stands from a catalog position, computed from pure geometry with zero network
and zero runtime data files.

Twin implementations, one behavior:

- `swift/` — SwiftPM package `Almanac`
- `typescript/` — npm `@openwaters/almanac`
- `fixtures/` — the shared test corpus (JPL Horizons, USNO, Espenak) both suites
  must pass; the contract that keeps the ports identical

Supported interval: 1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z; results outside it
raise a typed error. All instants are UT1-accurate, not civil-UTC-accurate in the far
future — see the design spec's Conventions section for what that means and why.

- Design: [`docs/superpowers/specs/2026-08-28-almanac-v1-design.md`](docs/superpowers/specs/2026-08-28-almanac-v1-design.md)
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md) — what ships next, and what will not.
- Landing page: [openwaters.io/sky](https://openwaters.io/sky) — the library running live in a browser.

Algorithms translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy)
(MIT, Don Cross) — see [NOTICE](NOTICE). MIT licensed.

## Performance

Almanac includes a shared performance harness for both ports: **15 workloads**
cover positions, a 228-hour sky track, short/year/polar event windows, full-range
moon phases, and next/previous/range eclipse searches, including empty windows.

The v0.2.1 optimizations reuse Moon and shadow geometry, flatten scratch arrays,
and refine altitude crossings with fewer position evaluations. In the
[hosted CI comparison](https://github.com/openwatersio/almanac/actions/runs/34119038860),
median query time fell relative to the v0.2.0 astronomy code:

| Workload | TypeScript: less time | Swift: less time |
| --- | ---: | ---: |
| Moon positions / 1,024 hours | 29.8% | 22.1% |
| Sky track / 228 hours | 40.0% | 42.4% |
| Sun events / 228 hours | 39.3% | 40.2% |
| Moon events / 228 hours | 39.1% | 35.1% |
| Previous lunar eclipse | 26.0% | 36.6% |
| Lunar eclipses / 1950–2100 | 26.4% | 23.4% |

TypeScript was measured on Ubuntu with Node 22; Swift used release builds on
macOS 15. Each comparison builds both revisions with the same harness and
toolchain, then takes seven interleaved process pairs with 300 ms warmup per
process. Build and startup time are excluded. Timings vary by machine; the shared
correctness fixtures and parity tolerances remain the accuracy gates.

Reproduce the comparison locally from the repository root (Node 22+ and Swift
5.9+):

```bash
npm ci --prefix typescript
node benchmarks/run.mjs --base v0.2.0
```

CI runs the harness on code changes and fails on **median regressions over 20%**.
Results include timing tables, raw samples, checksums, and revision/toolchain
metadata. See [the harness guide](CONTRIBUTING.md#performance) for choosing a
baseline, running one port, and inspecting reports.

Event searches scale with window length. Run a full 151-year sweep in a worker or
background task; use shorter windows for interactive queries.

## Usage

### TypeScript

```bash
npm install @openwaters/almanac
```

```ts
import { nextLunarEclipse, lunarEclipseVisibility, sunEvents, starAltAz } from '@openwaters/almanac';

const observer = { latitudeDeg: 48.5, longitudeDeg: -123.0 };

const eclipse = nextLunarEclipse(new Date());
const visibility = lunarEclipseVisibility(eclipse, observer);
console.log(eclipse.kind, eclipse.peak, visibility.visibleAtPeak);

const today = new Date();
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
for (const { kind, time } of sunEvents(today, tomorrow, observer)) {
  console.log(kind, time.toISOString());
}

// Betelgeuse from its J2000 catalog position: az/alt in degrees, refracted.
const { azDeg, altDeg } = starAltAz(88.792939, 7.407064, today, observer);
```

### Swift

```swift
.package(url: "https://github.com/openwatersio/almanac.git", exact: "0.2.1")
```

```swift
import Almanac
import Foundation

let observer = try Observer(latitudeDeg: 48.5, longitudeDeg: -123.0)

let eclipse = try nextLunarEclipse(after: Date())
let visibility = try lunarEclipseVisibility(eclipse, observer: observer)
print(eclipse.kind, eclipse.peak, visibility.visibleAtPeak)

let today = Date()
let tomorrow = today.addingTimeInterval(24 * 60 * 60)
for event in try sunEvents(from: today, to: tomorrow, observer: observer) {
  print(event.kind, event.time)
}

// Betelgeuse from its J2000 catalog position: az/alt in degrees, refracted.
let star = try starAltAz(raDeg: 88.792939, decDeg: 7.407064, at: today, observer: observer)
```

### Eclipse searches

Search for a previous eclipse or all eclipses in a time window:

```ts
import { previousLunarEclipse, lunarEclipses } from '@openwaters/almanac';
const last = previousLunarEclipse(new Date());
const eclipses = lunarEclipses(new Date('2026-08-24T00:00:00Z'), new Date('2026-09-02T12:00:00Z'));
```

```swift
let last = try previousLunarEclipse(before: Date())
let eclipses = try lunarEclipses(from: today, to: tomorrow)
```

Ranges include peaks at the start and exclude peaks at the end. Contacts may
extend outside the range. Previous/next searches skip peaks within 100 ms of the
anchor. Search results are global; apply `lunarEclipseVisibility` for an observer.
