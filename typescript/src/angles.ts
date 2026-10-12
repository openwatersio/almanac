import { DEG2RAD, RAD2DEG } from './nutation.js';

/** Converts degrees to radians without wrapping the angle. */
export function degreesToRadians(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new RangeError('degrees must be finite');
  return degrees * DEG2RAD;
}

/** Converts radians to degrees without wrapping; rejects conversion overflow. */
export function radiansToDegrees(radians: number): number {
  if (!Number.isFinite(radians)) throw new RangeError('radians must be finite');
  const degrees = radians * RAD2DEG;
  if (!Number.isFinite(degrees)) throw new RangeError('angle conversion overflow');
  return degrees;
}
