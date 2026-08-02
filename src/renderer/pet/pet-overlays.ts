import type { PetOverlayState } from '../../shared/contracts';

/**
 * 宠物状态特效与事件特效绘制，逐条对应 desktop_pet
 * pet/animation.py 的 _draw_state_effects 与 _draw_event_effects。
 * 坐标沿用基准 172×192 的 PET_BASE 空间，在 192×208 单元格内
 * 平移 ((192-172)/2, 208-192) = (10, 16)。
 */

const BASE_OFFSET_X = 10;
const BASE_OFFSET_Y = 16;

export interface OverlayDrawState {
  behaviorState: string;
  phaseSeconds: number;
  overlay: PetOverlayState;
  desktopEffects: boolean;
  customActionVisuals?: boolean;
}

export function drawPetOverlays(
  context: CanvasRenderingContext2D,
  state: OverlayDrawState,
): void {
  if (!state.desktopEffects) {
    return;
  }
  context.save();
  context.translate(BASE_OFFSET_X, BASE_OFFSET_Y);
  drawStateEffects(context, state);
  if (state.overlay.activeEvent) {
    drawEventEffects(context, state.overlay.activeEvent, state);
  }
  context.restore();
}

function drawStateEffects(
  context: CanvasRenderingContext2D,
  state: OverlayDrawState,
): void {
  const phase = state.phaseSeconds;
  const behavior = state.behaviorState;
  if (state.customActionVisuals) {
    // 扩展动作帧已经包含状态姿势与随身道具，只保留持续状态覆盖物。
  } else if (behavior === 'SLEEP') {
    const offset = Math.floor(phase * 18) % 16;
    context.fillStyle = '#6D75B8';
    context.font = 'bold 16px sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('Z', 126, 55 - offset);
    context.font = 'bold 12px sans-serif';
    context.fillText('z', 145, 38 - offset / 2);
  } else if (behavior === 'ANGRY') {
    context.strokeStyle = '#CE443D';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(128, 34);
    context.lineTo(142, 21);
    context.moveTo(134, 36);
    context.lineTo(151, 34);
    context.stroke();
    const steam = Math.sin(phase * 8) * 2;
    context.fillStyle = 'rgba(245, 245, 245, 0.84)';
    ellipse(context, 20 + steam, 38, 13, 9);
    ellipse(context, 14 + steam, 31, 10, 8);
    ellipse(context, 143 - steam, 38, 13, 9);
    ellipse(context, 151 - steam, 31, 10, 8);
  } else if (behavior === 'HAPPY') {
    const pulse = 1 + Math.sin(phase * 9) * 0.08;
    context.fillStyle = 'rgba(255, 116, 145, 0.8)';
    drawHeart(context, 20, 43, 7 * pulse);
    drawHeart(context, 151, 48, 6 * pulse);
  } else if (behavior === 'EAT') {
    drawFoodProp(context, state.overlay.activeFood ?? 'bread');
  }
  if (state.overlay.hungerLow) {
    context.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ellipse(context, 124, 28, 36, 28);
    context.fillStyle = '#5E3A2F';
    context.font = '14px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('🍪', 129 + 13, 31 + 10);
  }
  if (state.overlay.cleanlinessLow) {
    context.fillStyle = 'rgba(126, 112, 96, 0.51)';
    for (const [x, y, size] of [
      [31, 119, 5],
      [139, 126, 4],
      [46, 149, 3],
      [128, 92, 3],
    ] as const) {
      ellipse(context, x, y, size, size);
    }
  }
}

