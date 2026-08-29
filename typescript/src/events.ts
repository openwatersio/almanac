// L3 event searches: sun rise/set, the three twilights, solar transit,
// moonrise/moonset, and the four quarter moon phases.
//
// Two different algorithms live here, for two different reasons.
//
// The altitude searches are NOT translated from upstream. Upstream's
// `SearchRiseSet` walks a fixed 0.42-day grid guarded by a maximum-slope prune;
// a grid can straddle both halves of a grazing pair (the polar-onset day where
// the Sun sets at 08:00 and rises again at 08:16) and report neither. Here each
// daily cycle's altitude extrema are located numerically and every monotonic
// segment between consecutive extrema is bisected, so a pair of crossings
// minutes apart is bracketed by construction rather than by luck of the grid.
// Hour angle supplies only the initial bracket: HA 0/12h are not the exact
// extrema, because declination, distance and lunar parallax all drift within a
// cycle, and toward the poles the daily altitude cycle flattens until the
// extremum wanders hours away from transit.
//
// `searchMoonPhases` IS translated, from the cosinekitty/astronomy upstream at
// pinned sha 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
// `SearchMoonPhase` (~5260) and the `Search` (~4634) / `QuadInterp` (~4528)
// root finder it calls, plus the quarter walk of `SearchMoonQuarter` (~5339)
// and `NextMoonQuarter` (~5362).

import {
    Observer, assertObserver, assertSupported, assertSupportedWindowEnd,
    SUPPORTED_MIN, SUPPORTED_MAX
} from './types.js';
import { dateFromUt, ttDaysFromUt, utDays } from './time.js';
import { KM_PER_AU, RAD2DEG } from './nutation.js';
import { topoAltAzUnrefracted } from './transforms.js';
import { sunGeoVectorEqj } from './sun.js';
import { moonGeoVectorEqj } from './moon.js';
import { moonPhaseDeg } from './illumination.js';

/** A Sun event: a horizon or twilight crossing, or upper transit. */
export type SunEventKind =
    'rise' | 'set' | 'civilDawn' | 'civilDusk' | 'nauticalDawn' | 'nauticalDusk' |
    'astroDawn' | 'astroDusk' | 'transit';
export interface SunEvent { time: Date; kind: SunEventKind; }

/** A Moon event: the upper limb crossing the horizon. */
export type MoonEventKind = 'rise' | 'set';
export interface MoonEvent { time: Date; kind: MoonEventKind; }

/** A quarter lunar phase. */
export type MoonPhaseName = 'new' | 'firstQuarter' | 'full' | 'lastQuarter';
export interface MoonPhaseEvent { time: Date; phase: MoonPhaseName; }

// ---------------------------------------------------------------- constants

const CIVIL_ALT_DEG = -6;
const NAUTICAL_ALT_DEG = -12;
const ASTRO_ALT_DEG = -18;

/**
 * Body radii, for the semidiameter that lowers each rise/set target — and, in
 * the L3 eclipse layer, for the Earth's shadow cone and the Moon it falls on.
 * INTERNAL: exported for `eclipse.ts`, not part of the public API.
 */
export const MOON_MEAN_RADIUS_KM = 1737.4;
/** UPSTREAM: `SUN_RADIUS_KM`, astronomy.ts line 134. INTERNAL, see above. */
export const SUN_RADIUS_KM = 695700;
const HORIZON_REFRACTION_DEG = 34 / 60;

/**
 * The upper-limb rise/set target: unrefracted centre altitude at
 * −(34′ + the body's true semidiameter at the distance the observer sees).
 * Spec, Conventions: the same rule for both bodies — a fixed 16′ for the Sun
 * sits ~10″ off USNO near aphelion and perihelion, which a high-latitude graze
 * turns into a minute.
 */
function upperLimbTargetDeg(radiusKm: number, distanceAu: number): number {
    return -HORIZON_REFRACTION_DEG - RAD2DEG * Math.asin(radiusKm / (distanceAu * KM_PER_AU));
}

