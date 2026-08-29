# Almanac landing page — Design

A tier-1 landing page for Almanac on `openwaters.io`, at `/sky`. The page explains the
library by running it: a live sky dome computed in the browser by
`@openwaters/almanac`, a scrubber that moves time through it, and a lunar-eclipse
panel whose visibility verdict changes when you hand it your location.

Almanac's GitHub homepage today points at npm. Every other promoted Open Waters
library — `neaps`, `aiscast`, `seascape` — points at a page in the `openwaters.io`
repository. This closes that gap.

## Scope

**In scope:** one Astro page at `/sky`, one React island, a `Sky` nav item and
homepage card, a `docs/ROADMAP.md` in this repository, and the homepage-URL setting
change.

**Out of scope:** a `/sky` section index separate from the page (Almanac is the only
sky content; `/ais/index.astro` sets the precedent that the section index *is* the
landing page), solar-eclipse UI (the library does not compute it yet), place-name
geocoding, weather or terrain in visibility, and any change to the library's public
API.

## Repositories and deliverables

The work spans two repositories and lands as two pull requests, `almanac` first so the
site has something to link to.

### `almanac`

| Path | Change |
| --- | --- |
| `docs/ROADMAP.md` | New. |
| `README.md` | Link the roadmap and the landing page. |

Plus one GitHub setting: repository homepage `https://www.npmjs.com/package/@openwaters/almanac`
→ `https://openwaters.io/sky`. Repository Standards requires a tier-1 homepage to point
at its dedicated landing page.

### `openwaters.io`

| Path | Change |
| --- | --- |
| `website/src/pages/sky/index.astro` | New. Static shell. |
| `website/src/components/sky/SkyDome.tsx` | New. The island. |
| `website/src/components/sky/moonPath.ts` | New. Pure terminator geometry. |
| `website/src/components/sky/skyColor.ts` | New. Pure altitude → gradient stops. |
| `website/src/components/sky/projection.ts` | New. Pure alt/az → viewBox coordinates. |
| `website/src/components/sky/time.ts` | New. Civil-day boundaries in an arbitrary zone. |
| `website/src/components/sky/sky.test.ts` | New. Unit tests for the pure modules. |
| `website/src/components/layout/Header.astro` | Add `{ name: "Sky", href: "/sky" }`. |
| `website/src/pages/index.astro` | Add the Sky card. |
| `website/package.json` | Add `@openwaters/almanac`. |

The repository is not currently cloned locally; clone it to
`~/src/openwaters/openwaters.io` before starting that pull request.

## Architecture

One React island, `client:only="react"`, rendering inline SVG. The `.astro` file is a static
shell around it — heading, lead paragraph, feature cards, code snippets, GitHub call to
action — following the structure of `website/src/pages/tides/neaps.astro`.

Inline SVG rather than a `<canvas>`: the sky gradient, sun, and moon all take
`var(--…)` fills, so dark mode needs no parallel code path; the readouts stay real DOM
for assistive technology; and the drawing is a sun disc, a moon disc, and a gradient,
which does not justify an imperative redraw loop with device-pixel-ratio and resize
handling. The cost is that an SVG gradient cannot render convincing atmospheric
scattering. The page reads as a clean diagram, which suits a library that sells itself
on pure geometry and zero data files.

One island rather than three coordinating through a store: `SkyDome`, the scrubber, and
the eclipse panel all need the same two state values, so a store would exist purely to
cross island boundaries the page does not need. Three presentational components inside
one island give the same separation, and `openwaters.io` has no store library today.

### State

Three values live in the island:

```ts
instant: Date                                        // where the scrubber points
place: { lat: number; lon: number; tz: string; label: string }
playing: boolean
```

`place` defaults to `{ lat: 48.5, lon: -123.0, tz: "America/Vancouver", label: "Salish Sea" }`.

### Derived values

**Memoized on `[place, civil date of instant]`:**

- `sunEvents(dayStart, dayEnd, place)` — rise, set, the three twilights, transit
- `moonEvents(dayStart, dayEnd, place)` — moonrise, moonset

These are the linear-scan searches. They recompute when the date stepper or the
location changes, and **never while the time slider is dragged**.

**Recomputed per frame:**

- `sunAltAz(instant, place)`
- `moonAltAz(instant, place)`
- `moonIllumination(instant)`

