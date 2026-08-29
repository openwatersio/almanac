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

CI runs the same four jobs (node, swift release, fixture check, parity check) on
every push and PR.

## Releasing

One version number spans both ports. A release is a git tag; everything else is
automated.

1. Bump `version` in `typescript/package.json` (the tag-version guard fails the
   release if tag and manifest disagree). Commit to `main`.
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
