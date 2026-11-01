/**
 * apps/api/test/detection/bands.test.ts (TASK-048, RUL-027)
 *
 * Unit tests for detection band classification and boundary conditions:
 *   - p_fake >= FAKE_THRESHOLD_HIGH => likely_fake
 *   - p_fake <= REAL_THRESHOLD_LOW  => likely_real
 *   - otherwise                     => uncertain
 *   - boundary assertions, custom threshold overrides, out-of-range rejections.
 */

import { describe, it, expect } from 'vitest';
import { classifyBand } from '../../src/detection/bands.js';
import { config } from '../../src/config.js';

describe('Detection Bands (TASK-048, RUL-027)', () => {
  it('classifies p_fake >= FAKE_THRESHOLD_HIGH as likely_fake', () => {
    expect(classifyBand(1.0)).toBe('likely_fake');
    expect(classifyBand(0.95)).toBe('likely_fake');
    expect(classifyBand(config.FAKE_THRESHOLD_HIGH)).toBe('likely_fake');
    expect(classifyBand(config.FAKE_THRESHOLD_HIGH + 0.001)).toBe('likely_fake');
  });

  it('classifies p_fake <= REAL_THRESHOLD_LOW as likely_real', () => {
    expect(classifyBand(0.0)).toBe('likely_real');
    expect(classifyBand(0.05)).toBe('likely_real');
    expect(classifyBand(config.REAL_THRESHOLD_LOW)).toBe('likely_real');
    expect(classifyBand(config.REAL_THRESHOLD_LOW - 0.001)).toBe('likely_real');
  });

  it('classifies values strictly between REAL_THRESHOLD_LOW and FAKE_THRESHOLD_HIGH as uncertain', () => {
    const mid = (config.REAL_THRESHOLD_LOW + config.FAKE_THRESHOLD_HIGH) / 2;
    expect(classifyBand(mid)).toBe('uncertain');
    expect(classifyBand(config.REAL_THRESHOLD_LOW + 0.001)).toBe('uncertain');
    expect(classifyBand(config.FAKE_THRESHOLD_HIGH - 0.001)).toBe('uncertain');
  });

  it('respects custom threshold overrides', () => {
    const customThresholds = {
      fakeThresholdHigh: 0.8,
      realThresholdLow: 0.2,
    };

    expect(classifyBand(0.85, customThresholds)).toBe('likely_fake');
    expect(classifyBand(0.8, customThresholds)).toBe('likely_fake');
    expect(classifyBand(0.79, customThresholds)).toBe('uncertain');
    expect(classifyBand(0.21, customThresholds)).toBe('uncertain');
    expect(classifyBand(0.2, customThresholds)).toBe('likely_real');
    expect(classifyBand(0.15, customThresholds)).toBe('likely_real');
  });

  it('throws descriptive error on invalid or out-of-range p_fake', () => {
    expect(() => classifyBand(-0.01)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand(1.001)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand(NaN)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand(Infinity)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand(-Infinity)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand('0.5' as unknown as number)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand(null as unknown as number)).toThrow(/Invalid p_fake/);
    expect(() => classifyBand(undefined as unknown as number)).toThrow(/Invalid p_fake/);
  });
});
