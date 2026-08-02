import { describe, expect, it } from 'vitest';
import {
  clampWindowToWorkArea,
  normalizeWindowPosition,
  restoreWindowPosition,
} from '../src/core/window-position';

const displays = [
  {
    id: 'primary',
    workArea: { x: 0, y: 0, width: 1_440, height: 900 },
  },
  {
    id: 'secondary',
    workArea: { x: 1_440, y: 0, width: 1_920, height: 1_080 },
  },
];

describe('normalized multi-display position', () => {
  it('round-trips a position on the selected display', () => {
    const saved = normalizeWindowPosition(
      { x: 2_100, y: 500, width: 192, height: 208 },
      displays[1],
    );
    const restored = restoreWindowPosition(
      saved,
      displays,
      'primary',
      { width: 192, height: 208 },
    );

    expect(restored?.x).toBe(2_100);
    expect(restored?.y).toBe(500);
  });

  it('falls back to the primary display when a saved display disappears', () => {
    const restored = restoreWindowPosition(
      {
        displayId: 'missing',
        xRatio: 1,
        yRatio: 1,
        valid: true,
      },
      displays,
      'primary',
      { width: 192, height: 208 },
    );

    expect(restored).toEqual({
      x: 1_248,
      y: 692,
      width: 192,
      height: 208,
    });
  });

  it('keeps the entire window in the current work area', () => {
    expect(
      clampWindowToWorkArea(
        { x: -200, y: 850, width: 192, height: 208 },
        displays[0].workArea,
      ),
    ).toEqual({ x: 0, y: 692, width: 192, height: 208 });
  });
});
