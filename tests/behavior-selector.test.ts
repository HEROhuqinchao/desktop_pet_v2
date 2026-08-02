import { describe, expect, it } from 'vitest';
import {
  BehaviorSelector,
  DEFAULT_PET_ATTRIBUTES,
} from '../src/core/behavior-selector';

describe('BehaviorSelector', () => {
  it('honors an explicit candidate boundary', () => {
    const selector = new BehaviorSelector(() => 0.75);
    const selected = selector.select({
      attributes: { ...DEFAULT_PET_ATTRIBUTES },
      settings: { autoMove: true, chaseCursor: true },
      candidates: new Set(['CURIOUS']),
      hour: 12,
    });

    expect(selected).toBe('CURIOUS');
  });

  it('does not select moving states when automatic movement is disabled', () => {
    const selector = new BehaviorSelector(() => 0.999);
    const selected = selector.select({
      attributes: { ...DEFAULT_PET_ATTRIBUTES },
      settings: { autoMove: false, chaseCursor: true },
      hour: 12,
    });

    expect(
      new Set(['IDLE', 'YAWN', 'CURIOUS', 'LOOK_AT_CURSOR']).has(selected),
    ).toBe(true);
  });

  it('falls back to idle when no candidate has a configured weight', () => {
    const selector = new BehaviorSelector(() => 0);
    const selected = selector.select({
      attributes: { ...DEFAULT_PET_ATTRIBUTES },
      settings: { autoMove: true, chaseCursor: true },
      candidates: new Set(['SPECIAL_EVENT']),
      hour: 12,
    });

    expect(selected).toBe('IDLE');
  });
});
