import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nextLunarEclipse, lunarEclipseVisibility, moonAltAz, sunAltAz, AlmanacOutOfRangeError
} from '../src/index.js';
import type { LunarEclipse } from '../src/index.js';
import { refractionDeg } from '../src/transforms.js';
import type { Observer } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

const SEC = 1000;
const VICTORIA: Observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0 };
const ATHENS: Observer = { latitudeDeg: 37.98, longitudeDeg: 23.72, elevationM: 0 };

interface CatalogRow {
  peakUtc: string;
  kind: 'penumbral' | 'partial' | 'total';
  magPenumbral: number;
  magUmbral: number;
  kindFirm: boolean;
}
interface ContactRow {
  eclipse: string;
  p1: string; u1: string | null; u2: string | null;
  peak: string;
  u3: string | null; u4: string | null; p4: string;
}

const catalog: CatalogRow[] = load('eclipses/espenak-1950-2100.json');
const contacts: ContactRow[] = load('eclipses/contacts.json');

/**
 * One walk of the whole catalog interval, shared by every fixture assertion
 * below — repeated `nextLunarEclipse` from 1950-01-01 until the search runs
 * past the supported interval. 344 eclipses over 150 years is the expensive
 * part of this suite; computing it once and asserting many ways is the point.
 */
const walk: LunarEclipse[] = (() => {
  const found: LunarEclipse[] = [];
  let cursor = new Date('1950-01-01T00:00:00Z');
  for (;;) {
    let e: LunarEclipse;
    try {
      e = nextLunarEclipse(cursor);
    } catch (err) {
      if (err instanceof AlmanacOutOfRangeError) break;
      throw err;
    }
    found.push(e);
    cursor = e.peak;
  }
  return found;
})();

describe('nextLunarEclipse vs the Espenak catalog', () => {
  it('walks 1950-2100 finding every catalog eclipse exactly once, and nothing else', () => {
    // Count plus strict ascent is only half the claim; the "same eclipses, in
    // order" half is the peak-time test below, which compares index-for-index
    // and so fails loudly if the walk ever swapped an eclipse for another.
    expect(walk.length).toBe(catalog.length);
    // Strictly ascending: the walk never re-finds an eclipse it just returned.
    for (let i = 1; i < walk.length; i++)
      expect(walk[i].peak.getTime()).toBeGreaterThan(walk[i - 1].peak.getTime());
  });

  it('never has to scan anywhere near the two-year search bound', () => {
    // The bound `nextLunarEclipse` gives up at is 730 days; the longest gap
    // between consecutive eclipses over 1950-2100 is under half a year, so the
    // bound is a runaway guard, not a limit on real results.
    let maxGapDays = 0;
    for (let i = 1; i < walk.length; i++)
      maxGapDays = Math.max(maxGapDays, (walk[i].peak.getTime() - walk[i - 1].peak.getTime()) / 86400000);
    expect(maxGapDays, `max gap ${maxGapDays.toFixed(1)} d`).toBeLessThan(365);
  });

  it('peak times agree within 60 s', () => {
    const errs = walk.map((e, i) => Math.abs(e.peak.getTime() - Date.parse(catalog[i].peakUtc)) / SEC);
    const worst = Math.max(...errs);
    expect(worst, `worst peak error ${worst.toFixed(1)} s`).toBeLessThanOrEqual(60);
  });

  it('kind matches every firmly-classified catalog row', () => {
    const bad = walk
      .map((e, i) => ({ i, got: e.kind, want: catalog[i].kind, firm: catalog[i].kindFirm }))
      .filter(r => r.firm && r.got !== r.want)
      .map(r => `${catalog[r.i].peakUtc}: got ${r.got}, want ${r.want}`);
    expect(bad).toEqual([]);
  });

  it('umbral and penumbral magnitudes agree within 0.03', () => {
    let worstU = 0, worstP = 0;
    for (let i = 0; i < walk.length; i++) {
      worstU = Math.max(worstU, Math.abs(walk[i].magUmbral - catalog[i].magUmbral));
      worstP = Math.max(worstP, Math.abs(walk[i].magPenumbral - catalog[i].magPenumbral));
    }
    expect(worstU, `worst umbral magnitude error ${worstU.toFixed(4)}`).toBeLessThanOrEqual(0.03);
    expect(worstP, `worst penumbral magnitude error ${worstP.toFixed(4)}`).toBeLessThanOrEqual(0.03);
  });

  it('contact shape always matches the reported kind', () => {
    for (const e of walk) {
      if (e.kind === 'penumbral') {
        expect([e.u1, e.u2, e.u3, e.u4]).toEqual([null, null, null, null]);
      } else if (e.kind === 'partial') {
        expect(e.u1).toBeInstanceOf(Date); expect(e.u4).toBeInstanceOf(Date);
        expect([e.u2, e.u3]).toEqual([null, null]);
      } else {
        for (const c of [e.u1, e.u2, e.u3, e.u4]) expect(c).toBeInstanceOf(Date);
      }
      expect(e.p1.getTime()).toBeLessThan(e.peak.getTime());
      expect(e.p4.getTime()).toBeGreaterThan(e.peak.getTime());
    }
  });
});

