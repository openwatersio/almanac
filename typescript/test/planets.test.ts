import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planetHeliocentricPosition, planetPosition, planetAltAz, planetIllumination, planetEvents, horizonDip, type Planet } from '../src/index.js';
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

it('rise/set agrees with independent one-minute JPL airless grids within 60 seconds', () => {
    for (const row of load('events')) {
        const found = planetEvents(row.planet, new Date(row.startUtc), new Date(row.endUtc), row.observer, row.heightAboveGroundM);
        expect(found.length, `${row.planet} lat ${row.observer.latitudeDeg}`).toBe(row.events.length);
        for (let i = 0; i < found.length; i++) {
            expect(found[i].kind).toBe(row.events[i].kind);
            expect(Math.abs(found[i].time.getTime()-Date.parse(row.events[i].utc))/1000).toBeLessThan(60);
            if (i > 0) expect(found[i].time.getTime()).toBeGreaterThan(found[i-1].time.getTime());
        }
    }
});

it('height and half-open event windows retain their shared contract', () => {
    const start = new Date('2026-03-20T00:00:00Z'), end = new Date('2026-03-22T00:00:00Z');
    const observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 100 };
    for (const planet of skyPlanets) {
        const ground = planetEvents(planet, start, end, observer), raised = planetEvents(planet, start, end, observer, 100);
        expect(planetEvents(planet, start, end, observer, 0)).toEqual(ground);
        expect(raised.find(e => e.kind === 'rise')!.time.getTime()).toBeLessThan(ground.find(e => e.kind === 'rise')!.time.getTime());
        expect(raised.find(e => e.kind === 'set')!.time.getTime()).toBeGreaterThan(ground.find(e => e.kind === 'set')!.time.getTime());
        for (const event of raised) {
            const ut = utDays(event.time);
            const p = topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer);
            expect(Math.abs(p.altDeg-(horizonDip(observer, 100)-34/60))).toBeLessThan(0.005);
        }
        const split = ground[0].time;
        expect([...planetEvents(planet, start, split, observer), ...planetEvents(planet, split, end, observer)]).toEqual(ground);
        expect(planetEvents(planet, start, start, observer)).toEqual([]);
        expect(planetEvents(planet, end, start, observer)).toEqual([]);
        expect(() => planetEvents(planet, start, start, observer, NaN)).toThrow(RangeError);
        expect(() => planetEvents(planet, start, start, observer, -1)).toThrow(RangeError);
        expect(() => planetEvents(planet, start, start, { ...observer, longitudeDeg: NaN })).toThrow(RangeError);
        for (const [a,b] of [['1950-01-01T00:00:00Z','1950-01-03T00:00:00Z'], ['2100-12-30T00:00:00Z','2101-01-01T00:00:00Z']]) {
            for (const e of planetEvents(planet, new Date(a), new Date(b), observer)) {
                expect(e.time.getTime()).toBeGreaterThanOrEqual(Date.parse(a)); expect(e.time.getTime()).toBeLessThan(Date.parse(b));
            }
        }
    }
    expect(() => planetEvents('earth', start, start, observer)).toThrow(RangeError);
    expect(() => planetEvents('pluto' as Planet, start, start, observer)).toThrow(RangeError);
    expect(() => planetEvents('venus', new Date(NaN), end, observer)).toThrow(RangeError);
});

it('the polar solver finds every one-minute oracle crossing, including grazing pairs', () => {
    for (const row of load('grazing-cases')) {
        const start = Date.parse(row.startUtc), end = Date.parse(row.endUtc);
        const offset = (ms: number) => {
            const ut = utDays(new Date(ms));
            return topoAltAzUnrefracted(planetGeoVectorEqj(row.planet, ttDaysFromUt(ut)), ut, row.observer).altDeg + 34/60;
        };
        const brute: {time: Date; kind: string}[] = [];
        let prev = offset(start);
        for (let ms = start+60000; ms <= end; ms += 60000) {
            const cur = offset(ms);
            if ((prev < 0) !== (cur < 0)) brute.push({time: new Date(ms), kind: cur >= 0 ? 'rise' : 'set'});
            prev = cur;
        }
        expect(brute.length).toBe(2);
        expect(brute[1].time.getTime()-brute[0].time.getTime()).toBeLessThan(30*60000);
        const found = planetEvents(row.planet, new Date(start), new Date(end), row.observer);
        expect(found.length, row.planet).toBe(brute.length);
        for (let i = 0; i < found.length; i++) {
            expect(found[i].kind).toBe(brute[i].kind);
            expect(Math.abs(found[i].time.getTime()-brute[i].time.getTime())).toBeLessThan(60000);
        }
        expect(planetEvents(row.planet, new Date(start), new Date(end), { ...row.observer, latitudeDeg: row.observer.latitudeDeg+0.1 })).toEqual([]);
    }
});