/** Mean hour-angle advance. The Sun's is a mean solar day by definition. */
const SUN_HA_RATE_DEG_PER_DAY = 360;
const SUN_CYCLE_DAYS = 1;
/** Mean lunar day, 24h50m28s. */
const MOON_CYCLE_DAYS = 1.035050;
const MOON_HA_RATE_DEG_PER_DAY = 360 / MOON_CYCLE_DAYS;

const SECOND_DAYS = 1 / 86400;
/** Bisection and golden-section both stop under a second; events are reported to the ms. */
const TIME_TOL_DAYS = SECOND_DAYS;
/** An extremum this close to the target grazes it without crossing: no event. */
const TANGENT_EPS_DEG = 1e-6;
/** Initial half-bracket around the hour-angle estimate of an extremum. */
const EXTREMUM_HALF_WIDTH_DAYS = 2 / 24;
/**
 * Where the daily cycle flattens the extremum drifts hours off transit — the
 * offset scales as 1/cos φ — so there the bracket is the whole half-cycle
 * instead. The threshold is 85°, not the 89° where the drift becomes dramatic:
 * the Moon's fast declination rate already puts the extremum 2.28 h off transit
 * at 88°N and 5.75 h at 88.9°N, past the ±2 h bracket, and golden section then
 * converges to a bracket edge and the monotonic-segment invariant breaks. The
 * cost of the wider threshold is a few extra golden-section steps at latitudes
 * almost nobody queries.
 */
const FLAT_CYCLE_LATITUDE_DEG = 85;

const GOLDEN_SECTION_CAP = 100;
const BISECTION_CAP = 60;
const HOUR_ANGLE_ITER_CAP = 20;
const MOON_PHASE_ITER_CAP = 50;
const INV_PHI = 0.6180339887498949;

const MIN_UT = utDays(new Date(SUPPORTED_MIN));
const MAX_UT = utDays(new Date(SUPPORTED_MAX));

/** Probes never leave the supported interval (spec: no degraded answer outside it). */
function clampUt(ut: number): number {
    return ut < MIN_UT ? MIN_UT : (ut > MAX_UT ? MAX_UT : ut);
}

/** Hitting an iteration cap is a bug, not a runtime condition — see the spec. */
function assertReached(condition: boolean, what: string): void {
    if (!condition) throw new Error(`almanac internal: ${what} did not converge`);
}

// ------------------------------------------------------- altitude sampling

/**
 * One evaluation of a body's unrefracted topocentric geometry. `riseSetAltDeg`
 * is the body's own horizon target at this instant: constant for the Sun,
 * distance-dependent for the Moon.
 */
interface Sample { ut: number; altDeg: number; hourAngleDeg: number; riseSetAltDeg: number; }
type Sampler = (ut: number) => Sample;

function sunSampler(observer: Observer): Sampler {
    return (ut) => {
        const p = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer);
        return {
            ut, altDeg: p.altDeg, hourAngleDeg: p.hourAngleDeg,
            riseSetAltDeg: upperLimbTargetDeg(SUN_RADIUS_KM, p.distanceAu)
        };
    };
}

function moonSampler(observer: Observer): Sampler {
    return (ut) => {
        const p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer);
        return {
            ut, altDeg: p.altDeg, hourAngleDeg: p.hourAngleDeg,
            riseSetAltDeg: upperLimbTargetDeg(MOON_MEAN_RADIUS_KM, p.distanceAu)
        };
    };
}

/** A search target: an absolute altitude, or `null` for the body's own rise/set target. */
type Level = number | null;

function offsetDeg(s: Sample, level: Level): number {
    return s.altDeg - (level === null ? s.riseSetAltDeg : level);
}

/** −1 below, +1 above, 0 grazing (within {@link TANGENT_EPS_DEG}: touches, never crosses). */
function crossingSign(s: Sample, level: Level): number {
    const f = offsetDeg(s, level);
    return Math.abs(f) <= TANGENT_EPS_DEG ? 0 : Math.sign(f);
}

// ----------------------------------------------------------- root findings

