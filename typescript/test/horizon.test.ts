import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { horizonDip, sunEvents, moonEvents, sunAltAz, nextSolarEclipse, previousSolarEclipse, solarEclipses, nextLunarEclipse, lunarEclipseVisibility } from '../src/index.js';
import { topoAltAzUnrefracted } from '../src/transforms.js';
import { sunGeoVectorEqj } from '../src/sun.js';
import { moonGeoVectorEqj } from '../src/moon.js';
import { utDays, ttDaysFromUt } from '../src/time.js';
import { KM_PER_AU, RAD2DEG } from '../src/nutation.js';

const sea = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 2 };

it('matches pinned upstream dip across latitude and height', () => {
    const rows = JSON.parse(readFileSync(new URL('../../fixtures/horizon/dip.json', import.meta.url), 'utf8'));
    expect(rows).toHaveLength(25);
    for (const row of rows) expect(Math.abs(horizonDip(row.observer, row.heightAboveGroundM) - row.dipDeg)).toBeLessThan(1e-10);
});

it('lowers Sun and Moon crossing targets without changing twilight or transit', () => {
    const observer = { ...sea, elevationM: 100 };
    const start = new Date('2026-03-20T00:00:00Z'), end = new Date('2026-03-22T00:00:00Z');
    const dip = horizonDip(observer, 100);
    for (const [events, vector, radius] of [[sunEvents, sunGeoVectorEqj, 695700], [moonEvents, moonGeoVectorEqj, 1737.4]] as const) {
        const ground = events(start, end, observer);
        expect(events(start, end, observer, 0)).toEqual(ground);
        const raised = events(start, end, observer, 100);
        for (const kind of ['rise', 'set']) {
            const a = raised.find(e => e.kind === kind)!.time.getTime();
            const b = ground.find(e => e.kind === kind)!.time.getTime();
            expect(kind === 'rise' ? a < b : a > b).toBe(true);
        }
        expect(raised.filter(e => !['rise', 'set'].includes(e.kind))).toEqual(ground.filter(e => !['rise', 'set'].includes(e.kind)));
        for (const event of raised.filter(e => ['rise', 'set'].includes(e.kind))) {
            const ut = utDays(event.time);
            const p = topoAltAzUnrefracted(vector(ttDaysFromUt(ut)), ut, observer);
            const target = dip - 34 / 60 - RAD2DEG * Math.asin(radius / (p.distanceAu * KM_PER_AU));
            expect(Math.abs(p.altDeg - target)).toBeLessThan(0.005);
        }
        expect(() => events(start, start, observer, NaN)).toThrow(RangeError);
        expect(() => events(start, start, observer, -1)).toThrow(RangeError);
    }
});

it('includes a solar eclipse just below the horizontal plane from an elevated surface', () => {
    const observer = { latitudeDeg: 20, longitudeDeg: 5.5, elevationM: 100 };
    const start = new Date('2026-08-12T00:00:00Z'), end = new Date('2026-08-13T00:00:00Z');
    expect(solarEclipses(start, end, observer)).toEqual([]);
    const raised = solarEclipses(start, end, observer, 100);
    expect(raised).toHaveLength(1);
    const e = raised[0], dip = horizonDip(observer, 100);
    expect(e.sunAltDeg.c1).toBeLessThan(0);
    expect(e.sunAltDeg.c1).toBeGreaterThan(dip);
    expect(nextSolarEclipse(start, observer, 100)).toEqual(e);
    expect(previousSolarEclipse(end, observer, 100)).toEqual(e);
    for (const contact of ['c1', 'peak', 'c4'] as const) expect(e.sunAltDeg[contact]).toBe(sunAltAz(e[contact], observer).altDeg);
    expect(() => solarEclipses(start, start, observer, NaN)).toThrow(RangeError);
    expect(() => nextSolarEclipse(start, observer, NaN)).toThrow(RangeError);
    expect(() => previousSolarEclipse(end, observer, NaN)).toThrow(RangeError);
});

it('uses dip at every lunar contact while retaining geometric altitudes', () => {
    const e = nextLunarEclipse(new Date('2026-03-01T00:00:00Z'));
    const observer = { latitudeDeg: 48.4284, longitudeDeg: -74.8, elevationM: 100 };
    const ground = lunarEclipseVisibility(e, observer);
    const raised = lunarEclipseVisibility(e, observer, 100);
    expect(ground.visibleAtPeak).toBe(false);
    expect(raised.visibleAtPeak).toBe(true);
    expect(raised.moonGeometricAltAtPeakDeg).toBe(ground.moonGeometricAltAtPeakDeg);
    const dip = horizonDip(observer, 100);
    for (const contact of ['p1', 'u1', 'u2', 'u3', 'u4', 'p4'] as const) {
        const at = e[contact];
        if (!at) { expect(raised.contactsVisible[contact]).toBeNull(); continue; }
        const ut = utDays(at);
        const alt = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg;
        expect(raised.contactsVisible[contact]).toBe(alt > dip);
    }
    expect(() => lunarEclipseVisibility(e, observer, NaN)).toThrow(RangeError);
});

it('returns positive zero at ground level and lowers the horizon with height', () => {
    expect(Object.is(horizonDip(sea, 0), 0)).toBe(true);
    expect(horizonDip(sea, 2)).toBeLessThan(0);
    expect(horizonDip({ ...sea, elevationM: 10 }, 10)).toBeLessThan(horizonDip(sea, 2));
});

it('validates observer, eye height, and ground elevation', () => {
    for (const height of [NaN, Infinity, -1, 10001]) expect(() => horizonDip(sea, height)).toThrow(RangeError);
    expect(() => horizonDip({ ...sea, latitudeDeg: NaN }, 0)).toThrow(RangeError);
    expect(() => horizonDip({ ...sea, elevationM: -499 }, 2)).toThrow(RangeError);
    expect(horizonDip({ ...sea, elevationM: -499 }, 1)).toBeLessThan(0);
});