function drawFoodProp(
  context: CanvasRenderingContext2D,
  food: string,
): void {
  context.lineWidth = 2;
  if (food === 'juice') {
    context.strokeStyle = '#6B3A20';
    context.fillStyle = '#F5B84A';
    roundRectPath(context, 73, 105, 27, 34, 5);
    context.fill();
    context.stroke();
    context.strokeStyle = '#E7F2FF';
    context.beginPath();
    context.moveTo(91, 106);
    context.lineTo(97, 94);
    context.stroke();
  } else if (food === 'fries') {
    context.strokeStyle = '#D1672C';
    context.fillStyle = '#E94F42';
    roundRectPath(context, 70, 115, 33, 25, 4);
    context.fill();
    context.stroke();
    context.strokeStyle = '#F3C44F';
    context.lineWidth = 4;
    for (const [x, height] of [
      [74, 19],
      [82, 24],
      [90, 21],
      [98, 18],
    ] as const) {
      context.beginPath();
      context.moveTo(x, 119);
      context.lineTo(x, 119 - height);
      context.stroke();
    }
  } else {
    context.strokeStyle = '#6B3A20';
    context.fillStyle = '#E9A84D';
    roundRectPath(context, 70, 108, 34, 29, 7);
    context.fill();
    context.stroke();
    context.strokeStyle = '#F6D98A';
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(87, 119, 12, 7, 0, Math.PI * 1.06, Math.PI * 1.94);
    context.stroke();
  }
}