/** Wrap a hour-angle difference into (−180, 180]. */
function angleOffset(diff: number): number {
    let offset = diff % 360;
    if (offset <= -180) offset += 360;
    else if (offset > 180) offset -= 360;
    return offset;
}

/**
 * Time of the next local hour angle `targetHaDeg` strictly after `afterUt`:
 * one advance at the body's mean rate, then fixed-point refinement at the same
 * rate. The rate is right to a few percent, so each step cuts the error by ~20×
 * and the loop settles in three or four iterations. This is both the bracket
 * centre for an altitude extremum and — for `targetHaDeg = 0` — the transit
 * event itself.
 */
function nextHourAngle(sample: Sampler, afterUt: number, targetHaDeg: number, rateDegPerDay: number): number {
    let deficit = ((targetHaDeg - sample(afterUt).hourAngleDeg) % 360 + 360) % 360;
    if (deficit === 0) deficit = 360;          // already there: take the next one, not this one
    let ut = afterUt + deficit / rateDegPerDay;
    for (let i = 0; i < HOUR_ANGLE_ITER_CAP; i++) {
        const step = angleOffset(targetHaDeg - sample(ut).hourAngleDeg) / rateDegPerDay;
        ut += step;
        if (Math.abs(step) < TIME_TOL_DAYS) return ut;
    }
    assertReached(false, 'hour-angle iteration');
    return ut;
}

/**
 * Golden-section refinement of the altitude extremum bracketed around
 * `centreUt`. Evaluating the true extremum is what makes a grazing pair
 * findable: the segment on either side of it is monotonic, so bisection can
 * only miss a crossing if the extremum itself was never seen.
 *
 * `afterUt` is the previous extremum. It matters only under the widened
 * high-latitude bracket, where the half-cycle window would otherwise reach back
 * past it — and at the pole, where the daily cycle degenerates into the
 * declination's slow annual drift, unclamped golden section will happily walk
 * backwards and break the chain's ordering.
 */
function refineExtremum(
    sample: Sampler, centreUt: number, wantMax: boolean, halfWidthDays: number, afterUt: number
): Sample {
    let a = Math.max(clampUt(centreUt - halfWidthDays), afterUt);
    let b = clampUt(centreUt + halfWidthDays);
    let x1 = b - INV_PHI * (b - a);
    let x2 = a + INV_PHI * (b - a);
    let s1 = sample(x1);
    let s2 = sample(x2);
    const score = (s: Sample) => (wantMax ? s.altDeg : -s.altDeg);
    let converged = false;
    for (let i = 0; i < GOLDEN_SECTION_CAP; i++) {
        if (b - a < TIME_TOL_DAYS) { converged = true; break; }
        if (score(s1) > score(s2)) {
            b = x2; x2 = x1; s2 = s1;
            x1 = b - INV_PHI * (b - a);
            s1 = sample(x1);
        } else {
            a = x1; x1 = x2; s1 = s2;
            x2 = a + INV_PHI * (b - a);
            s2 = sample(x2);
        }
    }
    assertReached(converged, 'golden-section extremum refinement');
    return score(s1) > score(s2) ? s1 : s2;
}

/**
 * Bisection for the single crossing of `level` on the monotonic segment
 * between two consecutive extrema.
 */
function bisectCrossing(sample: Sampler, level: Level, s0: Sample, s1: Sample): number {
    let a = s0.ut;
    let b = s1.ut;
    let belowAtA = offsetDeg(s0, level) < 0;
    for (let i = 0; i < BISECTION_CAP; i++) {
        if (b - a < TIME_TOL_DAYS) return (a + b) / 2;
        const mid = (a + b) / 2;
        if ((offsetDeg(sample(mid), level) < 0) === belowAtA) a = mid;
        else b = mid;
    }
    assertReached(false, 'crossing bisection');
    return (a + b) / 2;
}

// ------------------------------------------------------ the altitude search

interface LevelSpec<K extends string> { level: Level; rising: K; falling: K; }

