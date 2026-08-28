import { describe, it, expect } from 'vitest';
import { assertSupported, assertSupportedWindowEnd, assertObserver, AlmanacOutOfRangeError, SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';

describe('interval guard', () => {
  it('accepts the boundaries correctly (half-open)', () => {
    expect(() => assertSupported(new Date(SUPPORTED_MIN))).not.toThrow();
    expect(() => assertSupported(new Date(SUPPORTED_MAX - 1))).not.toThrow();
    expect(() => assertSupported(new Date(SUPPORTED_MAX))).toThrow(AlmanacOutOfRangeError);
    expect(() => assertSupported(new Date(SUPPORTED_MIN - 1))).toThrow(AlmanacOutOfRangeError);
  });
  it('invalid Date is a validation error, not out-of-range', () => {
    expect(() => assertSupported(new Date(NaN))).toThrow(RangeError);
    expect(() => assertSupported(new Date(NaN))).not.toThrow(AlmanacOutOfRangeError);
  });
  it('window end accepts SUPPORTED_MAX (full-range window is legal)', () => {
    expect(() => assertSupportedWindowEnd(new Date(SUPPORTED_MAX))).not.toThrow();
    expect(() => assertSupportedWindowEnd(new Date(SUPPORTED_MAX + 1))).toThrow(AlmanacOutOfRangeError);
  });
});
describe('observer validation', () => {
  it('rejects out-of-range fields', () => {
    expect(() => assertObserver({ latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
    expect(() => assertObserver({ latitudeDeg: 0, longitudeDeg: 181 })).toThrow(RangeError);
    expect(() => assertObserver({ latitudeDeg: 0, longitudeDeg: 0, elevationM: 10001 })).toThrow(RangeError);
    expect(() => assertObserver({ latitudeDeg: 48.7621, longitudeDeg: -123.052 })).not.toThrow();
  });
});
