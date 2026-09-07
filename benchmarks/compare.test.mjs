import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare } from './compare.mjs';

const report = (samplesMs) => ({
    port: 'typescript', harness: 'same-workloads',
    environment: { runtime: 'node 22', platform: 'linux', arch: 'x64', cpu: 'test CPU' },
    results: [{ name: 'eclipse walk', iterations: 10, checksum: 42, samplesMs }],
});

test('gates median regressions, tolerates outliers, and reports improvements', () => {
    const base = report([10, 10, 10, 10, 10, 10, 100]);
    const regression = compare(base, report([12.1, 12.1, 12.1, 12.1, 12.1, 12.1, 1]), 20);
    assert.equal(regression.regressed, true);
    assert.match(regression.markdown, /\+21\.0%/);
    assert.equal(compare(base, report([12, 12, 12, 12, 12, 12, 100]), 20).regressed, false);
    const faster = compare(base, report([8, 8, 8, 8, 8, 8, 100]), 20);
    assert.equal(faster.regressed, false);
    assert.match(faster.markdown, /-20\.0%/);
    assert.equal(compare(base, report([11, 11, 11, 11, 11, 11, 11]), 5).regressed, true);
});

test('fails closed on incomparable or incomplete reports', () => {
    const base = report([10, 10, 10, 10, 10, 10, 10]);
    for (const mutate of [
        (r) => { r.port = 'swift'; },
        (r) => { r.harness = 'different-workloads'; },
        (r) => { r.environment.runtime = 'different compiler'; },
        (r) => { r.results = []; },
        (r) => { r.results[0].name = 'renamed'; },
        (r) => { r.results.push(r.results[0]); },
        (r) => { r.results[0].samplesMs = []; },
        (r) => { r.results[0].samplesMs[0] = NaN; },
        (r) => { r.results[0].samplesMs[0] = 0; },
        (r) => { r.results[0].checksum = 0; },
        (r) => { r.results[0].checksum = Infinity; },
        (r) => { r.results[0].iterations = 0; },
    ]) {
        const candidate = structuredClone(base);
        mutate(candidate);
        assert.throws(() => compare(base, candidate, 20));
    }
    for (const threshold of [-1, NaN, Infinity]) {
        assert.throws(() => compare(base, base, threshold));
    }
    const missingMetadata = { ...base, environment: {} };
    assert.throws(() => compare(missingMetadata, missingMetadata, 20));
});

test('CLI returns a failure status for a regression or invalid input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'almanac-compare-test-'));
    try {
        const base = join(dir, 'base.json');
        const candidate = join(dir, 'candidate.json');
        writeFileSync(base, JSON.stringify(report([10, 10, 10, 10, 10, 10, 10])));
        const run = (...extra) => spawnSync(process.execPath,
            [fileURLToPath(new URL('./compare.mjs', import.meta.url)), base, candidate, ...extra], { encoding: 'utf8' });
        writeFileSync(candidate, JSON.stringify(report([13, 13, 13, 13, 13, 13, 13])));
        const slower = run();
        assert.equal(slower.status, 1);
        assert.match(slower.stdout, /REGRESSION/);
        assert.equal(run('40').status, 0);
        assert.equal(run('NaN').status, 1);
        writeFileSync(candidate, '{broken JSON');
        assert.equal(run().status, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
