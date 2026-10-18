import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { earthApsides, planetHeliocentricPosition, AlmanacOutOfRangeError } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';
import { KM_PER_AU } from '../src/nutation.js';
const rows: {utc: string; kind: string; distanceKm: number}[] = JSON.parse(readFileSync(new URL('../../fixtures/raw/earth-apsides/reference.json', import.meta.url), 'utf8')).rows;
const start = new Date(SUPPORTED_MIN), end = new Date(SUPPORTED_MAX);

it('matches all 302 pinned Astronomy Engine Earth apsides within 2 seconds and 1 millimeter', () => {
  const all = earthApsides(start, end);
  expect(all.length).toBe(302);
  expect(all.length).toBe(rows.length);
  all.forEach((a, i) => {
    expect(a.kind).toBe(rows[i].kind);
    expect(Math.abs(a.time.getTime() - Date.parse(rows[i].utc))).toBeLessThan(2000);
    expect(Math.abs(a.distanceKm - rows[i].distanceKm)).toBeLessThan(0.001);
    if (i) { expect(a.time.getTime()).toBeGreaterThan(all[i-1].time.getTime()); expect(a.kind).not.toBe(all[i-1].kind); }
  });
});

it('reports the geometric Sun–Earth distance and an extremum', () => {
  const distance = (time: Date) => { const p = planetHeliocentricPosition('earth', time); return Math.hypot(p.xAu, p.yAu, p.zAu)*KM_PER_AU; };
  for (const a of earthApsides(new Date('2026-01-01Z'), new Date('2027-01-01Z'))) {
    expect(Math.abs(a.distanceKm-distance(a.time))).toBeLessThan(0.001);
    for (const offset of [-86400000, 86400000]) expect((distance(new Date(+a.time+offset))-a.distanceKm)*(a.kind === 'perihelion' ? 1 : -1)).toBeGreaterThan(0);
  }
});

it('every reported millisecond partitions adjacent windows exactly, including before 1970', () => {
  const all = earthApsides(start, end);
  for (const a of all) {
    const lo = new Date(+a.time-1), hi = new Date(+a.time+1);
    expect(earthApsides(lo,a.time)).toEqual([]);
    expect(earthApsides(a.time,hi)).toEqual([a]);
    expect(earthApsides(lo,hi)).toEqual([a]);
  }
  const split = new Date('2026-04-01Z');
  expect([...earthApsides(start,split),...earthApsides(split,end)]).toEqual(all);
});

it('validates bounds before handling empty/reversed windows', () => {
  expect(earthApsides(start,start)).toEqual([]);
  expect(earthApsides(new Date('2026-01-01Z'),start)).toEqual([]);
  expect(() => earthApsides(new Date(SUPPORTED_MIN-1),end)).toThrow(AlmanacOutOfRangeError);
  expect(() => earthApsides(start,new Date(SUPPORTED_MAX+1))).toThrow(AlmanacOutOfRangeError);
  expect(() => earthApsides(end,start)).toThrow(AlmanacOutOfRangeError);
  expect(() => earthApsides(new Date(NaN),end)).toThrow();
});
