import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { tierOf, tierOfValue } from '../../src/scoring/tier.js';

describe('credibility tiers (RUL-011)', () => {
  it('uses inclusive trusted and low thresholds', () => {
    expect(tierOf(new Decimal('3.000'))).toBe('trusted');
    expect(tierOf(new Decimal('-1.500'))).toBe('low');
    expect(tierOf(new Decimal('2.999'))).toBe('neutral');
    expect(tierOf(new Decimal('-1.499'))).toBe('neutral');
  });

  it('accepts decimal strings and safely handles invalid values', () => {
    expect(tierOfValue('4.25')).toBe('trusted');
    expect(tierOfValue('-2')).toBe('low');
    expect(tierOfValue('not-a-score')).toBe('neutral');
  });
});
