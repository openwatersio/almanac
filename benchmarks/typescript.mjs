import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const api = await import(pathToFileURL(process.argv[2]));
const suite = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));

// Baseline for revisions predating #6; newer revisions use their native APIs.
function eclipseWalk(from, to) {
    const eclipses = [];
    let cursor = from;
    while (cursor < to) {
        let eclipse;
        try {
            eclipse = api.nextLunarEclipse(cursor);
        } catch (error) {
            if (error instanceof api.AlmanacOutOfRangeError) break;
            throw error;
        }
        assert.ok(eclipse.peak > cursor, 'Eclipse walk stopped advancing');
        if (eclipse.peak >= to) break;
        eclipses.push(eclipse);
        cursor = eclipse.peak;
    }
    return eclipses;
}

// Solar eclipses have no consumer-loop fallback on revisions before 0.4.0, nor
// the global search before 0.5.0; `--skip '^solar/'` or `--skip '^(solar|global)/'`
// leaves them out of a historical comparison.
function solar(operation, version = '0.4.0') {
    assert.ok(api[operation], operation + ' needs Almanac ' + version + ' or later');
    return api[operation];
}

// Stars spread evenly over the sky on a golden-angle spiral, like a sky dome drawn at one instant.
function catalog(count) {
    return Array.from({ length: count }, (_, i) => [
        (i * 137.50776405003785) % 360,
        Math.asin(1 - 2 * (i + 0.5) / count) * 180 / Math.PI,
    ]);
}