/**
 * Walk the window one half-cycle at a time, refining each altitude extremum and
 * solving every monotonic segment between consecutive extrema for every target
 * level. The chain starts a full cycle before `startUt` so the segment
 * containing the window's first instant is covered, and runs one extremum past
 * `endUt` so an event just inside the window's end is too.
 */
function searchAltitudeEvents<K extends string>(
    sample: Sampler,
    levels: readonly LevelSpec<K>[],
    transitKind: K | null,
    startUt: number,
    endUt: number,
    haRateDegPerDay: number,
    cycleDays: number,
    extremumHalfWidthDays: number
): { time: Date; kind: K }[] {
    const found: { ut: number; kind: K }[] = [];
    const emit = (ut: number, kind: K) => {
        if (ut >= startUt && ut < endUt) found.push({ ut, kind });   // half-open [start, end)
    };

    // The chain's first point need not be an extremum: between any instant and
    // the next extremum after it the altitude is already monotonic.
    let s0 = sample(clampUt(startUt - cycleDays));
    const firstMax = nextHourAngle(sample, s0.ut, 0, haRateDegPerDay);
    const firstMin = nextHourAngle(sample, s0.ut, 180, haRateDegPerDay);
    let nextIsMax = firstMax <= firstMin;
    let nextEst = nextIsMax ? firstMax : firstMin;

    const stepCap = Math.ceil(2 * (endUt - s0.ut) / cycleDays) + 8;
    let steps = 0;
    while (s0.ut < endUt && s0.ut < MAX_UT) {
        assertReached(steps++ < stepCap, 'extremum chain');
        const atRangeEnd = nextEst >= MAX_UT;
        // At the supported-interval edge the boundary instant stands in for the
        // extremum we are not allowed to probe past. The segment up to it is
        // still monotonic, so any crossing inside the window is still found.
        const s1 = atRangeEnd ? sample(MAX_UT)
            : refineExtremum(sample, nextEst, nextIsMax, extremumHalfWidthDays, s0.ut);
        assertReached(s1.ut > s0.ut, 'extremum chain ordering');

        for (const spec of levels) {
            const g0 = crossingSign(s0, spec.level);
            const g1 = crossingSign(s1, spec.level);
            if (g0 * g1 >= 0) continue;      // no crossing, or a graze that only touches
            emit(bisectCrossing(sample, spec.level, s0, s1), g1 > 0 ? spec.rising : spec.falling);
        }
        if (nextIsMax && transitKind !== null && !atRangeEnd) emit(nextEst, transitKind);

        s0 = s1;
        if (atRangeEnd) break;
        nextIsMax = !nextIsMax;
        nextEst = nextHourAngle(sample, nextEst, nextIsMax ? 0 : 180, haRateDegPerDay);
    }

    found.sort((a, b) => a.ut - b.ut);
    return found.map((e) => ({ time: dateFromUt(e.ut), kind: e.kind }));
}

const SUN_LEVELS: readonly LevelSpec<SunEventKind>[] = [
    { level: null, rising: 'rise', falling: 'set' },
    { level: CIVIL_ALT_DEG, rising: 'civilDawn', falling: 'civilDusk' },
    { level: NAUTICAL_ALT_DEG, rising: 'nauticalDawn', falling: 'nauticalDusk' },
    { level: ASTRO_ALT_DEG, rising: 'astroDawn', falling: 'astroDusk' },
];

const MOON_LEVELS: readonly LevelSpec<MoonEventKind>[] = [
    { level: null, rising: 'rise', falling: 'set' },
];

function extremumHalfWidth(observer: Observer, cycleDays: number): number {
    return Math.abs(observer.latitudeDeg) >= FLAT_CYCLE_LATITUDE_DEG
        ? cycleDays / 2
        : EXTREMUM_HALF_WIDTH_DAYS;
}

/**
 * Sun rise, set, the three twilights and upper transit within the half-open
 * window `[startUtc, endUtc)`, sorted ascending.
 *
 * Rise and set are the unrefracted geometric centre altitude at −(34′ + the
 * Sun's true semidiameter at distance) — the upper-limb convention with the
 * actual disc, the same rule the Moon gets; the twilights are centre altitude
 * −6°, −12° and −18° with no refraction term; transit is local hour angle
 * zero. An empty list is a valid answer — polar day and polar night drop
 * the crossings — while transit is reported regardless of whether the Sun is
 * above the horizon when it happens.
 */
