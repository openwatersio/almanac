import { it, expect } from 'vitest';
import { degreesToRadians, radiansToDegrees, AlmanacOutOfRangeError } from '../src/index.js';

it('converts signed angles without wrapping full turns', () => {
  for (const [degrees, radians] of [[0, 0], [90, Math.PI / 2], [-180, -Math.PI], [720, 4 * Math.PI]]) {
    expect(degreesToRadians(degrees)).toBeCloseTo(radians, 14);
    expect(radiansToDegrees(radians)).toBeCloseTo(degrees, 12);
  }
  expect(Object.is(degreesToRadians(-0), -0)).toBe(true);
  expect(Object.is(radiansToDegrees(-0), -0)).toBe(true);
});

it('rejects non-finite angles as validation errors', () => {
  for (const convert of [degreesToRadians, radiansToDegrees]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => convert(value)).toThrow(RangeError);
      expect(() => convert(value)).not.toThrow(AlmanacOutOfRangeError);
    }
  }
});

it('rejects overflow while accepting large representable conversions', () => {
  for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
    expect(Number.isFinite(degreesToRadians(value))).toBe(true);
    expect(Number.isFinite(radiansToDegrees(value / 64))).toBe(true);
    expect(() => radiansToDegrees(value)).toThrow(RangeError);
    expect(() => radiansToDegrees(value)).not.toThrow(AlmanacOutOfRangeError);
  }
});
