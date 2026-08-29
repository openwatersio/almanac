# AGENTS.md — working in this repo

Almanac is a **twin-port** library: one behavior, two hand-written implementations
(`typescript/`, `swift/`). The design spec is the binding contract —
`docs/superpowers/specs/2026-08-28-almanac-v1-design.md` — and the fixture corpus is
the authority the code answers to. Read the spec before changing any public behavior.

## The rules that keep the ports honest

- **Every behavior change lands in BOTH ports, same change series.** TypeScript leads,
  Swift follows function-per-function with the same structure and operation order —
  the parity corpus compares the two at ~1e-5° and will fail on a port that drifts.
- **Translation rule.** The astronomy is translated from Astronomy Engine at pinned
  commit `865d3da7d8112bbc7911238052c6af4aaf877181`. Never retype coefficient tables
  from memory — copy them from the pinned file and cite the upstream function in a
  comment above each translation.
- **Public API = the spec's table.** TS exports only through the curated allow-list in
  `typescript/src/index.ts`; in Swift, access control *is* the export gate, and
  `PublicSurfaceTests.swift` (plain `import Almanac`, no `@testable`) must construct
  or call every public symbol. A public-surface change touches the spec table, both
  ports, that test, and usually the parity corpus.
- **Tolerances are normative in the test suites.** Never loosen one to go green.
  If a fixture row resists, the divergence is real (op order, a constant, tt/ut) —
  or the fixture design is wrong, which is a spec question, not a test edit.
- **Parity corpus changes follow the both-ports rule.** Regenerate with
  `fixtures/generate/parity.mjs`, and the Swift reproduction test must still pass —
  a corpus only one port can reproduce is that port smuggled back in as the oracle.
  Comparisons are decoded near-exact (5 scaled units / 1 time quantum — cross-platform
  libm ULP noise is real), never serializer bytes.

## Gotchas that each cost a debugging cycle

- **TT vs UT fixtures.** Coarse position fixtures are TT-labeled (rows carry `tt`);
  ΔT projections diverge between sources (Espenak–Meeus vs Horizons frozen ≈ +5.9 s
  today, +134 s at 2100). ~6 s of any UT event comparison is ΔT-model floor — a known
  bounded offset, not a bug to chase. USNO grid rows > 2050 assert scatter about a
  per-date mean for the same reason.
- **`moonPhaseDeg` takes TT days.** Passing UT compiles silently and costs ~35″.
- **`FLAT_CYCLE_LATITUDE_DEG = 85` is load-bearing and fails silently** — a too-narrow
  extremum bracket *drops* rise/set events. The brute-force flattening-band oracle
  test is the only thing that catches a regression there; keep it in both ports.
- **`SAME_ECLIPSE_MS = 100`** — `nextLunarEclipse` is strictly-after with a 100 ms
  same-eclipse band (peaks reproduce to ~1 ms across seeds). Both directions are
  documented at the constant.
- **Instants are TimeClip-truncated** (toward zero, integer ms) at every public entry
  in both ports; Swift must not floor.
- **Swift tests run release** (`swift test -c release`): debug-build perf smokes
  deterministically exceed their bounds; nothing uses `assert()`/`precondition()`,
  so release loses no test semantics.

## Commands

```bash
cd typescript && npm ci && npm test          # ~75 s (includes full-range perf smokes)
swift test -c release                        # ~60 s, from repo root
node fixtures/generate/derive.mjs --check    # offline fixture drift check
node fixtures/generate/parity.mjs --check A B  # near-exact parity reproduction check
```

Fixture `refresh-*.mjs` scripts are the only things that touch the network; run them
manually, commit raw + derived together, and record request URLs in the meta files.

Release process: see [CONTRIBUTING.md](CONTRIBUTING.md).