export function sunEvents(startUtc: Date, endUtc: Date, observer: Observer): SunEvent[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    assertObserver(observer);
    if (startUtc.getTime() >= endUtc.getTime()) return [];
    return searchAltitudeEvents(
        sunSampler(observer), SUN_LEVELS, 'transit',
        utDays(startUtc), utDays(endUtc),
        SUN_HA_RATE_DEG_PER_DAY, SUN_CYCLE_DAYS, extremumHalfWidth(observer, SUN_CYCLE_DAYS)
    );
}

/**
 * Moonrise and moonset within the half-open window `[startUtc, endUtc)`,
 * sorted ascending — the apparent topocentric upper limb crossing the horizon,
 * so refraction (34′), topocentric parallax and the true semidiameter at the
 * Moon's distance are all included — the same upper-limb rule as the Sun's. An empty list is a valid answer.
 */
export function moonEvents(startUtc: Date, endUtc: Date, observer: Observer): MoonEvent[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    assertObserver(observer);
    if (startUtc.getTime() >= endUtc.getTime()) return [];
    return searchAltitudeEvents(
        moonSampler(observer), MOON_LEVELS, null,
        utDays(startUtc), utDays(endUtc),
        MOON_HA_RATE_DEG_PER_DAY, MOON_CYCLE_DAYS, extremumHalfWidth(observer, MOON_CYCLE_DAYS)
    );
}

// -------------------------------------------------------------- moon phases

/**
 * UPSTREAM: `MEAN_SYNODIC_MONTH`, astronomy.ts line 129. The elongation it
 * searches is {@link moonPhaseDeg}, apparent on both sides per the spec's
 * moon-phase definition — upstream's `PairLongitude` uses geometric longitudes,
 * which sit a flat ~40 s off the USNO catalogue.
 */
const MEAN_SYNODIC_MONTH = 29.530588;
const PHASE_NAMES: readonly MoonPhaseName[] = ['new', 'firstQuarter', 'full', 'lastQuarter'];

interface QuadRoot { t: number; dfdt: number; }

/** UPSTREAM: `QuadInterp`, astronomy.ts ~4528. */
function quadInterp(tm: number, dt: number, fa: number, fm: number, fb: number): QuadRoot | null {
    const Q = (fb + fa) / 2 - fm;
    const R = (fb - fa) / 2;
    const S = fm;
    let x: number;

    if (Q === 0) {
        if (R === 0) return null;                 // horizontal line: no progress possible
        x = -S / R;
        if (x < -1 || x > +1) return null;
    } else {
        const u = R * R - 4 * Q * S;
        if (u <= 0) return null;
        const ru = Math.sqrt(u);
        const x1 = (-R + ru) / (2 * Q);
        const x2 = (-R - ru) / (2 * Q);
        if (-1 <= x1 && x1 <= +1) {
            if (-1 <= x2 && x2 <= +1) return null;
            x = x1;
        } else if (-1 <= x2 && x2 <= +1) {
            x = x2;
        } else {
            return null;
        }
    }
    return { t: tm + x * dt, dfdt: (2 * Q * x + R) / dt };
}

/**
 * UPSTREAM: `Search`, astronomy.ts ~4634 — bisection with quadratic
 * acceleration for the ascending zero crossing of `f` in `[t1, t2]`. Times are
 * days since J2000 UT rather than upstream's `AstroTime`.
 */
