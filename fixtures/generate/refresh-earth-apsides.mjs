#!/usr/bin/env node
// Run only against the compiled pinned Astronomy Engine source; never use Almanac as the oracle.
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the compiled pinned Astronomy Engine source path');
const mod = await import(pathToFileURL(resolve(process.argv[2])).href);
const engine = mod.default ?? mod;
const rows = [];
let event = engine.SearchPlanetApsis(engine.Body.Earth, new Date('1950-01-01T00:00:00Z'));
while (event.time.date < new Date('2101-01-01T00:00:00Z')) {
    rows.push({ utc: event.time.date.toISOString(), kind: event.kind === 0 ? 'perihelion' : 'aphelion', distanceKm: event.dist_km });
    event = engine.NextPlanetApsis(engine.Body.Earth, event);
}
const dir = new URL('../raw/earth-apsides/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('reference.json', dir), JSON.stringify({
    source: 'https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts',
    commit: '865d3da7d8112bbc7911238052c6af4aaf877181',
    functions: ['SearchPlanetApsis', 'NextPlanetApsis'],
    method: 'Compile the unmodified pinned source, pass its JavaScript path to refresh-earth-apsides.mjs. Search forward from 1950-01-01 through 2101-01-01; no Almanac functions are used.', rows,
}, null, 2) + '\n');
console.log(`pinned Earth apsides: wrote ${rows.length} rows`);