Truncated series evaluations, microseconds each; safe at 60 fps.

**Memoized on `[place]`:** the two eclipses and their visibility (below).

### Timezone

`place` carries its own IANA zone, so times always read as local to the location being
displayed — a sunrise labelled `05:42` means dawn *there*. Viewing the Salish Sea
default from Europe must not render sunrise at 14:42.

On a successful geolocation grant, `tz` comes from
`Intl.DateTimeFormat().resolvedOptions().timeZone` and `label` from the
`coordinate-format` package, already a dependency — it yields a formatted coordinate
such as `48°30′N 123°00′W`, not a place name. No geocoding service is contacted.

Every rendered time goes through the existing `website/src/components/DateTime.tsx`,
which spreads `Intl.DateTimeFormatOptions` onto `toLocaleString`, so `timeZone` passes
through with no change to that component.

### Bundle

`@openwaters/almanac` is pure ESM with zero runtime dependencies, and Rolldown
tree-shakes it well: the built island, Almanac included, is **36 KB raw / 14 KB
gzipped** — against 264 KB gzipped for the `maplibre-gl` chunk this site already
serves on other pages.

The island is `client:only` rather than `client:load` for two reasons. `astro dev`
runs the site in workerd, so SSR would evaluate the astronomy in a worker for output
that is discarded; and the page's initial state is `new Date()`, which cannot agree
between a server render and hydration. The `.astro` shell supplies a fixed-height
`slot="fallback"` skeleton, so there is no layout shift either way.

## The sky dome

A single `viewBox="0 0 800 400"` panorama with the horizon at `y = 320`.

**Horizontal — azimuth.** `x` maps azimuth across the full width, centered on the
transit azimuth: 180° when `place.lat >= 0`, 0° otherwise. That keeps the whole daily
arc in one unbroken sweep with the seam behind the observer. Without the flip, a
southern-hemisphere observer would watch the Sun transit at the panorama's edge with
its arc split across both ends.

The left/right sense therefore reverses with the hemisphere, which is correct rather
than a bug: an observer facing north sees the Sun rise on their right.

**Vertical — altitude.** `y` maps −18°…+90°. Bodies below the horizon are drawn and
clipped against it, so a sunrise reads as a disc emerging rather than a fade-in.

**Sky colour.** A `<linearGradient>` whose stops interpolate across five anchor
palettes keyed on sun altitude: day (> 0°), civil (0° to −6°), nautical (−6° to −12°),
astronomical (−12° to −18°), night (< −18°). These are the library's own twilight
thresholds, so the gradient and the twilight readouts cannot disagree.

**Stars.** Roughly forty `<circle>` elements at fixed positions, opacity ramping in as
the sun drops below −6°.

**Moon.** A limb circle plus a terminator half-ellipse with
`rx = |1 − 2 · fraction| · r`, sweep flags chosen from `waxing`. `MoonIllumination`
provides `fraction` and `waxing` but no limb position angle, so the disc uses the
conventional upright terminator. The page does not invent an orientation the library
does not compute.

**Readouts.** A row beneath the dome, from the memoized day events: sunrise, sunset,
civil twilight, moonrise, moonset, and the phase name with percent illuminated.

## Scrubber and location

**Time.** A native `<input type="range">` over 0–1439 minutes. Keyboard operation,
focus handling, and screen-reader semantics come from the platform.

**Date.** `‹`, `Now`, `›` buttons with the date label between them. Clamped to ±366
days from page load, which keeps `AlmanacOutOfRangeError` unreachable.

**Autoplay.** On mount the island sweeps `sunrise − 30m → sunrise + 60m` over about six
seconds, driven by `requestAnimationFrame`, and stops there. `Now` returns to the
current instant. Any pointer or key input on the controls cancels the sweep
immediately. Under `prefers-reduced-motion: reduce` the sweep is skipped and the page
starts at now.

**Location.** `place.label` renders as a button — *"Salish Sea — use my location"*.
`navigator.geolocation.getCurrentPosition` is called **only on click**, so arriving at
the page never triggers a permission prompt. On denial, timeout, or an unsupported
browser, an inline note appears and the default is retained.

## Eclipse panel

Two cards, *Last* and *Next*.

`nextLunarEclipse(after)` searches strictly forward; the library has no backward
search. So:

