import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const commit = '865d3da7d8112bbc7911238052c6af4aaf877181';
const url = `https://raw.githubusercontent.com/cosinekitty/astronomy/${commit}/source/js/astronomy.ts`;
const source = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(url)).text();
const func = source.match(/function HorizonDipAngle\([^]*?\n\}/)?.[0];
assert.ok(func, 'Pinned HorizonDipAngle missing');
const names = ['DEG2RAD', 'RAD2DEG', 'EARTH_FLATTENING', 'EARTH_EQUATORIAL_RADIUS_KM'];
const constants = names.map(name => {
    const value = source.match(new RegExp(`(?:export )?const ${name} = ([^;]+);`))?.[1];
    assert.ok(value, `Missing ${name}`);
    return Number(value);
});
const dip = new Function(...names, `${func.replace(/: Observer|: number/g, '')}; return HorizonDipAngle;`)(...constants);
const rows = [];
for (const latitudeDeg of [-90, -48.4284, 0, 48.4284, 90]) {
    for (const heightAboveGroundM of [0, 2, 10, 100, 10000]) {
        const observer = { latitudeDeg, longitudeDeg: 0, elevationM: heightAboveGroundM };
        rows.push({ observer, heightAboveGroundM, dipDeg: dip({ latitude: latitudeDeg, height: observer.elevationM }, heightAboveGroundM) });
    }
}
const rawDir = new URL('../raw/horizon/', import.meta.url);
mkdirSync(rawDir, { recursive: true });
mkdirSync(new URL('../horizon/', import.meta.url), { recursive: true });
writeFileSync(new URL('dip.json', rawDir), JSON.stringify({ source: url, commit, function: 'HorizonDipAngle', sourceFunction: func, retrieved: new Date().toISOString().slice(0, 10), rows }, null, 2) + '\n');
console.log(`Recorded ${rows.length} pinned upstream horizon cases`);