describe('contact times vs the Espenak circumstances tables', () => {
  const byDay = new Map(walk.map(e => [e.peak.toISOString().slice(0, 10), e]));
  const KEYS = ['p1', 'u1', 'u2', 'peak', 'u3', 'u4', 'p4'] as const;

  for (const row of contacts) {
    it(`${row.eclipse} contacts within 60 s`, () => {
      const e = byDay.get(row.eclipse);
      expect(e, `no eclipse found on ${row.eclipse}`).toBeDefined();
      for (const k of KEYS) {
        const want = row[k];
        const got = e![k];
        if (want === null) { expect(got, `${k} should be absent`).toBeNull(); continue; }
        expect(got, `${k} should be present`).not.toBeNull();
        const err = Math.abs(got!.getTime() - Date.parse(want)) / SEC;
        expect(err, `${k} off by ${err.toFixed(1)} s`).toBeLessThanOrEqual(60);
      }
    });
  }
});

describe('2026-08-28 partial eclipse — the boundary regression', () => {
  const e = walk.find(x => x.peak.toISOString().startsWith('2026-08-28'))!;

  it('is a partial eclipse just short of totality', () => {
    expect(e).toBeDefined();
    expect(e.kind).toBe('partial');
    expect(Math.abs(e.magUmbral - 0.93), `magUmbral ${e.magUmbral.toFixed(4)}`).toBeLessThanOrEqual(0.03);
  });

  it('is above the horizon at peak from Victoria and below it from Athens', () => {
    const vic = lunarEclipseVisibility(e, VICTORIA);
    const ath = lunarEclipseVisibility(e, ATHENS);
    expect(vic.visibleAtPeak).toBe(true);
    expect(vic.moonGeometricAltAtPeakDeg).toBeGreaterThan(0);
    expect(ath.visibleAtPeak).toBe(false);
    expect(ath.moonGeometricAltAtPeakDeg).toBeLessThan(0);
  });
});

