import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { moonOrientation, AlmanacOutOfRangeError } from '../src/index.js';
import { topoAltAzUnrefracted } from '../src/transforms.js';
import { moonGeoVectorEqj } from '../src/moon.js';
import { ttDaysFromUt, utDays } from '../src/time.js';
import type { Observer } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const D2R = Math.PI / 180;
const signed180 = (deg: number) => { const x = ((deg % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

interface Row { utc: string; observer: Observer; elongationDeg: number; brightLimbDeg: number; parallacticDeg: number }
const rows: Row[] = load('altaz/moon-orientation.json');

// The solar parallax: Almanac's geocentric Sun sits up to this far from the
// topocentric Sun Horizons uses, which turns the bright limb by this over sin(elongation).
const SOLAR_PARALLAX_ARCMIN = 8.794 / 60;

it('Horizons: bright limb within 1 arcminute plus the geocentric Sun difference', () => {
  let worst = 0;
  let worstLabel = '';
  for (const row of rows) {
    const o = moonOrientation(new Date(row.utc), row.observer);
    const limit = 1 + SOLAR_PARALLAX_ARCMIN / Math.sin(row.elongationDeg * D2R);
    const arcmin = Math.abs(signed180(o.brightLimbAngleDeg - row.brightLimbDeg)) * 60;
    if (arcmin / limit > worst) { worst = arcmin / limit; worstLabel = `${row.utc} lat ${row.observer.latitudeDeg}: ${arcmin.toFixed(3)}′ of ${limit.toFixed(3)}′`; }
    expect(arcmin, `${row.utc} lat ${row.observer.latitudeDeg}`).toBeLessThan(limit);
  }
  console.log(`Horizons bright limb: worst ${worstLabel}`);
});

it('Horizons: parallactic angle within 1 arcminute', () => {
  let worst = 0;
  let worstLabel = '';
  for (const row of rows) {
    const o = moonOrientation(new Date(row.utc), row.observer);
    const arcmin = Math.abs(signed180(o.parallacticAngleDeg - row.parallacticDeg)) * 60;
    if (arcmin > worst) { worst = arcmin; worstLabel = `${row.utc} lat ${row.observer.latitudeDeg}`; }
    expect(arcmin, `${row.utc} lat ${row.observer.latitudeDeg}`).toBeLessThan(1);
  }
  console.log(`Horizons parallactic angle: worst ${worst.toFixed(3)}′ (${worstLabel})`);
});

// An independent spherical-trig oracle: the angle at the Moon between the pole
// and the zenith, from the unrefracted topocentric azimuth and altitude alone.
it('parallactic angle matches the azimuth/altitude triangle at every latitude', () => {
  for (const latitudeDeg of [-89.5, -60, -35, 0, 20, 48.4284, 70.5, 89.5]) {
    const observer: Observer = { latitudeDeg, longitudeDeg: 31.3 };
    const phi = latitudeDeg * D2R;
    for (let ms = Date.parse('2026-03-01T00:00:00Z'); ms < Date.parse('2026-04-01T00:00:00Z'); ms += 3 * 3600_000) {
      const ut = utDays(new Date(ms));
      const p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer);
      const a = p.azDeg * D2R, h = p.altDeg * D2R;
      const sinDec = Math.sin(phi) * Math.sin(h) + Math.cos(phi) * Math.cos(h) * Math.cos(a);
      const q = Math.atan2(-Math.sin(a) * Math.cos(phi) * Math.cos(h), Math.sin(phi) - sinDec * Math.sin(h)) / D2R;
      const o = moonOrientation(new Date(ms), observer);
      expect(Math.abs(signed180(o.parallacticAngleDeg - q)), `lat ${latitudeDeg} @ ${new Date(ms).toISOString()}`).toBeLessThan(1e-6);
    }
  }
});

it('angles stay in their documented ranges', () => {
  for (let ms = Date.parse('2026-01-01T00:00:00Z'); ms < Date.parse('2027-01-01T00:00:00Z'); ms += 7 * 3600_000) {
    const o = moonOrientation(new Date(ms), { latitudeDeg: -35, longitudeDeg: 150 });
    expect(o.brightLimbAngleDeg).toBeGreaterThanOrEqual(0);
    expect(o.brightLimbAngleDeg).toBeLessThan(360);
    expect(o.parallacticAngleDeg).toBeGreaterThan(-180);
    expect(o.parallacticAngleDeg).toBeLessThanOrEqual(180);
  }
});

it('validates the instant and observer', () => {
  const t = new Date('2026-08-28T00:00:00Z');
  expect(() => moonOrientation(new Date(NaN), { latitudeDeg: 0, longitudeDeg: 0 })).toThrow(RangeError);
  expect(() => moonOrientation(new Date('2101-01-01T00:00:00Z'), { latitudeDeg: 0, longitudeDeg: 0 })).toThrow(AlmanacOutOfRangeError);
  expect(() => moonOrientation(t, { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  expect(() => moonOrientation(t, { latitudeDeg: 0, longitudeDeg: 0, elevationM: 20000 })).toThrow(RangeError);
});
