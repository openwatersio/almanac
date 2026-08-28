export interface Observer { latitudeDeg: number; longitudeDeg: number; elevationM?: number; }
export class AlmanacOutOfRangeError extends RangeError {
  constructor(msg = 'time outside supported interval 1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z') { super(msg); this.name = 'AlmanacOutOfRangeError'; }
}
export const SUPPORTED_MIN = Date.UTC(1950, 0, 1);
export const SUPPORTED_MAX = Date.UTC(2101, 0, 1);
/** Point in time: [min, max). */
export function assertSupported(d: Date): void {
  const t = d.getTime();
  if (!Number.isFinite(t)) throw new RangeError('invalid Date');   // validation, not out-of-range
  if (t < SUPPORTED_MIN || t >= SUPPORTED_MAX) throw new AlmanacOutOfRangeError();
}
/** Window END: [min, max] — the exact full-range window [min, max) is legal. */
export function assertSupportedWindowEnd(d: Date): void {
  const t = d.getTime();
  if (!Number.isFinite(t)) throw new RangeError('invalid Date');
  if (t < SUPPORTED_MIN || t > SUPPORTED_MAX) throw new AlmanacOutOfRangeError();
}
/** Cross-port rule: all instants are integer epoch ms (JS Dates already are). */
export function assertObserver(o: Observer): void {
  const { latitudeDeg: lat, longitudeDeg: lon, elevationM: elev = 0 } = o;
  if (!(lat >= -90 && lat <= 90)) throw new RangeError(`latitudeDeg out of range: ${lat}`);
  if (!(lon >= -180 && lon <= 180)) throw new RangeError(`longitudeDeg out of range: ${lon}`);
  if (!(elev >= -500 && elev <= 10000)) throw new RangeError(`elevationM out of range: ${elev}`);
}