describe('lunarEclipseVisibility', () => {
  const total = walk.find(x => x.peak.toISOString().startsWith('2019-01-21'))!;
  const penumbral = walk.find(x => x.peak.toISOString().startsWith('2020-11-30'))!;

  it('reports a boolean for every present contact of a total eclipse', () => {
    const v = lunarEclipseVisibility(total, VICTORIA);
    for (const k of ['p1', 'u1', 'u2', 'u3', 'u4', 'p4'] as const)
      expect(typeof v.contactsVisible[k], `${k}`).toBe('boolean');
    // 2019-01-21 was the "super blood wolf moon": the whole event was above
    // the horizon over western North America.
    expect(Object.values(v.contactsVisible)).toEqual([true, true, true, true, true, true]);
  });

  it('reports null exactly where a penumbral eclipse has no umbral contact', () => {
    const v = lunarEclipseVisibility(penumbral, VICTORIA);
    expect(typeof v.contactsVisible.p1).toBe('boolean');
    expect(typeof v.contactsVisible.p4).toBe('boolean');
    expect([v.contactsVisible.u1, v.contactsVisible.u2, v.contactsVisible.u3, v.contactsVisible.u4])
      .toEqual([null, null, null, null]);
  });

  it('altitude at peak is geometric (unrefracted) topocentric centre', () => {
    const v = lunarEclipseVisibility(total, VICTORIA);
    // The public moonAltAz applies the 'normal' refraction model on top of the
    // same topocentric centre, so the two differ by exactly that lift.
    const refracted = moonAltAz(total.peak, VICTORIA).altDeg;
    expect(refracted - v.moonGeometricAltAtPeakDeg)
      .toBeCloseTo(refractionDeg(v.moonGeometricAltAtPeakDeg), 12);
    // Independent physical check: at a total lunar eclipse the Moon sits within
    // ~1 degree of the anti-solar point, so its altitude mirrors the Sun's up to
    // the Moon's horizontal parallax (~1 degree).
    const sunAlt = sunAltAz(total.peak, VICTORIA).altDeg;
    expect(Math.abs(v.moonGeometricAltAtPeakDeg + sunAlt)).toBeLessThan(2.5);
    // Regression on the numeric value itself.
    expect(v.moonGeometricAltAtPeakDeg).toBeCloseTo(41.71, 1);
  });

  it('validates the observer', () => {
    expect(() => lunarEclipseVisibility(total, { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  });
});

describe('lunarEclipseVisibility rejects malformed eclipses', () => {
  const total = walk.find(x => x.peak.toISOString().startsWith('2019-01-21'))!;
  const bad = (patch: Partial<LunarEclipse>): LunarEclipse => ({ ...total, ...patch });

  it('u2 present without u3', () => {
    expect(() => lunarEclipseVisibility(bad({ u3: null }), VICTORIA)).toThrow(RangeError);
  });
  it('kind total without umbral totality contacts', () => {
    expect(() => lunarEclipseVisibility(bad({ u2: null, u3: null }), VICTORIA)).toThrow(RangeError);
  });
  it('kind partial carrying totality contacts', () => {
    expect(() => lunarEclipseVisibility(bad({ kind: 'partial' }), VICTORIA)).toThrow(RangeError);
  });
  it('kind penumbral carrying umbral contacts', () => {
    expect(() => lunarEclipseVisibility(bad({ kind: 'penumbral' }), VICTORIA)).toThrow(RangeError);
  });
  it('unknown kind', () => {
    expect(() => lunarEclipseVisibility(bad({ kind: 'annular' as LunarEclipse['kind'] }), VICTORIA)).toThrow(RangeError);
  });
  it('peak before p1', () => {
    expect(() => lunarEclipseVisibility(bad({ peak: new Date(total.p1.getTime() - 1) }), VICTORIA)).toThrow(RangeError);
  });
  it('contacts out of order', () => {
    expect(() => lunarEclipseVisibility(bad({ u4: new Date(total.u3!.getTime() - 1) }), VICTORIA)).toThrow(RangeError);
  });
  it('duplicate contact instants', () => {
    expect(() => lunarEclipseVisibility(bad({ u3: new Date(total.peak.getTime()) }), VICTORIA)).toThrow(RangeError);
  });
  it('an undefined contact is treated as absent, not as a Date', () => {
    // `undefined` where `null` was meant is what a JSON round-trip or a
    // hand-built object produces. The validator counts it absent, so the kind
    // check must reject it for a total eclipse...
    expect(() => lunarEclipseVisibility(bad({ u2: undefined as unknown as null }), VICTORIA)).toThrow(RangeError);
    // ...an always-present contact must be rejected outright...
    expect(() => lunarEclipseVisibility(bad({ p1: undefined as unknown as Date }), VICTORIA)).toThrow(RangeError);
    // ...and where it IS legitimately absent, the reader must agree and report
    // null rather than handing `undefined` to the ephemeris.
    const penum = walk.find(x => x.peak.toISOString().startsWith('2020-11-30'))!;
    const loose = { ...penum, u1: undefined as unknown as null, u4: undefined as unknown as null };
    const v = lunarEclipseVisibility(loose, VICTORIA);
    expect([v.contactsVisible.u1, v.contactsVisible.u4]).toEqual([null, null]);
  });
  it('NaN time', () => {
    expect(() => lunarEclipseVisibility(bad({ p4: new Date(NaN) }), VICTORIA)).toThrow(RangeError);
    expect(() => lunarEclipseVisibility(bad({ peak: new Date(NaN) }), VICTORIA)).toThrow(RangeError);
  });
  it('accepts a well-formed eclipse', () => {
    expect(() => lunarEclipseVisibility(total, VICTORIA)).not.toThrow();
  });
});

describe('nextLunarEclipse range handling', () => {
  it('rejects a start time outside the supported interval', () => {
    expect(() => nextLunarEclipse(new Date('1949-12-31T00:00:00Z'))).toThrow(AlmanacOutOfRangeError);
    expect(() => nextLunarEclipse(new Date(NaN))).toThrow(RangeError);
  });

  it('throws when the next eclipse falls past the end of the interval', () => {
    expect(() => nextLunarEclipse(new Date('2100-11-01T00:00:00Z'))).toThrow(AlmanacOutOfRangeError);
  });

  it('returns strictly the next eclipse when called with an eclipse peak', () => {
    const first = nextLunarEclipse(new Date('2026-01-01T00:00:00Z'));
    const second = nextLunarEclipse(first.peak);
    expect(second.peak.getTime()).toBeGreaterThan(first.peak.getTime());
    // and a query just before a peak still returns that peak
    const again = nextLunarEclipse(new Date(first.peak.getTime() - 1000));
    expect(again.peak.getTime()).toBe(first.peak.getTime());
  });

  it('pins the same-eclipse band at 100 ms either side of the boundary', () => {
    const e = nextLunarEclipse(new Date('2026-01-01T00:00:00Z'));
    const peak = e.peak.getTime();
    // Inside the band: judged the caller's own previous result, so the search
    // moves on to the next eclipse. This is the band's accepted cost.
    expect(nextLunarEclipse(new Date(peak - 100)).peak.getTime()).toBeGreaterThan(peak);
    // One millisecond outside it: the same eclipse, exactly.
    expect(nextLunarEclipse(new Date(peak - 101)).peak.getTime()).toBe(peak);
  });

  it('returns integer-millisecond instants', () => {
    const e = nextLunarEclipse(new Date('2026-01-01T00:00:00Z'));
    for (const t of [e.peak, e.p1, e.p4, e.u1, e.u4])
      if (t) expect(Number.isInteger(t.getTime())).toBe(true);
  });
});
