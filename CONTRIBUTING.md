# Contributing

## Development

Two implementations, one behavior. Any change to computed results lands in both
`typescript/` and `swift/` in the same change series, with the TypeScript port
leading and the Swift port mirroring its structure. See [AGENTS.md](AGENTS.md) for
the invariants and gotchas; the design spec in `docs/` is the binding contract.

Run everything before pushing:

```bash
cd typescript && npm ci && npm test && npm run build
cd .. && swift test -c release
node fixtures/generate/derive.mjs --check
```

CI runs these checks plus performance comparisons on code changes in PRs and
every push to main.

## Performance

From the repository root, with Node 22+ and the TypeScript dev dependencies
installed (`npm ci --prefix typescript`):

```bash
node benchmarks/run.mjs --base origin/main
```

This benchmarks the current working tree (including uncommitted edits) against
the selected Git revision. Omit `--base` to compare against `HEAD`. Use
`--port typescript` or `--port swift` to run one port; Swift requires Swift 5.9+
and always builds in release mode. No extra benchmark dependencies are needed.

Both revisions use the **current harness, inputs, compiler and machine**. The
baseline is exported to a temporary directory, so it can predate the harness
and your checkout is never switched. Builds, fixture loading, date parsing and
process startup are outside the measurements. Each workload gets seven pairs of
base/candidate processes, alternating which revision runs first. Every process
warms up for 300 ms; the first pair calibrates batch sizes to 100 ms or longer and
later pairs reuse them. Samples are milliseconds per workload, with results
consumed and checked for consistency.

The table shows median latency and percentage change for every workload.
**Any median slowdown over 20% fails the command/CI job**; customize the limit
locally with `--threshold 10`. Small deltas can be timing noise: keep the machine
idle and repeat a suspicious run. Interleaving reduces runner drift, but cannot
eliminate noisy neighbors. The margin is a policy, not a statistical
significance claim; correctness and parity tests remain the accuracy gates.

The shared inputs in [`benchmarks/cases.json`](benchmarks/cases.json) cover
positions, a 228-hour sky track, short/year/polar event windows, full-range phases,
and lunar eclipses. For [#6](https://github.com/openwatersio/almanac/issues/6),
the eclipse cases measure next/previous search, occupied/empty 228-hour windows,
and the full 1950–2100 range. Both runners use the native backward/range APIs when
available. Older revisions fall back to the original forward loops (including
the 400-day lookback), so the same workloads measure the improvement from #6.
Swift detects API availability from the public declaration in `Eclipse.swift`;
keep that detection current if the declaration moves or is reformatted.

Raw samples, iteration counts, output checksums, Git revisions, harness hash and
machine/toolchain metadata are saved under `.benchmarks/<timestamp>/`, alongside
`summary.md`. Set `--output directory` for a predictable location. Saved reports
from the same environment/harness can also be compared directly:

```bash
node benchmarks/compare.mjs base-typescript.json candidate-typescript.json 20
node --test benchmarks/compare.test.mjs
```

CI compares the PR merge result with its target branch's base SHA, or a main push
with the previous main SHA. Each port builds both revisions and interleaves their
measurements in one job, publishes a timing table in the Actions summary, and retains JSON and
Markdown artifacts for 30 days, including on regressions. This gives each merge
a recorded comparison; it is not a permanent trend dashboard. Missing workloads,
invalid timings, changed outputs, and incompatible reports fail closed.

The macOS performance job starts only after the TypeScript performance job
passes. If TypeScript fails or is skipped, the macOS benchmark is skipped too.

## Releasing

One version number spans both ports. A release is a git tag; everything else is
automated.

1. Bump `version` in `typescript/package.json` (the tag-version guard fails the
   release if tag and manifest disagree). Land it via a pull request — `main` is protected; direct pushes are rejected and the CI checks must be green to merge.
2. Tag and push:

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

3. `release.yml` then runs, in order:
   - the full test matrix (TS suite, Swift release suite, fixture + parity checks);
   - **smoke-swiftpm** — a clean temp package resolves this repo at
     `exact: "X.Y.Z"` (leading `v` stripped) and builds a program that calls the API;
   - **smoke-npm** — `npm pack`, asserts the tarball contains
     `NOTICE`/`LICENSE`/`README.md`/`dist/index.js`/`dist/index.d.ts`, installs it
     into a clean project, imports and calls it, then uploads the exact tarball;
   - **publish** — downloads that same tarball and runs
     `npm publish --provenance --access public` via OIDC. The tarball that was
     smoked is the tarball published.

npm publishing uses a **trusted publisher** bound to `openwatersio/almanac` +
`release.yml` — no tokens in the repo, and renaming the workflow file breaks the
binding, so don't. Swift consumers pin the `vX.Y.Z` tag; npm consumers get
`@openwaters/almanac` from the registry.

## Refreshing fixtures

`fixtures/raw/` holds verbatim upstream responses (JPL Horizons, USNO, NASA/Espenak);
derived JSON is regenerated offline from them. To refresh: run the relevant
`fixtures/generate/refresh-*.mjs` (network, ~1 req/s), then
`node fixtures/generate/derive.mjs`, commit raw + derived + meta together, and make
sure `--check` is clean. Widening the supported interval (1950–2100) requires new
boundary fixtures first — the interval is the fixture-evidence intersection, not a
constant to edit.
