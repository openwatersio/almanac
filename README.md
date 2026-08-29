# Almanac

Offline sun & moon engine for the Salish Sea and everywhere else — positions,
rise/set/twilight, moon phase, and lunar eclipses (solar planned), computed from pure
geometry with zero network and zero runtime data files.

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

## Usage

### TypeScript

```bash
npm install @openwaters/almanac
```

```ts
import { nextLunarEclipse, lunarEclipseVisibility, sunEvents } from '@openwaters/almanac';

const observer = { latitudeDeg: 48.5, longitudeDeg: -123.0 };

const eclipse = nextLunarEclipse(new Date());
const visibility = lunarEclipseVisibility(eclipse, observer);
console.log(eclipse.kind, eclipse.peak, visibility.visibleAtPeak);

const today = new Date();
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
for (const { kind, time } of sunEvents(today, tomorrow, observer)) {
  console.log(kind, time.toISOString());
}
```

### Swift

```swift
.package(url: "https://github.com/openwatersio/almanac.git", exact: "0.1.0")
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
```

### Performance

Event searches (`sunEvents`/`moonEvents`) are linear in window length. The full
151-year supported interval is a measured cost, not a guess: ~68 s in TypeScript,
~44 s in Swift release builds. Chunk or worker a full-range call rather than
running it inline.
