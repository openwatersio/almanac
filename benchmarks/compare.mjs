import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function validate(report) {
    assert.ok(['typescript', 'swift'].includes(report.port), 'Unknown port');
    assert.ok(typeof report.harness === 'string' && report.harness.length > 0 && report.environment, 'Missing harness/environment metadata');
    for (const key of ['runtime', 'platform', 'arch', 'cpu']) {
        assert.ok(typeof report.environment[key] === 'string' && report.environment[key].length > 0, 'Missing environment metadata: ' + key);
    }
    assert.ok(report.results.length > 0, 'Empty benchmark report');
    assert.equal(new Set(report.results.map((r) => r.name)).size, report.results.length, 'Duplicate workloads');
    for (const result of report.results) {
        assert.ok(result.name && Number.isFinite(result.checksum), 'Missing name or non-finite checksum');
        assert.ok(Number.isSafeInteger(result.iterations) && result.iterations > 0, 'Invalid iteration count');
        assert.ok(result.samplesMs.length >= 7, 'At least seven samples are required');
        assert.ok(result.samplesMs.every((v) => Number.isFinite(v) && v > 0), 'Invalid timing sample');
    }
}

export function compare(base, candidate, threshold = 20) {
    assert.ok(Number.isFinite(threshold) && threshold >= 0, 'Threshold must be a finite, non-negative percentage');
    validate(base);
    validate(candidate);
    for (const field of ['port', 'harness', 'environment']) {
        assert.deepEqual(candidate[field], base[field], 'Incomparable reports: ' + field);
    }
    assert.deepEqual(candidate.results.map((r) => r.name).sort(), base.results.map((r) => r.name).sort(),
        'Workload set changed');
    const rows = [
        '## ' + candidate.port + ' performance',
        '',
        'Median milliseconds per workload; regression limit: ' + threshold + '%.',
        '',
        '| Workload | Base ms | Candidate ms | Change | Result |',
        '| --- | ---: | ---: | ---: | --- |',
    ];
    let regressed = false;
    for (const current of candidate.results) {
        const previous = base.results.find((r) => r.name === current.name);
        assert.ok(Math.abs(current.checksum - previous.checksum) <= Math.max(1, Math.abs(previous.checksum)) * 1e-9,
            'Workload output changed: ' + current.name);
        const before = median(previous.samplesMs);
        const after = median(current.samplesMs);
        const change = (after / before - 1) * 100;
        const failed = after / before > 1 + threshold / 100;
        regressed ||= failed;
        rows.push('| ' + [current.name, before.toFixed(3), after.toFixed(3),
            (change >= 0 ? '+' : '') + change.toFixed(1) + '%', failed ? 'REGRESSION' : 'pass'].join(' | ') + ' |');
    }
    return { regressed, markdown: rows.join('\n') + '\n' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [base, candidate, threshold = '20', extra] = process.argv.slice(2);
        assert.ok(base && candidate && !extra && threshold.trim(), 'Usage: node benchmarks/compare.mjs base.json candidate.json [threshold-percent]');
        const result = compare(JSON.parse(readFileSync(base)), JSON.parse(readFileSync(candidate)), Number(threshold));
        console.log(result.markdown);
        if (result.regressed) process.exitCode = 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
