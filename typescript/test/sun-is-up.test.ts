import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunIsUp, sunEvents, sunAltAz, AlmanacOutOfRangeError } from '../src/index.js';

it('agrees with independent USNO sunrise/set evidence through 2050', () => {
    const rows = JSON.parse(readFileSync(new URL('../../fixtures/events/usno-grid.json', import.meta.url), 'utf8'));
    for (const row of rows) {
        if (+row.date.slice(0, 4) > 2050) continue;
        const observer = { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg };
        for (const kind of ['rise', 'set']) {
            if (!row.sun[kind]) continue;
            const time = Date.parse(row.date + 'T' + row.sun[kind] + ':00Z');
            expect(sunIsUp(new Date(time - 60000), observer)).toBe(kind === 'set');
            expect(sunIsUp(new Date(time + 60000), observer)).toBe(kind === 'rise');
        }
    }
});

it('reports day and night without requiring rise/set events in a window', () => {
    const equator = { latitudeDeg: 0, longitudeDeg: 0 };
    expect(sunIsUp(new Date('2024-06-21T12:00Z'), equator)).toBe(true);
    expect(sunIsUp(new Date('2024-06-21T00:00Z'), equator)).toBe(false);
    const polar = { latitudeDeg: 78.2, longitudeDeg: 15.6 };
    expect(sunIsUp(new Date('2024-06-21T23:30Z'), polar)).toBe(true);
    expect(sunIsUp(new Date('2024-12-21T12:00Z'), polar)).toBe(false);
});

it('recognizes the upper limb during the short polar day missed by a fixed altitude threshold', () => {
    const observer = { latitudeDeg: 70.5, longitudeDeg: 0 };
    const time = new Date('2024-11-22T11:29:40Z');
    expect(sunAltAz(time, observer).altDeg).toBeLessThan(-0.211);
    expect(sunIsUp(time, observer)).toBe(true);
    expect(sunIsUp(new Date('2024-11-22T11:29:36Z'), observer)).toBe(false);
    expect(sunIsUp(new Date('2024-11-22T12:01:55Z'), observer)).toBe(true);
    expect(sunIsUp(new Date('2024-11-22T12:01:59Z'), observer)).toBe(false);
});

it('switches across rise and set in both seasons, including grazing polar crossings', () => {
    for (const latitudeDeg of [0, 60, -40, 70.5, 84.9]) {
        const observer = { latitudeDeg, longitudeDeg: 0 };
        for (const start of ['2024-06-21', '2025-01-03', '2024-11-22', '2024-03-05']) {
            const from = new Date(start);
            for (const event of sunEvents(from, new Date(from.getTime() + 86400000), observer)) {
                if (event.kind !== 'rise' && event.kind !== 'set') continue;
                expect(sunIsUp(new Date(event.time.getTime() - 2000), observer)).toBe(event.kind === 'set');
                expect(sunIsUp(new Date(event.time.getTime() + 2000), observer)).toBe(event.kind === 'rise');
            }
        }
    }
});

it('uses eye height separately from elevation and agrees with elevated rise/set', () => {
    const observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 100 };
    const from = new Date('2026-03-20T00:00Z'), to = new Date('2026-03-21T00:00Z');
    const raised = sunEvents(from, to, observer, 100);
    const rise = raised.find(e => e.kind === 'rise')!;
    const afterRise = new Date(rise.time.getTime() + 2000);
    expect(sunIsUp(afterRise, observer, 100)).toBe(true);
    expect(sunIsUp(afterRise, observer)).toBe(false);
    expect(sunIsUp(afterRise, observer, 0)).toBe(false);
    for (const event of raised.filter(e => e.kind === 'rise' || e.kind === 'set')) {
        expect(sunIsUp(new Date(event.time.getTime() - 2000), observer, 100)).toBe(event.kind === 'set');
        expect(sunIsUp(new Date(event.time.getTime() + 2000), observer, 100)).toBe(event.kind === 'rise');
    }
});

it('validates dates, observers, eye height, and derived ground elevation', () => {
    const observer = { latitudeDeg: 0, longitudeDeg: 0 };
    const time = new Date('2026-03-20T12:00Z');
    for (const invalid of [new Date(NaN), new Date('1949-12-31'), new Date('2101-01-01')]) {
        expect(() => sunIsUp(invalid, observer)).toThrow(RangeError);
    }
    expect(() => sunIsUp(new Date('1949-12-31'), observer)).toThrow(AlmanacOutOfRangeError);
    expect(() => sunIsUp(new Date(NaN), observer)).not.toThrow(AlmanacOutOfRangeError);
    expect(() => sunIsUp(time, { ...observer, latitudeDeg: 91 })).toThrow(RangeError);
    for (const height of [NaN, Infinity, -1, 10001]) expect(() => sunIsUp(time, observer, height)).toThrow(RangeError);
    expect(() => sunIsUp(time, { ...observer, elevationM: -499 }, 2)).toThrow(RangeError);
    for (const boundary of ['1950-01-01T00:00Z', '2100-12-31T23:59:59.999Z']) {
        expect(typeof sunIsUp(new Date(boundary), observer)).toBe('boolean');
    }
});
