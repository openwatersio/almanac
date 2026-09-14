import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nextSolarEclipse, previousSolarEclipse, solarEclipses, solarObscuration, sunAltAz, AlmanacOutOfRangeError
} from '../src/index.js';
import type { Observer, SolarEclipse } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';
import { refractionDeg } from '../src/transforms.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

const DAY = 86400000;
const VICTORIA: Observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0 };
/** A path at least this wide keeps the catalog's whole-degree observer inside it. */
const WIDE_PATH_KM = 200;

interface CatalogRow {
  peakUtc: string;
  kind: 'partial' | 'annular' | 'total' | 'hybrid';
  central: boolean;
  gamma: number;
  magnitude: number;
  latitudeDeg: number;
  longitudeDeg: number;
  sunAltDeg: number;
  pathWidthKm: number | null;
}

const catalog: CatalogRow[] = load('eclipses/solar-catalog.json');
const observerOf = (row: CatalogRow): Observer => ({ latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg });
const isWide = (row: CatalogRow) => row.pathWidthKm !== null && row.pathWidthKm >= WIDE_PATH_KM;

const SEC = 1000;
const CONTACT_KEYS = ['c1', 'c2', 'peak', 'c3', 'c4'] as const;

interface Contact { utc: string; sunAltDeg: number | null }
interface LocalRow {
  eclipse: string; place: string; latitudeDeg: number; longitudeDeg: number; visible: boolean;
  kind?: 'partial' | 'annular' | 'total'; magnitude?: number; obscuration?: number;
  c1?: Contact | null; c2?: Contact | null; peak?: Contact; c3?: Contact | null; c4?: Contact | null;
}
const local: LocalRow[] = load('eclipses/solar-local.json');

/** The window `[eclipse day − 1, eclipse day + 2)` a USNO case lives in. */
function windowOf(row: LocalRow): [Date, Date] {
  const day = Date.parse(`${row.eclipse}T00:00:00Z`);
  return [new Date(day - DAY), new Date(day + 2 * DAY)];
}

