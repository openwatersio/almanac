# Contributing

Almanac is a three-port library with one behavior implemented by hand in TypeScript, Swift, and Kotlin. The [public contract](docs/CONTRACT.md) defines that behavior, and the fixture corpus is the authority all three ports answer to. Read the contract before changing public behavior.

## Repository status

Almanac follows the Open Waters Tier 3 repository baseline for a maintained public utility. Tier 3 requires pull requests and the `typescript`, `swift`, `kotlin`, and `fixtures` status checks, with no approving review required. Almanac is listed in the organization profile because external Swift and npm consumers use it; that profile listing is a visibility exception rather than a recorded tier promotion. Promotion to another tier requires an explicit organization decision.

The shared organization guidance is in the [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md), [agent instructions](https://github.com/openwatersio/.github/blob/main/docs/agents/agent-instructions.md), [npm release conventions](https://github.com/openwatersio/.github/blob/main/docs/agents/npm-releases.md), and [writing conventions](https://github.com/openwatersio/.github/blob/main/docs/agents/writing-style.md).

## Layout

- `typescript/` contains the npm package and the leading implementation.
- `swift/` contains the SwiftPM package and mirrors the TypeScript implementation.
- `kotlin/` contains the Kotlin/JVM library and independent Gradle source consumer.
- `fixtures/` contains raw upstream evidence, derived fixtures, and the parity corpus used by all three ports.
- `benchmarks/` contains the shared correctness-preserving performance harness.
- `docs/` contains the public contract and scope.
- `Package.swift` is the root manifest used by Git URL SwiftPM consumers.
- `.github/workflows/ci.yml` runs pull request and main-branch checks.
- `.github/workflows/release.yml` tests, smoke-tests, and publishes tagged releases.

## Documentation

Keep lasting documentation in the repository: the public contract, supported scope, usage, and contributor guidance. Proposed work belongs in GitHub issues or pull requests. Plans, specs, task briefs, and spike output are temporary working documents; keep them in ignored `.superpowers/`. Before a release, remove any committed planning documents and promote decisions that describe shipped behavior into the relevant living document. A merged plan or spec is not evidence that behavior ships.

## Cross-port contract

- Every behavior change lands in all three ports in the same change series. TypeScript leads, and Swift and Kotlin follow function by function with the same structure and operation order. The parity corpus compares the implementations near exactly at about `1e-5°`.
- Astronomy algorithms are translated from Astronomy Engine at pinned commit `865d3da7d8112bbc7911238052c6af4aaf877181`. Copy coefficient tables from that source and cite the upstream function above each translation.
- The public API is the table in [the contract](docs/CONTRACT.md#public-api). TypeScript exports only through the curated allow-list in `typescript/src/index.ts`. Kotlin explicit API mode keeps helpers internal; `kotlin/smoke` exercises the public surface through a composite build. Swift access control is the export gate, and `PublicSurfaceTests.swift` must construct or call every public symbol using plain `import Almanac`. A public-surface change updates the contract table, all three ports, that test, and usually the parity corpus.
- Test tolerances are normative. Do not loosen a tolerance to make a test pass. A resistant fixture means the implementations differ in operation order, a constant, or TT/UT handling, or that the fixture design needs a spec decision.
- Regenerate parity data with `fixtures/generate/parity.mjs`. The Swift and Kotlin reproduction tests must still pass. Comparisons decode values with a tolerance of 5 scaled units or 1 time quantum to accommodate cross-platform `libm` ULP noise; they do not compare serialized bytes.

## Astronomy constraints

- Coarse position fixtures carry TT values. Delta-T projections differ between Espenak–Meeus and the frozen Horizons values by about 5.9 seconds today and 134 seconds at 2100. Roughly 6 seconds in a current UT event comparison is the Delta-T model floor. USNO grid rows after 2050 assert scatter about a per-date mean for the same reason.
- USNO's solar eclipse local-circumstances endpoint only answers for eclipses between 2001 and 2026, despite advertising 1800 to 2050. Outside that range it returns a 500, and inside it a 400 when the eclipse is not visible from the requested place — so a 400 is an answer, not a malformed request. Pick fixture dates inside the window.
- `moonPhaseDeg` takes TT days. Passing UT compiles and shifts the result by about 35 arcseconds.
- `FLAT_CYCLE_LATITUDE_DEG = 85` prevents rise and set events from disappearing when the altitude cycle flattens. Keep the brute-force flattening-band oracle test in all three ports.
- `SAME_ECLIPSE_MS = 100` makes next and previous eclipse searches strict around the anchor. Range searches use exact half-open bounds. Keep the fixed full-moon seed so adjacent ranges agree on the peak.
- Every public entry point applies TimeClip truncation toward zero to integer milliseconds. Swift and Kotlin must not use floor.
- Swift tests run in release mode because debug builds exceed the performance smoke limits. The tests do not use `assert()` or `precondition()`, so release builds retain their test semantics.

## Development checks

The Swift package and its tests use Swift 6 language mode and require a Swift 6 or newer toolchain.

CI defines the toolchain: `actions/setup-node` reads Node 22 from `mise.toml` for tests, and `ubuntu-latest` supplies Swift. Check the job’s runner image and compiler metadata for the version used. The npm packaging, publishing, and lockfile jobs read Node 24 from `.github/mise.toml` for trusted publishing and lockfile generation. Compatibility smoke tests keep their explicit Node versions. A `watchos` job on `macos-latest` compiles the Swift library for Apple Watch hardware and the watch simulator, because Slackwater's watch app depends on it; watch hardware is `arm64_32`, where Swift's `Int` is 32 bits, so keep epoch milliseconds and other large counts in `Double` or `Int64`.

`mise.toml` also selects Swift per operating system for local development; CI uses the runner’s Swift toolchain. The Linux entry pins Swift 6.4.0 to match the validated Ubuntu 26.04 image. GitHub selects the image behind `ubuntu-latest`, so a job assigned an older image can still use an older Swift toolchain. Update the Linux pin when validating a new runner toolchain. The macOS entry instead tracks the Swift version in the installed Xcode, because a standalone macOS toolchain borrows Apple's SDK from Xcode and fails against an SDK newer than itself. Raise it when Xcode moves to a new Swift release.

For local setup, mise 2026.9.6 or newer provides the core Swift backend and the per-operating-system tool selection `mise.toml` uses:

```bash
mise install
```

CI runs SwiftPM on Linux without Xcode. On macOS, mise installs the compiler but not Apple's SDK, so the macOS entry in `mise.toml` has to match the Xcode in use. A mismatch fails while compiling a package manifest, reporting an unknown `-target-arch-variant` argument and a missing `URL`.

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
mise exec -- node --test .github/ci-routes.test.mjs
(cd kotlin && mise exec -- ./gradlew test jacocoTestReport jacocoTestCoverageVerification && mise exec -- ./gradlew -p smoke run)
```

The TypeScript suite includes the full-range performance smokes. `npm pack --dry-run` runs `prepack`, which stages `README.md`, `LICENSE`, and `NOTICE` inside `typescript/`; these generated copies are not repository files and must not be committed.

Fixture refresh scripts named `refresh-*.mjs` are the only fixture scripts that use the network. Run them manually, commit raw responses, derived fixtures, and metadata together, and record request URLs in the metadata files. `refresh-horizons.mjs` and `refresh-usno.mjs` take names, or name prefixes for USNO such as `seasons-`, to fetch a subset; `retrieved.json` is merged, so the other raw files and their derived fixtures stand.

Kotlin CI uses Temurin JDK 17, Kotlin 2.2.0, and the checksum-pinned Gradle 8.14.3 wrapper. Handwritten Kotlin code requires 100% JaCoCo LINE coverage; only `MoonTables.kt` and `PlanetModels.kt` coefficient declarations are excluded, and integrity tests compare every coefficient to TypeScript in source order by IEEE-754 bits. The smoke build calls all public APIs using only the public package. Android runtime testing remains separate from JVM verification.

CI routes Kotlin-only changes to Kotlin, Swift-only changes to Swift and watch compilation, and TypeScript tests to TypeScript. Shared TypeScript source, fixtures, manifest/toolchain/packaged documents, and workflow changes run all ports. Main pushes run all ports; fixture derivation runs unconditionally. Existing performance jobs cover TypeScript and Swift.

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

The shared inputs in [`benchmarks/cases.json`](benchmarks/cases.json) cover positions, a 228-hour sky track, short, year, and polar event windows, full-range phases, and lunar eclipses. Eclipse workloads measure next and previous search, occupied and empty 228-hour windows, and the full 1950 through 2100 range. Both runners use native backward and range APIs when available. Older revisions fall back to forward loops with a 400-day lookback so the workloads remain comparable. Swift detects API availability from the public declaration in `Eclipse.swift`; keep that detection current if the declaration moves or changes format. Solar eclipse workloads measure the same searches for the fixed observer plus `solarObscuration` over a 228-hour track. They have no fallback on revisions before 0.4.0, so pass `--skip '^solar/'` (a regular expression matched against workload names) when the base predates it; Swift detects the solar API from the presence of `Solar.swift`. Global solar eclipse workloads measure next, previous, an empty 228-hour window, and the full-range search with no observer, plus the 2024-04-08 central line at its default step. They have no fallback on revisions before 0.5.0, so pass `--skip '^global/'` when the base predates it; Swift detects the global API from the presence of `GlobalSolar.swift`.

Raw samples, iteration counts, output checksums, Git revisions, harness hash, and machine and toolchain metadata are saved under `.benchmarks/<timestamp>/` with `summary.md`. Set `--output directory` for a predictable location. Compare saved reports from the same environment and harness with:

```bash
mise exec -- node benchmarks/compare.mjs base-typescript.json candidate-typescript.json 20
mise exec -- node --test benchmarks/compare.test.mjs
```

CI compares a pull request merge result with its target branch base SHA, or a main push with the previous main SHA. Each port builds both revisions and interleaves their measurements in one job. CI publishes a timing table in the Actions summary and retains JSON and Markdown artifacts for 30 days, including on regressions. Missing workloads, invalid timings, changed outputs, and incompatible reports fail the comparison. The Swift performance job starts after the TypeScript performance job passes.

Planetary workloads cover a five-planet 228-hour sky track, a 228-hour rise/set window, and a polar month. Pass `--skip '^planets/'` when the base lacks the planetary APIs. The Swift harness detects `planetEvents` in `Events.swift`; CI uses the same declaration to omit these workloads only when its base predates them. Compare new planetary workloads against the first revision with all planetary APIs, and existing workloads against the target branch.

SunCalc-parity workloads cover a year of `+6°` Sun altitude crossings, a year each of Sun and Moon transits, and Moon orientation over a 228-hour track. Pass `--skip '^suncalc/'` when the base lacks those APIs; the Swift harness detects `sunTransits` in `Events.swift`, and CI uses the same declaration.

Season, apsis, and equation of time workloads cover every equinox and solstice and every lunar apsis from 1950 through 2100, and the equation of time at every hour of 2026. Pass `--skip '^cycles/'` when the base lacks those APIs; the Swift harness and CI detect them from the presence of `Seasons.swift`.

Star workloads cover the two ways callers use stars: 1,024 stars spread over the sky at one instant, like a sky dome, and one star at each of 1,024 hours, like a sight-reduction run. Both call `starAltAz`. Since 0.12.0 a star applies annual aberration, which costs about what the Sun does, so older revisions are not comparable. Pass `--skip '^stars/'` when the base predates 0.12.0; the Swift harness and CI detect it from `public func starPosition(` in `Positions.swift`.

## Releasing

One version number spans all three ports. Kotlin reads `typescript/package.json` at build configuration time. Every release is a Git tag and a GitHub release for that tag: the tag starts the publishing workflow, and the GitHub release carries the notes.

1. Remove any committed plans and specs, and verify that the living documentation describes shipped behavior. Bump `version` in `typescript/package.json`. The release fails if the tag and manifest versions differ. Land the cleanup and bump through a pull request because `main` is protected and its required checks must pass.
2. Create and push the version tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. [The release workflow](.github/workflows/release.yml) runs the full three-port test matrix, including Kotlin coverage and source consumption, builds a clean SwiftPM consumer for the tag, packs and smoke-tests the npm tarball, and publishes that same tarball with provenance. After publishing, it creates a GitHub release with generated notes only if the tag has none.
4. Write the GitHub release while the workflow runs:

   ```bash
   gh release create vX.Y.Z --verify-tag --title "<headline>" --latest --notes-file notes.md
   ```

   Follow the [release notes guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/releases.md#release-notes). The title is a short, sentence-case headline of what changed for users, with no version and no closing period, such as "Earth perihelion and aphelion" or "Requires Swift 6". The notes open with what is new and for whom (developers using the TypeScript, Swift, and Kotlin ports), put breaking changes and upgrade steps first, and list the user-visible changes as bullets that link their pull requests. Leave out chores, CI, and bot dependency bumps unless a runtime dependency change matters to users. Add measured evidence where accuracy or performance changed and install snippets for npm and SwiftPM.

   The workflow creates a release titled with the bare tag and generated notes if none exists yet. If it published first, replace the title and notes with `gh release edit vX.Y.Z --repo openwatersio/almanac --title "<headline>" --notes-file notes.md`.

A release is finished when npm lists the version and `gh release view vX.Y.Z` shows the headline title and written notes.

npm publishing uses a trusted publisher bound to `openwatersio/almanac` and the workflow filename `release.yml`. Renaming that file breaks the binding. The repository contains no npm publishing token. Swift consumers pin the `vX.Y.Z` tag, and npm consumers install `@openwaters/almanac` from the registry.

Release tags matching `v*` reject updates and deletion. Repository administrators can bypass that rule for recovery. Do not move or recreate a published version tag during a normal release.

## Refreshing fixtures

`fixtures/raw/` holds verbatim responses from JPL Horizons, USNO, and NASA/Espenak. Derived JSON is regenerated offline from those responses. Run the relevant `fixtures/generate/refresh-*.mjs` script, then `node fixtures/generate/derive.mjs`, and commit the raw responses, derived data, and metadata together. Widening the supported interval from 1950 through 2100 requires boundary fixtures first because the interval is defined by the available evidence.
