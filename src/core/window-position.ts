import type { PetPosition } from '../shared/contracts';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayWorkArea {
  id: string;
  workArea: Rectangle;
}

export interface WindowSize {
  width: number;
  height: number;
}

export function normalizeWindowPosition(
  bounds: Rectangle,
  display: DisplayWorkArea,
): PetPosition {
  const horizontal = Math.max(1, display.workArea.width - bounds.width);
  const vertical = Math.max(1, display.workArea.height - bounds.height);
  return {
    displayId: display.id,
    xRatio: clamp((bounds.x - display.workArea.x) / horizontal, 0, 1),
    yRatio: clamp((bounds.y - display.workArea.y) / vertical, 0, 1),
    valid: true,
  };
}

export function restoreWindowPosition(
  position: PetPosition,
  displays: readonly DisplayWorkArea[],
  primaryDisplayId: string,
  size: WindowSize,
  margin = 24,
): Rectangle | null {
  if (displays.length === 0) {
    return null;
  }
  const display =
    displays.find((item) => item.id === position.displayId)
    ?? displays.find((item) => item.id === primaryDisplayId)
    ?? displays[0];
  const maximumX = Math.max(
    display.workArea.x,
    display.workArea.x + display.workArea.width - size.width,
  );
  const maximumY = Math.max(
    display.workArea.y,
    display.workArea.y + display.workArea.height - size.height,
  );
  if (!position.valid) {
    return {
      x: Math.max(display.workArea.x, maximumX - margin),
      y: maximumY,
      ...size,
    };
  }
  return {
    x: Math.round(
      display.workArea.x
      + (maximumX - display.workArea.x) * clamp(position.xRatio, 0, 1),
    ),
    y: Math.round(
      display.workArea.y
      + (maximumY - display.workArea.y) * clamp(position.yRatio, 0, 1),
    ),
    ...size,
  };
}

export function clampWindowToWorkArea(
  bounds: Rectangle,
  workArea: Rectangle,
): Rectangle {
  return {
    ...bounds,
    x: clamp(
      bounds.x,
      workArea.x,
      Math.max(workArea.x, workArea.x + workArea.width - bounds.width),
    ),
    y: clamp(
      bounds.y,
      workArea.y,
      Math.max(workArea.y, workArea.y + workArea.height - bounds.height),
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
