import {describe, expect, it} from 'vitest';
import {allocationSegments, hawlProgress} from './dashboard-presentation';

describe('Hawl display', () => {
  it('uses actual cycle length rather than assuming 365 days', () => {
    expect(hawlProgress('2026-01-01', '2026-12-21', '2026-06-27')).toEqual({total: 354, elapsed: 177, percent: 50});
  });
  it('clamps dates before and after cycle', () => {
    expect(hawlProgress('2026-01-01', '2026-12-21', '2025-01-01')?.percent).toBe(0);
    expect(hawlProgress('2026-01-01', '2026-12-21', '2027-01-01')?.percent).toBe(100);
  });
  it('rejects missing or reversed dates', () => {
    expect(hawlProgress()).toBeNull();
    expect(hawlProgress('2026-02-01', '2026-01-01', '2026-01-20')).toBeNull();
  });
});
describe('allocation chart', () => {
  it('shows exact category shares without decorative minimums', () => {
    expect(allocationSegments([{type: 'GOLD', value: '1'}, {type: 'CASH', value: '99'}]).map(s => s.percent)).toEqual([1, 99]);
  });
  it('returns an empty chart for no positive values', () => {
    expect(allocationSegments([{type: 'CASH', value: '0'}])).toEqual([]);
  });
  it('ends at 100 percent', () => {
    expect(allocationSegments([{type: 'GOLD', value: '10'}, {type: 'BANK', value: '20'}]).at(-1)?.end).toBeCloseTo(100);
  });
});
