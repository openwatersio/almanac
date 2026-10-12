import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  sunAltAz, moonAltAz, planetAltAz, moonIllumination,
  sunEvents, moonEvents, searchMoonPhases, lunarEclipses, lunarEclipseVisibility,
  type Observer,
} from '../src/index.js';

function briefingPositions(time: Date, observer: Observer) {
  return {
    sun: sunAltAz(time, observer),
    moon: moonAltAz(time, observer),
    venus: planetAltAz('venus', time, observer),
  };
}

function briefingMoon(time: Date) {
  const { phase, fraction } = moonIllumination(time);
  return { phaseDeg: phase * 360, fraction };
}

function passageCrossings(start: Date, end: Date, observer: Observer) {
  return {
    sun: sunEvents(start, end, observer),
    moon: moonEvents(start, end, observer),
    phases: searchMoonPhases(start, end),
  };
}

function visibleLunarEclipses(start: Date, end: Date, observer: Observer) {
  return lunarEclipses(start, end).filter(eclipse => lunarEclipseVisibility(eclipse, observer).visibleAtPeak);
}

const reference = JSON.parse(readFileSync(new URL('./migration-references.json', import.meta.url), 'utf8'));

it('the Astronomy Engine guide examples are executable test inputs', () => {
  const url = new URL('../../docs/migrating-from-astronomy-engine.md', import.meta.url);
  const guide = readFileSync(url, 'utf8');
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const blocks = [...guide.matchAll(/```ts\n([\s\S]*?)```/g)].map(m => m[1].replaceAll("'@openwaters/almanac'", "'../src/index.js'"));
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) expect(source, block.slice(0, 80)).toContain(block);
});

it('the position recipe preserves Astronomy Engine normal-refraction coordinates', () => {
  for (const ref of reference.astronomyEngine) {
    const positions = briefingPositions(new Date(ref.time), { latitudeDeg: ref.latitudeDeg, longitudeDeg: ref.longitudeDeg });
    for (const body of ['sun', 'moon', 'venus'] as const) {
      expect(Math.abs(positions[body].altDeg - ref[body].altDeg)).toBeLessThan(1 / 60);
      expect(Math.abs(positions[body].azDeg - ref[body].azDeg)).toBeLessThan(1 / 60);
    }
  }
});

it('the Moon recipe uses the phase cycle rather than the illumination angle', () => {
  for (const ref of reference.astronomyEngine) {
    const state = briefingMoon(new Date(ref.time));
    expect(Math.abs(state.phaseDeg - ref.phaseDeg)).toBeLessThan(1 / 60);
    expect(Math.abs(state.fraction - ref.fraction)).toBeLessThan(1e-6);
  }
});

it('the passage recipe returns crossings and exact phases inside its window', () => {
  const start = new Date('2026-08-10T00:00:00Z');
  const end = new Date('2026-08-14T00:00:00Z');
  const sky = passageCrossings(start, end, { latitudeDeg: 48.4284, longitudeDeg: -123.3656 });
  expect(sky.sun.filter(e => e.kind === 'rise')).toHaveLength(4);
  expect(sky.moon.some(e => e.kind === 'set')).toBe(true);
  expect(sky.phases).toHaveLength(1);
  expect(sky.phases[0].phase).toBe('new');
  expect(sky.phases[0].time.toISOString()).toMatch(/^2026-08-12T17:36:/);
  for (const list of [sky.sun, sky.moon, sky.phases]) {
    expect(list.every(e => e.time >= start && e.time < end)).toBe(true);
  }
});

it('the lunar visibility recipe excludes the eclipse when the Moon is below the horizon', () => {
  const start = new Date('2026-03-01T00:00:00Z');
  const end = new Date('2026-03-05T00:00:00Z');
  const pacific = visibleLunarEclipses(start, end, { latitudeDeg: 20, longitudeDeg: -160 });
  expect(pacific).toHaveLength(1);
  expect(pacific[0].kind).toBe('total');
  expect(pacific[0].peak.toISOString()).toMatch(/^2026-03-03T11:33:/);
  expect(visibleLunarEclipses(start, end, { latitudeDeg: 20, longitudeDeg: 60 })).toEqual([]);
});
