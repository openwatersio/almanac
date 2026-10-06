import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planetHeliocentricPosition, planetPosition, planetAltAz, planetIllumination, type Planet } from '../src/index.js';
import { planetHelioVector, planetGeoVectorEqj } from '../src/planetModels.js';
import { planetApparentAtTT, planetIlluminationAtTT } from '../src/planets.js';
import { earthHelioVector } from '../src/sun.js';
import { ttDays, ttDaysFromUt, utDays } from '../src/time.js';
import { topoAltAzUnrefracted } from '../src/transforms.js';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/planets/${name}.json`, import.meta.url), 'utf8'));
const planets: Planet[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'];
const skyPlanets = planets.filter(p => p !== 'earth');
const ttOf = (label: string) => (Date.parse(label) - Date.UTC(2000, 0, 1, 12)) / 86400000;
const sep = (a: { raDeg: number; decDeg: number }, b: { raDeg: number; decDeg: number }) => {
    const r = Math.PI / 180;
    const c = Math.sin(a.decDeg*r)*Math.sin(b.decDeg*r) + Math.cos(a.decDeg*r)*Math.cos(b.decDeg*r)*Math.cos((a.raDeg-b.raDeg)*r);
    return Math.acos(Math.max(-1, Math.min(1, c))) / r * 60;
};

it('heliocentric vectors agree with Sun-centered JPL TT evidence within 1e-3 AU', () => {
    const rows = load('heliocentric');
    for (const planet of planets) {
        const samples = rows.filter((r: any) => r.planet === planet);
        expect(samples[0].tt).toBe('1950-01-01T00:00:00Z');
        expect(samples.at(-1).tt).toBe('2100-12-31T23:59:59Z');
        for (const row of samples) {
            const p = planetHelioVector(planet, ttOf(row.tt));
            expect(Math.hypot(p.x-row.xAu, p.y-row.yAu, p.z-row.zAu), `${planet} @ ${row.tt}`).toBeLessThan(1e-3);
        }
    }
});

it('apparent sky positions agree with JPL TT evidence within one arcminute', () => {
    const rows = load('positions');
    for (const planet of skyPlanets) {
        const samples = rows.filter((r: any) => r.planet === planet);
        expect(samples.some((r: any) => r.raDeg < 1 || r.raDeg > 359)).toBe(true);
        for (const row of samples) {
            const p = planetApparentAtTT(planet, ttOf(row.tt));
            expect(sep(p, row), `${planet} @ ${row.tt}`).toBeLessThan(1);
            expect(Math.abs(p.distanceAu-row.distanceAu), `${planet} @ ${row.tt}`).toBeLessThan(1e-3);
            expect(p.raDeg).toBeGreaterThanOrEqual(0); expect(p.raDeg).toBeLessThan(360);
            expect(Math.abs(p.decDeg)).toBeLessThanOrEqual(90);
        }
    }
});

it('horizontal tracks agree with airless and above-10-degree refracted JPL evidence', () => {
    for (const row of load('altaz')) {
        if (row.mode === 'refracted' && row.altDeg <= 10) continue;
        const time = new Date(row.utc), ut = utDays(time);
        const actual = row.mode === 'airless'
            ? topoAltAzUnrefracted(planetGeoVectorEqj(row.planet, ttDaysFromUt(ut)), ut, row.observer)
            : planetAltAz(row.planet, time, row.observer);
        expect(Math.abs(actual.altDeg-row.altDeg)*60, `${row.planet} ${row.mode} @ ${row.utc}`).toBeLessThan(1);
        const azDiff = ((actual.azDeg-row.azDeg+540)%360)-180;
        expect(Math.abs(azDiff)*Math.cos(row.altDeg*Math.PI/180)*60).toBeLessThan(1);
    }
});

it('includes Earth heliocentrically, preserves its model, and validates planetary trust boundaries', () => {
    const observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656 };
    for (const time of [new Date('1950-01-01T00:00:00Z'), new Date(-1234.9), new Date('2100-12-31T23:59:59.999Z')]) {
        const earth = earthHelioVector(ttDays(time));
        expect(planetHeliocentricPosition('earth', time)).toEqual({ xAu: earth.x, yAu: earth.y, zAu: earth.z });
        for (const planet of skyPlanets) {
            expect(Number.isFinite(planetPosition(planet, time).raDeg)).toBe(true);
            expect(Number.isFinite(planetAltAz(planet, time, observer).altDeg)).toBe(true);
        }
    }
    for (const planet of ['earth', 'pluto', '', null, undefined] as unknown as Planet[]) {
        expect(() => planetPosition(planet, new Date())).toThrow(RangeError);
        expect(() => planetAltAz(planet, new Date(), observer)).toThrow(RangeError);
        if (planet !== 'earth') expect(() => planetHeliocentricPosition(planet, new Date())).toThrow(RangeError);
    }
    for (const time of [new Date(NaN), new Date('1949-12-31T23:59:59.999Z'), new Date('2101-01-01T00:00:00Z')]) {
        expect(() => planetHeliocentricPosition('earth', time)).toThrow(RangeError);
        expect(() => planetPosition('venus', time)).toThrow(RangeError);
        expect(() => planetAltAz('venus', time, observer)).toThrow(RangeError);
    }
    expect(() => planetAltAz('venus', new Date(), { ...observer, latitudeDeg: NaN })).toThrow(RangeError);
});

it('illumination and elongation agree with JPL; compatible photometry stays within 0.3 magnitudes', () => {
    let highPhaseVenus = 0;
    for (const row of load('illumination')) {
        const p = planetIlluminationAtTT(row.planet, ttOf(row.tt));
        expect(Math.abs(p.fraction-row.fraction), `${row.planet} @ ${row.tt}`).toBeLessThan(0.01);
        expect(Math.abs(p.elongationDeg-row.elongationDeg)*60).toBeLessThan(1);
        expect(p.fraction).toBeCloseTo((1+Math.cos(p.phaseAngleDeg*Math.PI/180))/2, 12);
        expect(p.elongationDeg).toBeGreaterThanOrEqual(0); expect(p.elongationDeg).toBeLessThanOrEqual(180);
        // The pinned Venus high-phase branch differs from JPL; retain those rows as geometry evidence.
        if (row.planet === 'venus' && row.phaseAngleDeg >= 163.6) highPhaseVenus++;
        else expect(Math.abs(p.magnitude-row.magnitude), `${row.planet} @ ${row.tt}`).toBeLessThan(0.3);
    }
    expect(highPhaseVenus).toBeGreaterThan(5);
});

it('pinned photometry includes the Venus high-phase branch and Saturn ring brightness', () => {
    let ringCases = 0;
    for (const row of load('photometry-reference').rows) {
        const p = planetIlluminationAtTT(row.planet, ttOf(row.tt));
        expect(Math.abs(p.magnitude-row.magnitude)).toBeLessThan(1e-10);
        expect(Math.abs(p.fraction-row.fraction)).toBeLessThan(1e-10);
        expect(Math.abs(p.phaseAngleDeg-row.phaseAngleDeg)).toBeLessThan(1e-8);
        expect(Math.abs(p.elongationDeg-row.elongationDeg)).toBeLessThan(1e-8);
        if (row.planet === 'saturn' && Math.abs(row.ringTiltDeg) > 10) { ringCases++; expect(p.magnitude).toBeLessThan(row.globeMagnitude-0.3); }
    }
    expect(ringCases).toBeGreaterThan(0);
    expect(() => planetIllumination('earth', new Date())).toThrow(RangeError);
    expect(() => planetIllumination('pluto' as Planet, new Date())).toThrow(RangeError);
    expect(() => planetIllumination('venus', new Date(NaN))).toThrow(RangeError);
});
