import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { moonIllumination } from '../src/index.js';
import { moonIlluminationAtTT } from '../src/illumination.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

// Coarse fixtures are TT-labeled: feed row.tt straight to the internal TT
// entry point, same as positions.test.ts.
const ttDaysOf = (tt: string) => (Date.parse(tt) - Date.UTC(2000, 0, 1, 12)) / 86400000;

it('moon-coarse illumFraction within 0.01', () => {
  for (const row of load('positions/moon-coarse.json')) {
    const m = moonIlluminationAtTT(ttDaysOf(row.tt));
    expect(Math.abs(m.fraction - row.illumFraction), `@ ${row.tt}`).toBeLessThan(0.01);
  }
});

// Dense fixtures stay UT-labeled and exercise the public API end to end.
it('moon-dense illumFraction within 0.01', () => {
  for (const row of load('positions/moon-dense.json')) {
    const m = moonIllumination(new Date(row.utc));
    expect(Math.abs(m.fraction - row.illumFraction), `@ ${row.utc}`).toBeLessThan(0.01);
  }
});

it('phase self-consistency: 2026-08-28T04:00Z partial lunar eclipse night = full moon', () => {
  const m = moonIllumination(new Date('2026-08-28T04:00:00Z'));
  expect(m.phase).toBeGreaterThan(0.45);
  expect(m.phase).toBeLessThan(0.55);
});

const phaseRows: { phase: string; utc: string }[] = load('phases/usno-phases.json');

it('USNO firstQuarter ~ phase 0.25, waxing', () => {
  const row = phaseRows.find((r) => r.phase === 'firstQuarter')!;
  const m = moonIllumination(new Date(row.utc));
  expect(m.phase).toBeGreaterThan(0.23);
  expect(m.phase).toBeLessThan(0.27);
  expect(m.waxing).toBe(true);
});

it('USNO lastQuarter ~ phase 0.75, not waxing', () => {
  const row = phaseRows.find((r) => r.phase === 'lastQuarter')!;
  const m = moonIllumination(new Date(row.utc));
  expect(m.phase).toBeGreaterThan(0.73);
  expect(m.phase).toBeLessThan(0.77);
  expect(m.waxing).toBe(false);
});