function drawEventEffects(
  context: CanvasRenderingContext2D,
  event: string,
  state: OverlayDrawState,
): void {
  const phase = state.phaseSeconds;
  context.lineWidth = 2.2;
  switch (event) {
    case 'steal_cursor': {
      context.strokeStyle = '#5E3A2F';
      context.fillStyle = '#FAFAFA';
      context.beginPath();
      context.moveTo(135, 80);
      context.lineTo(161, 91);
      context.lineTo(148, 97);
      context.lineTo(155, 111);
      context.lineTo(147, 115);
      context.lineTo(140, 99);
      context.lineTo(132, 109);
      context.closePath();
      context.fill();
      context.stroke();
      break;
    }
    case 'zoomies': {
      context.strokeStyle = 'rgba(95, 139, 184, 0.59)';
      context.lineWidth = 3;
      const offset = Math.floor(phase * 140) % 25;
      for (const y of [72, 94, 119, 143]) {
        context.beginPath();
        context.moveTo(5 + offset, y);
        context.lineTo(33 + offset, y);
        context.stroke();
      }
      break;
    }
    case 'office': {
      context.fillStyle = '#5D77A8';
      context.beginPath();
      context.moveTo(84, 111);
      context.lineTo(92, 119);
      context.lineTo(86, 149);
      context.lineTo(78, 119);
      context.closePath();
      context.fill();
      context.fillStyle = '#D5E1EC';
      roundRectPath(context, 112, 137, 49, 31, 4);
      context.fill();
      break;
    }
    case 'treasure': {
      context.fillStyle = '#B87333';
      roundRectPath(context, 117, 137, 49, 33, 5);
      context.fill();
      context.fillStyle = '#F2C94C';
      context.fillRect(137, 137, 9, 33);
      context.beginPath();
      context.ellipse(141.5, 151.5, 3.5, 3.5, 0, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case 'weather':
      drawWeather(context, state.overlay.eventVariant ?? 'rain', phase);
      break;
    case 'holiday': {
      context.fillStyle = '#D94E47';
      context.beginPath();
      context.moveTo(64, 46);
      context.lineTo(88, 4);
      context.lineTo(108, 49);
      context.closePath();
      context.fill();
      context.fillStyle = '#FFF7E7';
      roundRectPath(context, 61, 43, 50, 11, 5);
      context.fill();
      context.beginPath();
      context.ellipse(88.5, 7.5, 6.5, 6.5, 0, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case 'detective': {
      context.fillStyle = 'rgba(255, 255, 255, 0.27)';
      context.beginPath();
      context.ellipse(130, 92, 17, 17, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#5E3A2F';
      context.lineWidth = 6;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(141, 103);
      context.lineTo(160, 124);
      context.stroke();
      context.lineCap = 'butt';
      break;
    }
    case 'fake_update': {
      context.fillStyle = 'rgba(255, 255, 255, 0.93)';
      roundRectPath(context, 8, 9, 156, 42, 8);
      context.fill();
      context.fillStyle = '#5E3A2F';
      context.font = 'bold 10px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const percentage = Math.min(99, 1 + (Math.floor(phase * 7) % 99));
      context.fillText(`正在更新聪明程度：${percentage}%`, 8 + 78, 9 + 21);
      break;
    }
    case 'edge_adventure': {
      context.fillStyle = '#7A5C50';
      context.font = 'bold 12px sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      context.fillText('侦察中', 128, 32);
      break;
    }
    case 'play_dead': {
      context.fillStyle = 'rgba(255, 255, 255, 0.86)';
      ellipse(context, 126, 33, 33, 24);
      context.fillStyle = '#5E3A2F';
      context.font = '11px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('……', 129 + 13, 35 + 9);
      break;
    }
    default:
      break;
  }
}

function drawWeather(
  context: CanvasRenderingContext2D,
  variant: string,
  phase: number,
): void {
  if (variant === 'snow') {
    context.fillStyle = 'rgba(245, 250, 255, 0.86)';
    for (let index = 0; index < 10; index += 1) {
      const x = 12 + ((index * 19 + Math.floor(phase * 17)) % 151);
      const y = 18 + ((index * 31 + Math.floor(phase * 29)) % 130);
      const size = 3 + (index % 3);
      context.beginPath();
      context.ellipse(x, y, size / 2, size / 2, 0, 0, Math.PI * 2);
      context.fill();
    }
  } else if (variant === 'sun') {
    context.strokeStyle = '#F1B83B';
    context.lineWidth = 2.4;
    context.fillStyle = '#FFD86A';
    context.beginPath();
    context.ellipse(144, 27, 12, 12, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    for (let angle = 0; angle < 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      context.beginPath();
      context.moveTo(144 + Math.cos(radians) * 16, 27 + Math.sin(radians) * 16);
      context.lineTo(144 + Math.cos(radians) * 21, 27 + Math.sin(radians) * 21);
      context.stroke();
    }
  } else if (variant === 'wind') {
    context.strokeStyle = 'rgba(110, 159, 179, 0.65)';
    context.lineWidth = 2.4;
    const offset = Math.floor(phase * 45) % 22;
    const ys = [52, 78, 111];
    ys.forEach((y, index) => {
      context.beginPath();
      context.ellipse(
        8 + offset + index * 9 + 32,
        y + 10,
        32,
        10,
        0,
        Math.PI * 1.11,
        Math.PI * 1.89,
      );
      context.stroke();
    });
  } else if (variant === 'leaves') {
    context.strokeStyle = '#7D6A37';
    context.lineWidth = 1.5;
    for (let index = 0; index < 7; index += 1) {
      const x = 12 + ((index * 27 + Math.floor(phase * 36)) % 148);
      const y = 25 + ((index * 34 + Math.floor(phase * 51)) % 125);
      context.fillStyle = index % 2 ? '#D89B45' : '#B56F3E';
      context.beginPath();
      context.ellipse(x, y, 4, 2.5, 0, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.strokeStyle = 'rgba(92, 157, 211, 0.75)';
    context.lineWidth = 2.2;
    for (let index = 0; index < 8; index += 1) {
      const x = 20 + ((index * 21 + Math.floor(phase * 42)) % 145);
      const y = 22 + ((index * 29 + Math.floor(phase * 68)) % 115);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - 4, y + 11);
      context.stroke();
    }
  }
}

function ellipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.beginPath();
  context.ellipse(
    x + width / 2,
    y + height / 2,
    width / 2,
    height / 2,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
}

function drawHeart(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(centerX, centerY + radius);
  context.bezierCurveTo(
    centerX - radius * 1.5,
    centerY,
    centerX - radius,
    centerY - radius,
    centerX,
    centerY - radius * 0.2,
  );
  context.bezierCurveTo(
    centerX + radius,
    centerY - radius,
    centerX + radius * 1.5,
    centerY,
    centerX,
    centerY + radius,
  );
  context.fill();
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
