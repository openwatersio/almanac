#!/usr/bin/env node
// Run against pinned astronomy.ts with the extended outer-planet tables; never use Almanac functions as the oracle.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Pass the compiled pinned Astronomy Engine source path');
const mod = await import(pathToFileURL(resolve(process.argv[2])).href);
const engine = mod.default ?? mod;
const heliocentric = JSON.parse(await readFile(new URL('../planets/heliocentric.json', import.meta.url), 'utf8'));
for (const row of heliocentric.filter(r => r.planet === 'uranus' || r.planet === 'neptune')) {
  const time = engine.AstroTime.FromTerrestrialTime((Date.parse(row.tt)-Date.UTC(2000,0,1,12))/86400000);
  const p = engine.HelioVector(row.planet[0].toUpperCase()+row.planet.slice(1), time);
  assert.ok(Math.hypot(p.x-row.xAu, p.y-row.yAu, p.z-row.zAu) < 1e-3,
    'The photometry oracle needs the extended Uranus/Neptune tables documented in docs/CONTRACT.md');
}
const jpl = JSON.parse(await readFile(new URL('../planets/illumination.json', import.meta.url), 'utf8'));
const samples = jpl.filter(r => r.planet === 'venus' && r.phaseAngleDeg >= 163.6);
for (const planet of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
  for (const tt of ['1950-01-01T00:00:00Z', '2025-03-23T00:00:00Z', '2026-03-01T00:00:00Z', '2060-05-23T00:00:00Z', '2100-12-31T23:59:59Z']) samples.push({ planet, tt });
}
const rows = [...new Map(samples.map(r => [`${r.planet}|${r.tt}`, r])).values()].map(({ planet, tt }) => {
  const time = engine.AstroTime.FromTerrestrialTime((Date.parse(tt)-Date.UTC(2000,0,1,12))/86400000);
  const body = planet[0].toUpperCase()+planet.slice(1);
  const p = engine.Illumination(body, time);
  return { planet, tt, fraction: p.phase_fraction, phaseAngleDeg: p.phase_angle, magnitude: p.mag,
    elongationDeg: engine.AngleFromSun(body, time),
    ...(planet === 'saturn' ? { ringTiltDeg: p.ring_tilt, globeMagnitude: -9 + 0.044*p.phase_angle + 5*Math.log10(p.helio_dist*p.geo_dist) } : {}),
  };
});
const dir = new URL('../raw/planet-photometry/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('reference.json', dir), JSON.stringify({
  source: 'https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts',
  commit: '865d3da7d8112bbc7911238052c6af4aaf877181', functions: ['Illumination', 'AngleFromSun'],
  modelSources: {
    uranus: 'https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/generate/vsop/VSOP87B.ura',
    neptune: 'https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/generate/vsop/VSOP87B.nep',
  },
  method: 'Replace only the Uranus and Neptune VSOP tables in pinned astronomy.ts with the source-series prefixes documented in docs/CONTRACT.md, compile with the repository TypeScript compiler, then pass its JavaScript path to refresh-planet-photometry.mjs. No Almanac functions are used.', rows,
}, null, 2)+'\n');
console.log(`pinned photometry: wrote ${rows.length} rows`);