- **next** — `nextLunarEclipse(now)`.
- **last** — walk `nextLunarEclipse` forward from `now − 366 days`, keeping the final
  eclipse whose `peak < now`.

The lookback terminates in about three calls, and the bound is certified by the library
itself: `typescript/src/eclipse.ts` documents that the longest real gap between
consecutive lunar eclipses over 1950–2100 is 178 days. A 366-day lookback therefore
always brackets `now`.

Each card shows the kind badge (`penumbral` / `partial` / `total`), the peak in
`place.tz`, the umbral magnitude, and the contact times `p1 → u1 → u2 → u3 → u4 → p4`,
omitting the nulls that `LunarEclipse` already marks as absent for that kind.

`lunarEclipseVisibility(eclipse, place)` then produces the verdict — *"Visible from
here — Moon 34° above the horizon at greatest eclipse"* or *"Below the horizon at
greatest eclipse"* — and `contactsVisible` dims the individual contacts that occur with
the moon down.

This panel is what the geolocation link is for. Between two locations the contact times
barely move; the visibility verdict flips entirely.

A footnote states that visibility is geometric only, with no weather or terrain. The
library is explicit about this and the page must not be vaguer than the library.

## Code snippets

Two stacked `CodeBlock.astro` blocks — TypeScript, then Swift.

Not Shiki-highlighted: `website/src/utils/shiki.ts` declares `SNIPPET_LANGS` as
`js`/`python`/`go`/`rust`/`sh`, so TypeScript and Swift would each mean loading another
grammar. `CodeBlock.astro` renders plain `<pre><code>`, which is exactly what the
sibling `tides/neaps.astro` page uses for the same job.

Stacked rather than tabbed: two blocks are less code than a tab component and let both
languages be read at once. The TypeScript snippet is the same call sequence the island
above it is running, which keeps it honest by construction.

## Icon

`<Icon name="mdi:weather-sunset-up" />`, used in the homepage Sky card and the `/sky`
page header, matching the 24×24 stroke icons on the Tides, Charts, AIS, and Bathymetry
cards. `@iconify-json/mdi` is already installed, so no new asset is drawn or
maintained.

## Roadmap document

`docs/ROADMAP.md` in this repository, with four sections drawn from the v1 design
spec's Scope:

- **Shipped (v0.1.0)** — positions, rise/set/twilight/transit, moonrise and moonset,
  illumination and phase events, lunar eclipses with contact times and local
  visibility.
- **Next (v1.1)** — solar eclipse search and local circumstances, carrying the v1
  spec's reasoning for the deferral: geoid intersection, path classification,
  obscuration, and safe-viewing semantics that no current consumer requires. Also
  `previousLunarEclipse` — this landing page is the first consumer to want a backward
  search and had to work around its absence.
- **Not planned** — the v1 spec's out-of-scope list, each entry with its reason.
- **Consumer migrations** — `slackwater-ios`'s `SunMoon.swift` and `slackwater-web`'s
  suncalc, tracked as issues rather than release gates, per the v1 spec.

Linked from `README.md` and from the landing page footer.

## Error handling

- **`AlmanacOutOfRangeError`** is unreachable behind the ±366-day clamp, but derived
  computation is wrapped regardless and degrades to a "couldn't compute" state rather
  than a blank island.
- **Geolocation failure** shows an inline note and retains the default location.
- **Hydration** — the Astro shell renders a fixed-height skeleton so the island
  mounting does not shift layout.

## Testing

The site side has three pieces of non-trivial pure logic, each extracted to its own
module precisely so it can be tested without a DOM:

- `moonPath` — new, first quarter, full, and last quarter produce the expected
  terminator geometry.
- `skyColor` — the twilight breakpoints select the right palette on each side of 0°,
  −6°, −12°, and −18°.
- `projection` — the azimuth-to-`x` mapping, including the southern-hemisphere flip and
  the wrap at 0°/360°.

The runner is Node's built-in `node --test`, which strips the TypeScript natively on
the repository's Node 22+ floor. That adds no dependency to a repository that has no
test framework today; `website/package.json` gains a `test` script and `tsconfig.json`
excludes `**/*.test.ts` so `astro check` ignores the `.ts` import specifiers Node
requires.

Everything else on the page is rendering. `astro check && astro build`, already the
repository's `build` script, must pass.

The `almanac` side of the work is documentation only and adds no tests.
