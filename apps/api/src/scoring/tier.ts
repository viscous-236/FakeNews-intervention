/** Credibility tier derivation (RUL-011). */

import Decimal from 'decimal.js';
import { config } from '../config.js';

export const TIERS = ['trusted', 'neutral', 'low'] as const;
export type Tier = (typeof TIERS)[number];

export function tierOf(q: Decimal): Tier {
  if (q.greaterThanOrEqualTo(config.Q_TRUSTED_MIN)) return 'trusted';
  if (q.lessThanOrEqualTo(config.Q_LOW_MAX)) return 'low';
  return 'neutral';
}

export function tierOfValue(q: Decimal | string | number): Tier {
  try {
    const value = q instanceof Decimal ? q : new Decimal(q);
    return value.isFinite() ? tierOf(value) : 'neutral';
  } catch {
    return 'neutral';
  }
}
