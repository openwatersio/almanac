// L0 time layer: Julian day, ΔT (Espenak–Meeus), and TT — the foundation every
// later astronomy layer (sun/moon position, rise/set, phase) consumes via ttDays().
// INTERNAL: not part of the curated public API (see index.ts) — L1+ layers import
// directly from './time.js'.

const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12); // 2000-01-01T12:00:00Z

/** Days since J2000 (UT), fractional. */
export function utDays(d: Date): number {
  return (d.getTime() - J2000_EPOCH_MS) / 86400000;
}

/** Julian day (UT). */
export function julianDay(d: Date): number {
  return utDays(d) + 2451545.0;
}

/**
 * ΔT = TT − UT, in seconds, for a given decimal year.
 *
 * Translated from `DeltaT_EspenakMeeus` in the cosinekitty/astronomy upstream
 * (pinned sha 865d3da7d8112bbc7911238052c6af4aaf877181,
 * source/js/astronomy.ts, lines ~1098-1190). The upstream function converts a
 * `ut` (days since J2000) argument to a decimal year `y` first; this port
 * takes the decimal year directly (see ttDays' yearOf below for the caller's
 * ut→year conversion) and translates the piecewise polynomial verbatim,
 * coefficient-for-coefficient, including branches outside the 1950-2100
 * interval this package supports.
 */
export function deltaTSeconds(decimalYear: number): number {
  const y = decimalYear;
  let u: number, u2: number, u3: number, u4: number, u5: number, u6: number, u7: number;

  if (y < -500) {
    u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (y < 500) {
    u = y / 100;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2; u5 = u2 * u3; u6 = u3 * u3;
    return 10583.6 - 1014.41 * u + 33.78311 * u2 - 5.952053 * u3 - 0.1798452 * u4 + 0.022174192 * u5 + 0.0090316521 * u6;
  }
  if (y < 1600) {
    u = (y - 1000) / 100;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2; u5 = u2 * u3; u6 = u3 * u3;
    return 1574.2 - 556.01 * u + 71.23472 * u2 + 0.319781 * u3 - 0.8503463 * u4 - 0.005050998 * u5 + 0.0083572073 * u6;
  }
  if (y < 1700) {
    u = y - 1600;
    u2 = u * u; u3 = u * u2;
    return 120 - 0.9808 * u - 0.01532 * u2 + u3 / 7129.0;
  }
  if (y < 1800) {
    u = y - 1700;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2;
    return 8.83 + 0.1603 * u - 0.0059285 * u2 + 0.00013336 * u3 - u4 / 1174000;
  }
  if (y < 1860) {
    u = y - 1800;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2; u5 = u2 * u3; u6 = u3 * u3; u7 = u3 * u4;
    return 13.72 - 0.332447 * u + 0.0068612 * u2 + 0.0041116 * u3 - 0.00037436 * u4 + 0.0000121272 * u5 - 0.0000001699 * u6 + 0.000000000875 * u7;
  }
  if (y < 1900) {
    u = y - 1860;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2; u5 = u2 * u3;
    return 7.62 + 0.5737 * u - 0.251754 * u2 + 0.01680668 * u3 - 0.0004473624 * u4 + u5 / 233174;
  }
  if (y < 1920) {
    u = y - 1900;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2;
    return -2.79 + 1.494119 * u - 0.0598939 * u2 + 0.0061966 * u3 - 0.000197 * u4;
  }
  if (y < 1941) {
    u = y - 1920;
    u2 = u * u; u3 = u * u2;
    return 21.20 + 0.84493 * u - 0.076100 * u2 + 0.0020936 * u3;
  }
  if (y < 1961) {
    u = y - 1950;
    u2 = u * u; u3 = u * u2;
    return 29.07 + 0.407 * u - u2 / 233 + u3 / 2547;
  }
  if (y < 1986) {
    u = y - 1975;
    u2 = u * u; u3 = u * u2;
    return 45.45 + 1.067 * u - u2 / 260 - u3 / 718;
  }
  if (y < 2005) {
    u = y - 2000;
    u2 = u * u; u3 = u * u2; u4 = u2 * u2; u5 = u2 * u3;
    return 63.86 + 0.3345 * u - 0.060374 * u2 + 0.0017275 * u3 + 0.000651814 * u4 + 0.00002373599 * u5;
  }
  if (y < 2050) {
    u = y - 2000;
    return 62.92 + 0.32217 * u + 0.005589 * u * u;
  }
  if (y < 2150) {
    u = (y - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - y);
  }

  /* all years after 2150 */
  u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Days since J2000 (TT), fractional — the argument every translated function consumes. */
export function ttDays(d: Date): number {
  const ut = utDays(d);
  const year = 2000 + ut / 365.25;
  return ut + deltaTSeconds(year) / 86400;
}
