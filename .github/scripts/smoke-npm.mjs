import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert.ok(process.argv[2], 'Pass the npm tarball path');
const tarball = resolve(process.argv[2]);
const consumer = mkdtempSync(join(tmpdir(), 'almanac-npm-smoke-'));
try {
  writeFileSync(join(consumer, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumer, stdio: 'inherit' });
  const check = `
    const date = new Date('2026-06-21T12:00:00Z');
    const observer = { latitudeDeg: 60.17, longitudeDeg: 24.94 };
    assert.equal(almanac.sunIsUp(date, observer), true);
    assert.equal(almanac.sunIsUp(new Date('2026-12-21T00:00:00Z'), observer, 2), false);
    assert.equal(almanac.degreesToRadians(180), Math.PI);
    assert.equal(almanac.radiansToDegrees(Math.PI), 180);
    assert.throws(() => almanac.degreesToRadians(NaN), RangeError);
    assert.throws(() => almanac.radiansToDegrees(Number.MAX_VALUE), RangeError);
    const { fraction, phase } = almanac.moonIllumination(date);
    assert.ok(fraction >= 0 && fraction <= 1);
    assert.ok(phase >= 0 && phase < 1);
    const position = almanac.sunAltAz(date, observer);
    assert.ok(Number.isFinite(position.altDeg));
    assert.ok(position.azDeg >= 0 && position.azDeg < 360);
    assert.ok(almanac.sunEvents(date, new Date('2026-06-22T12:00:00Z'), observer).some(event => event.kind === 'rise'));
    assert.throws(() => almanac.moonIllumination(new Date('1900-01-01')), almanac.AlmanacOutOfRangeError);
  `;
  for (const [name, mode, imports] of [
    ['ESM import', 'module', "import assert from 'node:assert/strict'; import * as almanac from '@openwaters/almanac';"],
    ['dynamic import', 'module', "import assert from 'node:assert/strict'; const almanac = await import('@openwaters/almanac');"],
    ['CommonJS require', 'commonjs', "const assert = require('node:assert/strict'); const almanac = require('@openwaters/almanac');"],
  ]) {
    execFileSync(process.execPath, ['--input-type=' + mode, '-e', imports + check], { cwd: consumer, stdio: 'inherit' });
    console.log(process.version + ': ' + name + ' packed-package checks passed');
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