describe('solarObscuration at the point of greatest eclipse', () => {
  it('covers 1950-2100', () => {
    expect(catalog.length).toBeGreaterThan(300);
    expect(catalog[0].peakUtc.startsWith('1950')).toBe(true);
    expect(catalog[catalog.length - 1].peakUtc.startsWith('2100')).toBe(true);
  });

  it('obscuration at greatest eclipse matches every catalog row\'s kind and magnitude', () => {
    const bad: string[] = [];
    for (const row of catalog) {
      const obs = solarObscuration(new Date(row.peakUtc), observerOf(row));
      const wide = isWide(row);
      let ok: boolean;
      if (row.kind === 'partial') ok = obs > 0;
      else if (row.kind === 'annular') ok = wide ? Math.abs(obs - row.magnitude ** 2) <= 0.01 : obs >= row.magnitude ** 2 - 0.1;
      else ok = wide ? obs === 1 : obs >= 0.9;   // total and hybrid
      if (!ok) bad.push(`${row.peakUtc} ${row.kind}${wide ? '' : ' (narrow)'}: obscuration ${obs.toFixed(4)}, magnitude ${row.magnitude}`);
    }
    expect(bad).toEqual([]);
  });

  it('is zero a day away from any eclipse', () => {
    expect(solarObscuration(new Date('2026-01-15T20:00:00Z'), VICTORIA)).toBe(0);
  });

  it('validates its inputs', () => {
    expect(() => solarObscuration(new Date(SUPPORTED_MAX), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => solarObscuration(new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => solarObscuration(new Date('2026-01-15T20:00:00Z'), { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  });
});

describe('local circumstances vs USNO', () => {
  for (const row of local) {
    const observer: Observer = { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg };
    const found = solarEclipses(...windowOf(row), observer);
    const label = `${row.eclipse} ${row.place}`;

    if (!row.visible) {
      it(`${label}: nothing to see`, () => expect(found).toEqual([]));
      continue;
    }

    it(`${label}: one ${row.kind} eclipse`, () => {
      expect(found.map(e => e.peak.toISOString())).toHaveLength(1);
      expect(found[0].kind).toBe(row.kind);
    });

    it(`${label}: contacts within 60 s, peak within 5 min, altitudes within 0.5° and 1.5°`, () => {
      const e = found[0];
      for (const k of CONTACT_KEYS) {
        const want = row[k];
        if (want == null) {
          // c2/c3 absent for a partial; c1/c4 absent when USNO listed a
          // sunrise or sunset instead, which means the Sun was down at ours.
          if (k === 'c2' || k === 'c3') expect(e[k], `${k} should be absent`).toBeNull();
          else expect(e.sunAltDeg[k], `${k} should be below the horizon`).toBeLessThan(0);
          continue;
        }
        const got = e[k];
        expect(got, `${k} should be present`).not.toBeNull();
        const err = Math.abs(got!.getTime() - Date.parse(want.utc)) / SEC;
        expect(err, `${k} off by ${err.toFixed(1)} s`).toBeLessThanOrEqual(k === 'peak' ? 300 : 60);
        if (want.sunAltDeg !== null) {
          // USNO reports the geometric altitude; refract it with the port's own model to compare like with like.
          const altErr = Math.abs(e.sunAltDeg[k]! - (want.sunAltDeg + refractionDeg(want.sunAltDeg)));
          expect(altErr, `${k} altitude off by ${altErr.toFixed(2)}°`).toBeLessThanOrEqual(k === 'peak' ? 1.5 : 0.5);
        }
      }
    });

    it(`${label}: obscuration within 0.01`, () => {
      const err = Math.abs(found[0].obscuration - row.obscuration!);
      expect(err, `obscuration off by ${err.toFixed(4)}`).toBeLessThanOrEqual(0.01);
    });
  }
});

describe('the search vs the catalog, from the point of greatest eclipse', () => {
  it('finds every central total, annular and hybrid eclipse with the right kind', () => {
    const bad: string[] = [];
    for (const row of catalog) {
      if (row.kind === 'partial' || !row.central) continue;
      const peakMs = Date.parse(row.peakUtc);
      const found = solarEclipses(new Date(peakMs - DAY), new Date(peakMs + DAY), observerOf(row));
      if (found.length !== 1) { bad.push(`${row.peakUtc}: ${found.length} eclipses`); continue; }
      const e = found[0];
      const dt = Math.abs(e.peak.getTime() - peakMs) / SEC;
      if (dt > 300) bad.push(`${row.peakUtc}: peak off by ${dt.toFixed(0)} s`);
      const wide = isWide(row);
      const wanted: string[] = row.kind === 'hybrid' ? ['total', 'annular'] : [row.kind];
      if (!wide) wanted.push('partial');
      if (!wanted.includes(e.kind)) bad.push(`${row.peakUtc}: kind ${e.kind}, catalog ${row.kind}${wide ? '' : ' (narrow path)'}`);
      const altErr = Math.abs(e.sunAltDeg.peak - row.sunAltDeg);
      if (altErr > 2) bad.push(`${row.peakUtc}: peak altitude ${e.sunAltDeg.peak.toFixed(1)}, catalog ${row.sunAltDeg}`);
    }
    expect(bad).toEqual([]);
  });

  it('drops an eclipse the antipode could only see through the Earth', () => {
    // Under |gamma| 0.2 the antipode's axis distance (2·gamma·R) is inside the
    // penumbra, so only the night filter can exclude it.
    const rows = catalog.filter(r => r.central && r.kind !== 'partial' && Math.abs(r.gamma) < 0.2);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const antipode: Observer = {
        latitudeDeg: -row.latitudeDeg,
        longitudeDeg: row.longitudeDeg > 0 ? row.longitudeDeg - 180 : row.longitudeDeg + 180
      };
      const peakMs = Date.parse(row.peakUtc);
      expect(solarObscuration(new Date(peakMs), antipode), `${row.peakUtc} antipode obscuration`).toBeGreaterThan(0);
      expect(solarEclipses(new Date(peakMs - DAY), new Date(peakMs + DAY), antipode), `${row.peakUtc} antipode search`).toEqual([]);
    }
  });
});

describe('search semantics from Victoria', () => {
  /** Every eclipse Victoria can see, 1950-2100, by repeated next. */
  const walk: SolarEclipse[] = (() => {
    const found: SolarEclipse[] = [];
    let cursor = new Date(SUPPORTED_MIN);
    for (;;) {
      let e: SolarEclipse;
      try { e = nextSolarEclipse(cursor, VICTORIA); } catch (err) {
        if (err instanceof AlmanacOutOfRangeError) break;
        throw err;
      }
      found.push(e);
      cursor = e.peak;
    }
    return found;
  })();

  it('sees a few dozen eclipses in 151 years, strictly ascending', () => {
    expect(walk.length).toBeGreaterThan(30);
    for (let i = 1; i < walk.length; i++)
      expect(walk[i].peak.getTime()).toBeGreaterThan(walk[i - 1].peak.getTime());
  });

  it('finds the same eclipses backward and in one range, including contacts', () => {
    const backward: SolarEclipse[] = [];
    let cursor = new Date(SUPPORTED_MAX - 1);
    for (let i = 0; i <= walk.length; i++) {
      try {
        const e = previousSolarEclipse(cursor, VICTORIA);
        expect(e.peak.getTime()).toBeLessThan(cursor.getTime());
        backward.push(e);
        cursor = e.peak;
      } catch (err) {
        if (err instanceof AlmanacOutOfRangeError) break;
        throw err;
      }
    }
    const range = solarEclipses(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX), VICTORIA);
    expect(backward.reverse()).toEqual(walk);
    expect(range).toEqual(walk);
  });

  it('includes each returned peak at the range start and excludes it at the end', () => {
    for (const e of walk) {
      const at = e.peak.getTime();
      expect(solarEclipses(new Date(at), new Date(at + 1), VICTORIA).map(x => x.peak.getTime()), e.peak.toISOString()).toEqual([at]);
      expect(solarEclipses(new Date(at - 1), new Date(at), VICTORIA), e.peak.toISOString()).toEqual([]);
    }
  });

  it('pins the same-eclipse band at 100 ms either side of the anchor', () => {
    const e = walk.find(x => x.peak.getTime() > Date.UTC(2000, 0, 1))!;
    const at = e.peak.getTime();
    expect(nextSolarEclipse(new Date(at - 100), VICTORIA).peak.getTime()).toBeGreaterThan(at);
    expect(nextSolarEclipse(new Date(at - 101), VICTORIA).peak.getTime()).toBe(at);
    expect(previousSolarEclipse(new Date(at + 100), VICTORIA).peak.getTime()).toBeLessThan(at);
    expect(previousSolarEclipse(new Date(at + 101), VICTORIA).peak.getTime()).toBe(at);
  });

  it('reports contacts in order, integer milliseconds, with the altitude sunAltAz gives', () => {
    for (const e of walk) {
      const order = [e.c1, e.c2, e.peak, e.c3, e.c4].filter((d): d is Date => d !== null);
      for (let i = 1; i < order.length; i++) expect(order[i].getTime()).toBeGreaterThan(order[i - 1].getTime());
      for (const d of order) expect(Number.isInteger(d.getTime())).toBe(true);
      expect((e.c2 === null) === (e.kind === 'partial')).toBe(true);
      expect((e.c3 === null) === (e.kind === 'partial')).toBe(true);
      expect(e.sunAltDeg.c1).toBe(sunAltAz(e.c1, VICTORIA).altDeg);
      expect(e.sunAltDeg.peak).toBe(sunAltAz(e.peak, VICTORIA).altDeg);
      expect(e.sunAltDeg.c4).toBe(sunAltAz(e.c4, VICTORIA).altDeg);
      expect(e.sunAltDeg.c1 > 0 || e.sunAltDeg.peak > 0 || e.sunAltDeg.c4 > 0).toBe(true);
      if (e.kind === 'total') expect(e.obscuration).toBe(1);
      else expect(e.obscuration).toBeGreaterThan(0);
      if (e.kind !== 'total') expect(e.obscuration).toBeLessThan(1);
    }
  });

  it('obscuration at an instant agrees with the peak and reaches 1 in totality', () => {
    const victoria2024 = local.find(r => r.place.startsWith('Victoria'))!;
    const e = solarEclipses(...windowOf(victoria2024), { latitudeDeg: victoria2024.latitudeDeg, longitudeDeg: victoria2024.longitudeDeg })[0];
    expect(Math.abs(solarObscuration(e.peak, { latitudeDeg: victoria2024.latitudeDeg, longitudeDeg: victoria2024.longitudeDeg }) - e.obscuration)).toBeLessThan(1e-6);

    const salem = local.find(r => r.place.startsWith('Salem'))!;
    const salemObserver: Observer = { latitudeDeg: salem.latitudeDeg, longitudeDeg: salem.longitudeDeg };
    const t = solarEclipses(...windowOf(salem), salemObserver)[0];
    const mid = new Date((t.c2!.getTime() + t.c3!.getTime()) / 2);
    expect(solarObscuration(mid, salemObserver)).toBe(1);
    expect(solarObscuration(new Date(t.c1.getTime() - 60 * SEC), salemObserver)).toBe(0);
  });

  it('validates inputs before returning an empty window and reaches the boundary as out-of-range', () => {
    const from = new Date('2026-09-01T00:00:00Z'), to = new Date('2026-09-10T12:00:00Z');
    expect(solarEclipses(from, to, VICTORIA)).toEqual([]);
    expect(solarEclipses(to, from, VICTORIA)).toEqual([]);
    expect(() => solarEclipses(to, from, { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
    expect(() => solarEclipses(new Date(NaN), to, VICTORIA)).toThrow(RangeError);
    expect(() => solarEclipses(from, new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => solarEclipses(new Date(SUPPORTED_MIN - 1), to, VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => solarEclipses(from, new Date(SUPPORTED_MAX + 1), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => nextSolarEclipse(new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => nextSolarEclipse(from, { latitudeDeg: 0, longitudeDeg: 181 })).toThrow(RangeError);
    expect(() => nextSolarEclipse(new Date(Date.parse(catalog[catalog.length - 1].peakUtc) + DAY), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => previousSolarEclipse(new Date(Date.parse(catalog[0].peakUtc) - DAY), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => previousSolarEclipse(new Date(SUPPORTED_MAX), VICTORIA)).toThrow(AlmanacOutOfRangeError);
  });
});

describe('the night filter keeps an eclipse the Sun is up for only at its peak', () => {
  it('keeps an eclipse the Sun is up for only at its peak', () => {
    // 68°N in early December: the Sun clears the horizon for minutes around
    // noon, and on 1956-12-02 the local peak falls inside them while C1 and
    // C4 do not. Upstream would drop this eclipse; the peak clause keeps it.
    const polar: Observer = { latitudeDeg: 68, longitudeDeg: 60 };
    const found = solarEclipses(new Date('1956-12-01T00:00:00Z'), new Date('1956-12-04T00:00:00Z'), polar);
    expect(found).toHaveLength(1);
    expect(found[0].sunAltDeg.c1).toBeLessThan(0);
    expect(found[0].sunAltDeg.peak).toBeGreaterThan(0);
    expect(found[0].sunAltDeg.c4).toBeLessThan(0);
  });
});
