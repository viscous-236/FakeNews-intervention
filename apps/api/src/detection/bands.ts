/**
 * apps/api/src/detection/bands.ts (TASK-048, RUL-027)
 *
 * Classification of detector prediction probabilities into bands:
 *   - p_fake >= FAKE_THRESHOLD_HIGH => 'likely_fake'
 *   - p_fake <= REAL_THRESHOLD_LOW  => 'likely_real'
 *   - otherwise                     => 'uncertain'
 *
 * Bands are computed by the API, never by the detector service (RUL-027, REQ-008).
 */

import { type DetectionBand } from '@app/shared';
import { config } from '../config.js';

export interface BandThresholds {
  fakeThresholdHigh?: number;
  realThresholdLow?: number;
}

/**
 * Classifies a probability `p_fake` in [0, 1] into a discrete DetectionBand.
 *
 * @param pFake Float in [0, 1]
 * @param thresholds Optional threshold overrides (defaults to config)
 * @returns DetectionBand ('likely_fake' | 'uncertain' | 'likely_real')
 * @throws Error if pFake is not a finite number in [0, 1]
 */
export function classifyBand(
  pFake: number,
  thresholds?: BandThresholds,
): DetectionBand {
  if (
    typeof pFake !== 'number' ||
    Number.isNaN(pFake) ||
    !Number.isFinite(pFake) ||
    pFake < 0 ||
    pFake > 1
  ) {
    throw new Error(
      `Invalid p_fake: expected finite number between 0.0 and 1.0, received ${pFake}`,
    );
  }

  const fakeThresholdHigh =
    thresholds?.fakeThresholdHigh ?? config.FAKE_THRESHOLD_HIGH;
  const realThresholdLow =
    thresholds?.realThresholdLow ?? config.REAL_THRESHOLD_LOW;

  if (pFake >= fakeThresholdHigh) {
    return 'likely_fake';
  }
  if (pFake <= realThresholdLow) {
    return 'likely_real';
  }
  return 'uncertain';
}
