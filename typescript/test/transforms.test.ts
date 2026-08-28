import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunAltAz, moonAltAz } from '../src/index.js';
import { siderealDeg, refractionDeg } from '../src/transforms.js';
import type { Observer } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

// fixtures/altaz/meta.json SITE_COORD: -123.3656,48.4284,0 (Victoria BC).
const VICTORIA: Observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0 };

// Signed azimuth difference in [-180, 180] — az wraps at 0/360, a naive
// subtraction would spuriously fail near that boundary.
const azDiffDeg = (a: number, b: number) => (((a - b + 540) % 360) + 360) % 360 - 180;

it('refraction at horizon ≈ 34 arcmin', () => expect(refractionDeg(0) * 60).toBeGreaterThan(28)); // Bennett-model ballpark, upstream 'normal'
it('sidereal: GMST 2000-01-01T12Z ≈ 280.46°', () => expect(Math.abs(siderealDeg(0) - 280.4606)).toBeLessThan(0.01));

// Horizons REFRACTED apparent az/el at Victoria BC. Only altDeg > 10° rows are
// asserted: refraction models diverge near the horizon (plan rule).
for (const [file, fn] of [
  ['altaz/sun-victoria-2026-03.json', sunAltAz],
  ['altaz/moon-victoria-2026-03.json', moonAltAz],
] as const) {
  it(`${file} within 1 arcmin (altDeg > 10°)`, () => {
    for (const row of load(file)) {
      if (row.altDeg <= 10) continue;
      const p = fn(new Date(row.utc), VICTORIA);
      expect(Math.abs(p.altDeg - row.altDeg) * 60, `${file} alt @ ${row.utc}`).toBeLessThan(1);
      const cosAlt = Math.cos(row.altDeg * Math.PI / 180);
      expect(Math.abs(azDiffDeg(p.azDeg, row.azDeg)) * cosAlt * 60, `${file} az @ ${row.utc}`).toBeLessThan(1);
    }
  });
}
