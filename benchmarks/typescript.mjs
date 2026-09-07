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

function workload(spec) {
    const from = new Date(spec.from);
    const to = new Date(spec.to ?? spec.from);
    const observer = { ...suite.observer, latitudeDeg: spec.latitudeDeg ?? suite.observer.latitudeDeg };
    const times = Array.from({ length: spec.count ?? 1 }, (_, i) => new Date(from.getTime() + i * 3_600_000));
    switch (spec.operation) {
        case 'sunPosition':
        case 'moonPosition':
            return () => times.reduce((sum, t) => sum + api[spec.operation](t).raDeg, 0);
        case 'sky':
            return () => times.reduce((sum, t) => sum + api.sunAltAz(t, observer).altDeg
                + api.moonAltAz(t, observer).altDeg + api.moonIllumination(t).fraction, 0);
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
