# Contributing

Almanac is a twin-port library with one behavior implemented by hand in TypeScript and Swift. The [public contract](docs/CONTRACT.md) defines that behavior, and the fixture corpus is the authority both ports answer to. Read the contract before changing public behavior.

## Repository status

Almanac follows the Open Waters Tier 3 repository baseline for a maintained public utility. Tier 3 requires pull requests and the `typescript`, `swift`, and `fixtures` status checks, with no approving review required. Almanac is listed in the organization profile because external Swift and npm consumers use it; that profile listing is a visibility exception rather than a recorded tier promotion. Promotion to another tier requires an explicit organization decision.

The shared organization guidance is in the [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md), [agent instructions](https://github.com/openwatersio/.github/blob/main/docs/agents/agent-instructions.md), [npm release conventions](https://github.com/openwatersio/.github/blob/main/docs/agents/npm-releases.md), and [writing conventions](https://github.com/openwatersio/.github/blob/main/docs/agents/writing-style.md).

## Layout

- `typescript/` contains the npm package and the leading implementation.
- `swift/` contains the SwiftPM package and mirrors the TypeScript implementation.
- `fixtures/` contains raw upstream evidence, derived fixtures, and the parity corpus used by both ports.
- `benchmarks/` contains the shared correctness-preserving performance harness.
- `docs/` contains the public contract and scope.
- `Package.swift` is the root manifest used by Git URL SwiftPM consumers.
- `.github/workflows/ci.yml` runs pull request and main-branch checks.
- `.github/workflows/release.yml` tests, smoke-tests, and publishes tagged releases.

## Twin-port contract

- Every behavior change lands in both ports in the same change series. TypeScript leads, and Swift follows function by function with the same structure and operation order. The parity corpus compares the implementations near exactly at about `1e-5°`.
- Astronomy algorithms are translated from Astronomy Engine at pinned commit `865d3da7d8112bbc7911238052c6af4aaf877181`. Copy coefficient tables from that source and cite the upstream function above each translation.
- The public API is the table in [the contract](docs/CONTRACT.md#public-api). TypeScript exports only through the curated allow-list in `typescript/src/index.ts`. Swift access control is the export gate, and `PublicSurfaceTests.swift` must construct or call every public symbol using plain `import Almanac`. A public-surface change updates the contract table, both ports, that test, and usually the parity corpus.
- Test tolerances are normative. Do not loosen a tolerance to make a test pass. A resistant fixture means the implementations differ in operation order, a constant, or TT/UT handling, or that the fixture design needs a spec decision.
- Regenerate parity data with `fixtures/generate/parity.mjs`. The Swift reproduction test must still pass. Comparisons decode values with a tolerance of 5 scaled units or 1 time quantum to accommodate cross-platform `libm` ULP noise; they do not compare serialized bytes.

## Astronomy constraints

- Coarse position fixtures carry TT values. Delta-T projections differ between Espenak–Meeus and the frozen Horizons values by about 5.9 seconds today and 134 seconds at 2100. Roughly 6 seconds in a current UT event comparison is the Delta-T model floor. USNO grid rows after 2050 assert scatter about a per-date mean for the same reason.
- `moonPhaseDeg` takes TT days. Passing UT compiles and shifts the result by about 35 arcseconds.
- `FLAT_CYCLE_LATITUDE_DEG = 85` prevents rise and set events from disappearing when the altitude cycle flattens. Keep the brute-force flattening-band oracle test in both ports.
- `SAME_ECLIPSE_MS = 100` makes next and previous eclipse searches strict around the anchor. Range searches use exact half-open bounds. Keep the fixed full-moon seed so adjacent ranges agree on the peak.
- Every public entry point applies TimeClip truncation toward zero to integer milliseconds. Swift must not use floor.
- Swift tests run in release mode because debug builds exceed the performance smoke limits. The tests do not use `assert()` or `precondition()`, so release builds retain their test semantics.

## Development checks

CI defines the toolchain: `actions/setup-node` selects Node 22 for tests, and `macos-15` supplies Swift (6.1.2 in the current runner image). Local `mise.toml` mirrors those versions. Update it when CI changes; workflows do not read it. The npm packaging and publishing jobs use Node 24 for trusted publishing.

For local setup, mise 2026.9.1 or newer provides the core Swift backend:

```bash
mise install
```

Swift also needs the matching Xcode SDK. The `macos-15` runner uses Xcode 16.4 and the macOS 15.5 SDK. Select that Xcode installation with `DEVELOPER_DIR` when reproducing CI locally, for example `export DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer`. Mise installs the compiler, not Xcode or its SDK; Swift 6.1.2 cannot compile against the Xcode 26.5 SDK.

Run the correctness, dependency, and package checks from the repository root:

```bash
(
  cd typescript
  mise exec -- npm ci
  mise exec -- npm run build
  mise exec -- npm test
  mise exec -- npm audit
  mise exec -- npm pack --dry-run
)
mise exec -- swift test -c release
mise exec -- node fixtures/generate/derive.mjs --check
mise exec -- node fixtures/generate/parity.mjs --check HEAD HEAD
mise exec -- node --test benchmarks/compare.test.mjs
```

The TypeScript suite includes the full-range performance smokes. `npm pack --dry-run` runs `prepack`, which stages `README.md`, `LICENSE`, and `NOTICE` inside `typescript/`; these generated copies are not repository files and must not be committed.

Fixture refresh scripts named `refresh-*.mjs` are the only fixture scripts that use the network. Run them manually, commit raw responses, derived fixtures, and metadata together, and record request URLs in the metadata files.

## Performance

Install the pinned tools and TypeScript dependencies, then run the shared benchmark from the repository root:

```bash
mise install
mise exec -- npm ci --prefix typescript
mise exec -- node benchmarks/run.mjs --base origin/main
```

The command benchmarks the current working tree, including uncommitted edits, against the selected Git revision. Omit `--base` to compare against `HEAD`. Use `--port typescript` or `--port swift` to run one port. Swift always builds in release mode, and no extra benchmark dependencies are needed.

Both revisions use the current harness, inputs, compiler, and machine. The baseline is exported to a temporary directory, so it can predate the harness and the command never switches your checkout. Builds, fixture loading, date parsing, and process startup are outside the measurements. Each workload gets seven pairs of base and candidate processes, alternating which revision runs first. Every process warms up for 300 milliseconds; the first pair calibrates batch sizes to at least 100 milliseconds and later pairs reuse them.

The table reports median latency and percentage change for every workload. A median slowdown above 20 percent fails the command and CI job; use `--threshold 10` to test another limit locally. Small changes can be timing noise, so keep the machine idle and repeat a suspicious run. The threshold is a policy limit, while correctness and parity tests remain the accuracy gates.

The shared inputs in [`benchmarks/cases.json`](benchmarks/cases.json) cover positions, a 228-hour sky track, short, year, and polar event windows, full-range phases, and lunar eclipses. Eclipse workloads measure next and previous search, occupied and empty 228-hour windows, and the full 1950 through 2100 range. Both runners use native backward and range APIs when available. Older revisions fall back to forward loops with a 400-day lookback so the workloads remain comparable. Swift detects API availability from the public declaration in `Eclipse.swift`; keep that detection current if the declaration moves or changes format.

Raw samples, iteration counts, output checksums, Git revisions, harness hash, and machine and toolchain metadata are saved under `.benchmarks/<timestamp>/` with `summary.md`. Set `--output directory` for a predictable location. Compare saved reports from the same environment and harness with:

```bash
mise exec -- node benchmarks/compare.mjs base-typescript.json candidate-typescript.json 20
mise exec -- node --test benchmarks/compare.test.mjs
```

CI compares a pull request merge result with its target branch base SHA, or a main push with the previous main SHA. Each port builds both revisions and interleaves their measurements in one job. CI publishes a timing table in the Actions summary and retains JSON and Markdown artifacts for 30 days, including on regressions. Missing workloads, invalid timings, changed outputs, and incompatible reports fail the comparison. The macOS performance job starts after the TypeScript performance job passes.

## Releasing

One version number spans both ports. A release starts with a Git tag, and the workflow handles the remaining steps.

1. Bump `version` in `typescript/package.json`. The release fails if the tag and manifest versions differ. Land the bump through a pull request because `main` is protected and its required checks must pass.
2. Create and push the version tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. [The release workflow](.github/workflows/release.yml) runs the full test matrix, builds a clean SwiftPM consumer for the tag, packs and smoke-tests the npm tarball, and publishes that same tarball with provenance.

npm publishing uses a trusted publisher bound to `openwatersio/almanac` and the workflow filename `release.yml`. Renaming that file breaks the binding. The repository contains no npm publishing token. Swift consumers pin the `vX.Y.Z` tag, and npm consumers install `@openwaters/almanac` from the registry.

Release tags matching `v*` reject updates and deletion. Repository administrators can bypass that rule for recovery. Do not move or recreate a published version tag during a normal release.

## Refreshing fixtures

`fixtures/raw/` holds verbatim responses from JPL Horizons, USNO, and NASA/Espenak. Derived JSON is regenerated offline from those responses. Run the relevant `fixtures/generate/refresh-*.mjs` script, then `node fixtures/generate/derive.mjs`, and commit the raw responses, derived data, and metadata together. Widening the supported interval from 1950 through 2100 requires boundary fixtures first because the interval is defined by the available evidence.
