# Almanac

Offline sun & moon engine for the Salish Sea and everywhere else — positions,
rise/set/twilight, moon phase, and lunar eclipses (solar planned), computed from pure
geometry with zero network and zero runtime data files.

Twin implementations, one behavior:

- `swift/` — SwiftPM package `Almanac`
- `typescript/` — npm `@openwatersio/almanac`
- `fixtures/` — the shared test corpus (JPL Horizons, USNO, Espenak) both suites
  must pass; the contract that keeps the ports identical

Design: [`docs/superpowers/specs/2026-08-28-almanac-v1-design.md`](docs/superpowers/specs/2026-08-28-almanac-v1-design.md)

Algorithms translated from [Astronomy Engine](https://github.com/cosinekitty/astronomy)
(MIT, Don Cross) — see [NOTICE](NOTICE). MIT licensed.