export function search(
    f: (ut: number) => number,
    t1: number,
    t2: number,
    dtToleranceSeconds: number,
    iterLimit = MOON_PHASE_ITER_CAP,
    what = 'moon-phase search'
): number | null {
    const dtDays = Math.abs(dtToleranceSeconds * SECOND_DAYS);
    let f1 = f(t1);
    let f2 = f(t2);
    let fmid = NaN;
    let calcFmid = true;

    for (let iter = 0; ; iter++) {
        assertReached(iter < iterLimit, what);
        const tmid = (t1 + t2) / 2;
        const dt = tmid - t1;
        if (Math.abs(dt) < dtDays) return tmid;

        if (calcFmid) fmid = f(tmid);
        else calcFmid = true;

        const q = quadInterp(tmid, t2 - tmid, f1, fmid, f2);
        if (q && q.dfdt !== 0) {
            const fq = f(q.t);
            if (Math.abs(fq / q.dfdt) < dtDays) return q.t;
            const dtGuess = 1.2 * Math.abs(fq / q.dfdt);
            if (dtGuess < dt / 10) {
                const tleft = q.t - dtGuess;
                const tright = q.t + dtGuess;
                if ((tleft - t1) * (tleft - t2) < 0 && (tright - t1) * (tright - t2) < 0) {
                    const fleft = f(tleft);
                    const fright = f(tright);
                    if (fleft < 0 && fright >= 0) {
                        f1 = fleft; f2 = fright; t1 = tleft; t2 = tright;
                        fmid = fq; calcFmid = false;
                        continue;
                    }
                }
            }
        }

        if (f1 < 0 && fmid >= 0) { t2 = tmid; f2 = fmid; continue; }
        if (fmid < 0 && f2 >= 0) { t1 = tmid; f1 = fmid; continue; }
        return null;    // no ascending crossing here, or the window is too wide
    }
}

/**
 * UPSTREAM: `SearchMoonPhase`, astronomy.ts ~5260 — forward search only, which
 * is all the quarter walk needs. The phase repeats every synodic month, so the
 * time of the next occurrence is predicted from the current offset and then
 * bracketed ±1.5 days: the Moon's eccentricity has been seen to move a quarter
 * more than 0.9 days off the simple prediction.
 */
export function searchMoonPhase(targetLonDeg: number, startUt: number, limitDays: number): number | null {
    const moonOffset = (ut: number) => angleOffset(moonPhaseDeg(ttDaysFromUt(ut)) - targetLonDeg);
    const uncertainty = 1.5;
    let ya = moonOffset(startUt);
    if (ya > 0) ya -= 360;
    const estDt = -(MEAN_SYNODIC_MONTH * ya) / 360;
    const dt1 = estDt - uncertainty;
    if (dt1 > limitDays) return null;
    const dt2 = Math.min(limitDays, estDt + uncertainty);
    return search(moonOffset, startUt + dt1, startUt + dt2, 0.1);
}

/**
 * The four quarter moon phases within the half-open window
 * `[startUtc, endUtc)`, sorted ascending.
 *
 * A phase is the instant the Moon's geocentric ecliptic longitude leads the
 * Sun's by 0° (new), 90° (first quarter), 180° (full) or 270° (last quarter).
 */
export function searchMoonPhases(startUtc: Date, endUtc: Date): MoonPhaseEvent[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    if (startUtc.getTime() >= endUtc.getTime()) return [];

    const startUt = utDays(startUtc);
    const endUt = utDays(endUtc);
    const events: MoonPhaseEvent[] = [];

    // UPSTREAM `SearchMoonQuarter` finds the first quarter strictly after its
    // argument, so the walk starts a day early: a phase landing exactly on
    // startUtc belongs to this half-open window.
    let probeUt = clampUt(startUt - 1);
    let quarter = (Math.floor(moonPhaseDeg(ttDaysFromUt(probeUt)) / 90) + 1) % 4;

    for (;;) {
        const ut = searchMoonPhase(90 * quarter, probeUt, 10);
        assertReached(ut !== null, 'moon quarter search');
        if (ut === null || ut >= endUt) break;
        if (ut >= startUt) events.push({ time: dateFromUt(ut), phase: PHASE_NAMES[quarter] });
        // UPSTREAM `NextMoonQuarter`: skip 6 days, under the smallest observed
        // quarter-to-quarter interval, so the next search cannot re-find this one.
        probeUt = ut + 6;
        quarter = (quarter + 1) % 4;
    }
    return events;
}