function workload(spec) {
    const from = new Date(spec.from);
    const to = new Date(spec.to ?? spec.from);
    const observer = { ...suite.observer, latitudeDeg: spec.latitudeDeg ?? suite.observer.latitudeDeg };
    const times = spec.operation === 'starCatalog' ? [] : Array.from({ length: spec.count ?? 1 }, (_, i) => new Date(from.getTime() + i * 3_600_000));
    switch (spec.operation) {
        case 'sunPosition':
        case 'moonPosition':
            return () => times.reduce((sum, t) => sum + api[spec.operation](t).raDeg, 0);
        case 'sky':
            return () => times.reduce((sum, t) => sum + api.sunAltAz(t, observer).altDeg
                + api.moonAltAz(t, observer).altDeg + api.moonIllumination(t).fraction, 0);
        case 'planetSky': {
            assert.ok(api.planetAltAz && api.planetIllumination, "Planetary APIs unavailable; pass --skip '^planets/' for older bases");
            const planets = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];
            return () => times.reduce((sum, t) => sum + planets.reduce((sum, planet) => {
                const illumination = api.planetIllumination(planet, t);
                return sum + api.planetAltAz(planet, t, observer).altDeg + illumination.fraction + illumination.magnitude + illumination.elongationDeg;
            }, 0), 0);
        }
        case 'planetEvents': {
            assert.ok(api.planetEvents, "Planetary APIs unavailable; pass --skip '^planets/' for older bases");
            return () => ['mercury', 'venus', 'mars', 'jupiter', 'saturn'].reduce((sum, planet) => sum + api.planetEvents(planet, from, to, observer).length, 0);
        }
        case 'sunAltitudeEvents':
        case 'sunTransits':
        case 'moonTransits':
        case 'moonOrientation': {
            const fn = api[spec.operation];
            assert.ok(fn, "SunCalc-parity APIs unavailable; pass --skip '^suncalc/' for older bases");
            if (spec.operation === 'moonOrientation') {
                return () => times.reduce((sum, t) => {
                    const o = fn(t, observer);
                    return sum + o.brightLimbAngleDeg + o.parallacticAngleDeg;
                }, 0);
            }
            if (spec.operation === 'sunAltitudeEvents') return () => fn(from, to, observer, spec.altitudeDeg).length;
            return () => fn(from, to, observer).length;
        }
        case 'seasons':
        case 'moonApsides':
        case 'equationOfTime': {
            const fn = api[spec.operation];
            assert.ok(fn, "Season, apsis, and equation of time APIs unavailable; pass --skip '^cycles/' for older bases");
            if (spec.operation === 'equationOfTime') return () => times.reduce((sum, t) => sum + fn(t), 0);
            return () => fn(from, to).length;
        }
        case 'starCatalog':
        case 'starTrack': {
            assert.ok(api.starPosition, "Aberrated star places need Almanac 0.12.0; pass --skip '^stars/' for older bases");
            if (spec.operation === 'starTrack') {
                return () => times.reduce((sum, t) => sum + api.starAltAz(spec.raDeg, spec.decDeg, t, observer).altDeg, 0);
            }
            const stars = catalog(spec.count);
            return () => stars.reduce((sum, [ra, dec]) => sum + api.starAltAz(ra, dec, from, observer).altDeg, 0);
        }
        case 'sunEvents':
        case 'moonEvents':
            return () => api[spec.operation](from, to, observer).length;
        case 'searchMoonPhases':
            return () => api.searchMoonPhases(from, to).length;
        case 'nextLunarEclipse':
            return () => api.nextLunarEclipse(from).peak.getTime() / 1000;
        case 'lunarEclipses':
            return api.lunarEclipses ? () => api.lunarEclipses(from, to).length : () => eclipseWalk(from, to).length;
        case 'previousLunarEclipse':
            return api.previousLunarEclipse ? () => api.previousLunarEclipse(to).peak.getTime() / 1000
                : () => eclipseWalk(from, to).at(-1).peak.getTime() / 1000;
        case 'nextSolarEclipse': {
            const next = solar(spec.operation);
            return () => next(from, observer).peak.getTime() / 1000;
        }
        case 'previousSolarEclipse': {
            const previous = solar(spec.operation);
            return () => previous(to, observer).peak.getTime() / 1000;
        }
        case 'solarEclipses': {
            const range = solar(spec.operation);
            return () => range(from, to, observer).length;
        }
        case 'solarObscuration': {
            const obscuration = solar(spec.operation);
            return () => times.reduce((sum, t) => sum + obscuration(t, observer), 0);
        }
        case 'nextGlobalSolarEclipse': {
            const next = solar(spec.operation, '0.5.0');
            return () => next(from).peak.getTime() / 1000;
        }
        case 'previousGlobalSolarEclipse': {
            const previous = solar(spec.operation, '0.5.0');
            return () => previous(to).peak.getTime() / 1000;
        }
        case 'globalSolarEclipses': {
            const range = solar(spec.operation, '0.5.0');
            return () => range(from, to).length;
        }
        case 'solarEclipseCentralLine': {
            const line = solar(spec.operation, '0.5.0');
            return () => line(from).length;
        }
        default:
            throw new Error('Unknown benchmark operation: ' + spec.operation);
    }
}

function measure(spec, fixedIterations) {
    const work = workload(spec);
    const checksum = work();
    assert.ok(Number.isFinite(checksum), spec.name + ': invalid output');
    if (spec.expected !== undefined) assert.equal(checksum, spec.expected, spec.name);
    const batch = (iterations) => {
        let sum = 0;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) sum += work();
        const elapsed = performance.now() - start;
        // Consume timed results and catch nondeterminism without timing assertions.
        assert.ok(Math.abs(sum / iterations - checksum) <= Math.max(1, Math.abs(checksum)) * 1e-9,
            spec.name + ': output changed during measurement');
        return elapsed;
    };
    const warmup = performance.now();
    do { batch(1); } while (performance.now() - warmup < suite.warmupMs);
    let iterations = fixedIterations ?? 1;
    if (fixedIterations === undefined) {
        while (batch(iterations) < suite.sampleMs) iterations *= 2;
    }
    return { name: spec.name, iterations, checksum, samplesMs: [batch(iterations) / iterations] };
}

// One warmed sample per process. The parent interleaves the two revisions.
const spec = suite.cases[Number(process.argv[3])];
assert.ok(spec, 'Missing workload index');
const iterations = process.argv[4] === undefined ? undefined : Number(process.argv[4]);
assert.ok(iterations === undefined || (Number.isSafeInteger(iterations) && iterations > 0), 'Invalid iteration count');
console.log(JSON.stringify(measure(spec, iterations)));
