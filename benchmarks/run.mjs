#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, hostname, platform, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compare, validate } from './compare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bench = join(root, 'benchmarks');
const { values } = parseArgs({ options: {
    base: { type: 'string', default: 'HEAD' },
    port: { type: 'string', default: 'both' },
    output: { type: 'string' },
    threshold: { type: 'string', default: '20' },
    help: { type: 'boolean', short: 'h' },
} });
if (values.help) {
    console.log('Usage: node benchmarks/run.mjs [--base git-ref] [--port typescript|swift|both] [--output directory] [--threshold percent]');
    process.exit(0);
}
assert.ok(['typescript', 'swift', 'both'].includes(values.port), 'Unknown port');
const threshold = Number(values.threshold);
assert.ok(values.threshold.trim() && Number.isFinite(threshold) && threshold >= 0, 'Invalid threshold percentage');
const suite = JSON.parse(readFileSync(join(bench, 'cases.json')));
assert.ok(Number.isFinite(suite.sampleMs) && suite.sampleMs > 0 && Number.isFinite(suite.warmupMs) && suite.warmupMs >= 0
    && Number.isSafeInteger(suite.samples) && suite.samples >= 7,
    'Invalid sampling settings');
for (const spec of suite.cases) {
    assert.ok(Number.isFinite(Date.parse(spec.from)) && Number.isFinite(Date.parse(spec.to ?? spec.from)), 'Invalid workload dates');
    assert.ok(Number.isSafeInteger(spec.count ?? 1) && (spec.count ?? 1) > 0, 'Invalid workload count');
}

const capture = (command, args, options = {}) => execFileSync(command, args,
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
const build = (command, args, options = {}) => execFileSync(command, args,
    { cwd: root, stdio: 'inherit', ...options });
const git = (...args) => capture('git', args);
const baseRevision = git('rev-parse', '--verify', '--end-of-options', values.base + '^{commit}');
const revision = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;
const output = resolve(values.output ?? join(root, '.benchmarks', new Date().toISOString().replaceAll(':', '-')));
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'almanac-bench-'));
const baseline = join(temp, 'source');
const hash = createHash('sha256');
for (const path of ['cases.json', 'typescript.mjs', 'swift/main.swift', 'Package.swift', 'run.mjs', 'compare.mjs']) {
    hash.update(path).update(readFileSync(join(bench, path)));
}
const harness = hash.digest('hex');
const machine = { platform: platform(), arch: arch(), os: release(), cpu: cpus()[0].model, cores: cpus().length, host: hostname() };
const summary = [
    '# Almanac performance', '',
    'Base: ' + baseRevision + '; candidate: ' + revision + (dirty ? ' (working tree)' : '') + '.',
    '',
    'Same runner and harness, ' + suite.warmupMs + ' ms warmup, ' + suite.samples + ' samples using batches calibrated to '
        + suite.sampleMs + ' ms per workload. Build/startup time excluded.', '',
];
let regressed = false;
try {
    // Export code without checking out or modifying the developer's working tree.
    mkdirSync(baseline);
    build('git', ['archive', '--format=tar', '--output=' + join(temp, 'base.tar'), baseRevision]);
    build('tar', ['-xf', join(temp, 'base.tar'), '-C', baseline]);
    for (const port of values.port === 'both' ? ['typescript', 'swift'] : [values.port]) {
        const compiler = join(root, 'typescript/node_modules/typescript/bin/tsc');
        const runtime = port === 'typescript'
            ? process.version + '; TypeScript ' + capture(process.execPath, [compiler, '--version'])
            : capture('swift', ['--version']);
        const commands = {};
        // Build BOTH revisions before timing either one.
        for (const [label, source] of [['base', baseline], ['candidate', root]]) {
            console.error('Building ' + port + ' ' + label + '...');
            if (port === 'typescript') {
                build(process.execPath, [compiler, '-p', join(source, 'typescript/tsconfig.json')]);
                commands[label] = [process.execPath, [join(bench, 'typescript.mjs'), join(source, 'typescript/dist/index.js')]];
            } else {
                const env = { ...process.env, ALMANAC_SOURCE: source };
                const args = ['build', '-c', 'release', '--package-path', bench, '--scratch-path', join(temp, label + '-swift')];
                build('swift', [...args, '--product', 'AlmanacBenchmarks'], { env });
                const bin = capture('swift', [...args, '--show-bin-path'], { env });
                commands[label] = [join(bin, 'AlmanacBenchmarks'), [join(bench, 'cases.json')]];
            }
        }
        const reports = {};
        // ponytail: sequential medians tolerate ordinary noise with a 20% margin;
        // use interleaved process runs if runner/thermal drift exceeds that margin.
        for (const label of ['base', 'candidate']) {
            console.error('Measuring ' + port + ' ' + label + '...');
            const [command, args] = commands[label];
            const report = {
                port, harness, environment: { ...machine, runtime },
                revision: label === 'base' ? baseRevision : revision,
                dirty: label === 'candidate' && dirty,
                recordedAt: new Date().toISOString(), settings: suite,
                results: JSON.parse(capture(command, args)),
            };
            validate(report);
            assert.deepEqual(report.results.map((r) => r.name), suite.cases.map((c) => c.name), 'Runner skipped workloads');
            writeFileSync(join(output, label + '-' + port + '.json'), JSON.stringify(report, null, 2) + '\n');
            reports[label] = report;
        }
        const result = compare(reports.base, reports.candidate, threshold);
        regressed ||= result.regressed;
        summary.push(result.markdown);
        console.log(result.markdown);
    }
    process.exitCode = regressed ? 1 : 0;
} catch (error) {
    summary.push('Benchmark failed: ' + error.message);
    console.error(error.message);
    process.exitCode = 1;
} finally {
    writeFileSync(join(output, 'summary.md'), summary.join('\n') + '\n');
    console.error('Results: ' + output);
    rmSync(temp, { recursive: true, force: true });
}
