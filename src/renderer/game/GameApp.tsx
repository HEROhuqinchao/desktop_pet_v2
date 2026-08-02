import { useEffect, useRef, useState } from 'react';
import {
  CatchFoodGame,
  type CatchFoodSnapshot,
} from '../../games/catch-food-game';
import {
  DodgeMouseGame,
  type DodgeMouseSnapshot,
} from '../../games/dodge-mouse-game';
import { FixedStepAccumulator } from '../../games/fixed-step-loop';
import {
  loadCatchFoodConfig,
  loadDodgeMouseConfig,
} from '../../games/game-configs';
import type {
  GameCompletionResult,
  GameDifficulty,
  GameId,
  GameResult,
} from '../../shared/contracts';

type GameEngine = CatchFoodGame | DodgeMouseGame;
type GameSnapshot = CatchFoodSnapshot | DodgeMouseSnapshot;

interface GameSetup {
  gameId: GameId;
  difficulty: GameDifficulty;
  petName: string;
  catchFoodConfig: unknown;
  dodgeMouseConfig: unknown;
  effectSettings: {
    targetFps: number;
    effectLevel: number;
    particlesEnabled: boolean;
    shadowsEnabled: boolean;
    trailsEnabled: boolean;
    autoPauseGames: boolean;
    lowPowerMode: boolean;
  };
}

export function GameApp() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    void window.desktopPet.getGameSetup().then((value) => {
      if (value) {
        setSetup(value);
      }
    });
  }, []);

  if (!setup) {
    return <main className="game-loading">小游戏正在准备中</main>;
  }
  return (
    <GameSession
      key={`${setup.gameId}:${setup.difficulty}:${round}`}
      setup={setup}
      onRestart={() => setRound((value) => value + 1)}
    />
  );
}

interface GameSessionProps {
  setup: GameSetup;
  onRestart: () => void;
}

function GameSession({ setup, onRestart }: GameSessionProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const submittedRef = useRef(false);
  const showPerfRef = useRef(false);
  const perfRef = useRef({ fps: 0, logicMs: 0, entities: 0 });
  const autoPause = setup.effectSettings.autoPauseGames;
  const trailsEnabled = setup.effectSettings.trailsEnabled;
  const [snapshot, setSnapshot] = useState<GameSnapshot>(
    () => createEngine(setup).snapshot(),
  );
  const [completion, setCompletion] =
    useState<GameCompletionResult | null>(null);
  const [roundResult, setRoundResult] = useState<GameResult | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const engine = createEngine(setup);
    engineRef.current = engine;
    engine.start();
    submittedRef.current = false;
    const loop = new FixedStepAccumulator();
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = `pet-asset://current/spritesheet?game=${Date.now()}`;
    let animationFrame = 0;
    let previousTime = performance.now();
    let lastUiUpdate = 0;
    let disposed = false;

    const frame = (timestamp: number) => {
      if (disposed) {
        return;
      }
      const elapsed = Math.max(0, (timestamp - previousTime) / 1_000);
      previousTime = timestamp;
      const logicStart = performance.now();
      loop.advance(elapsed, (fixedSeconds) => {
        engine.update(fixedSeconds);
      });
      const logicMs = performance.now() - logicStart;
      const current = engine.snapshot();
      perfRef.current = {
        fps: elapsed > 0 ? 1 / elapsed : 0,
        logicMs,
        entities:
          'items' in current
            ? current.items.length
            : 1 + current.decoys.length,
      };
      drawGame(canvas, setup.gameId, current, image, {
        trails: trailsEnabled && !setup.effectSettings.lowPowerMode,
        effectLevel: setup.effectSettings.effectLevel,
        particles: setup.effectSettings.particlesEnabled,
        showPerf: showPerfRef.current,
        perf: perfRef.current,
        phase: current.phase,
      });
      if (timestamp - lastUiUpdate >= 100 || current.phase === 'result') {
        lastUiUpdate = timestamp;
        setSnapshot(current);
      }
      if (current.phase === 'result' && !submittedRef.current) {
        const result = engine.gameResult();
        if (result) {
          submittedRef.current = true;
          setRoundResult(result);
          void window.desktopPet.finishGame(result).then(setCompletion);
        }
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      engineRef.current = null;
    };
  }, [setup, trailsEnabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }
      if (event.key === 'Escape') {
        engine.togglePause();
        event.preventDefault();
        return;
      }
      if (event.key === 'F3') {
        showPerfRef.current = !showPerfRef.current;
        event.preventDefault();
        return;
      }
      if (engine instanceof CatchFoodGame) {
        if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
          engine.setDirection(-1);
          event.preventDefault();
        } else if (
          event.key === 'ArrowRight'
          || event.key.toLowerCase() === 'd'
        ) {
          engine.setDirection(1);
          event.preventDefault();
        }
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const engine = engineRef.current;
      if (
        engine instanceof CatchFoodGame
        && [
          'ArrowLeft',
          'ArrowRight',
          'a',
          'A',
          'd',
          'D',
        ].includes(event.key)
      ) {
        engine.setDirection(0);
      }
    };
    const pauseOnBlur = () => {
      if (!autoPause) {
        return;
      }
      const engine = engineRef.current;
      const phase = engine?.snapshot().phase;
      if (phase === 'running' || phase === 'countdown') {
        engine?.togglePause();
      }
    };
    const handleTogglePause = () => {
      engineRef.current?.togglePause();
    };
    const handleCancel = () => {
      const engine = engineRef.current;
      if (engine && engine.snapshot().phase !== 'result') {
        engine.cancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', pauseOnBlur);
    const offToggle = window.desktopPet.onGameTogglePause(handleTogglePause);
    const offCancel = window.desktopPet.onGameCancel(handleCancel);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', pauseOnBlur);
      offToggle();
      offCancel();
    };
  }, [autoPause]);

  useEffect(() => {
    window.desktopPet.reportGamePhase(snapshot.phase);
  }, [snapshot.phase]);

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const point = canvasPoint(event);
    const engine = engineRef.current;
    if (engine instanceof CatchFoodGame) {
      engine.setPointerTarget(point.x);
    } else if (engine instanceof DodgeMouseGame) {
      engine.setPointer(point.x, point.y);
    }
  };

  const handlePointerLeave = () => {
    const engine = engineRef.current;
    if (engine instanceof CatchFoodGame) {
      engine.setPointerTarget(null);
    } else if (engine instanceof DodgeMouseGame) {
      engine.setPointer(null, null);
    }
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const engine = engineRef.current;
    if (!(engine instanceof DodgeMouseGame)) {
      return;
    }
    const point = canvasPoint(event);
    engine.click(point.x, point.y);
  };

  const handleExit = async () => {
    await window.desktopPet.closeGame();
  };

  const handleReplay = () => {
    onRestart();
  };

  const paused = snapshot.phase === 'paused';
  const finished = snapshot.phase === 'result';
  return (
    <main className="game-shell">
      <header className="game-titlebar">
        <div>
          <p>
            DESKTOP PET · {difficultyLabel(setup.difficulty)}
          </p>
          <h1>{gameTitle(setup.gameId)}</h1>
        </div>
        <div className="titlebar-actions">
          <button
            type="button"
            disabled={finished}
            onClick={() => engineRef.current?.togglePause()}
          >
            {paused ? '继续' : '暂停'}
          </button>
          <button type="button" onClick={() => void handleExit()}>
            退出
          </button>
        </div>
      </header>

      <canvas
        ref={canvasRef}
        width={setup.gameId === 'catch_food' ? 880 : 900}
        height="560"
        aria-label={gameTitle(setup.gameId)}
        tabIndex={0}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      />

      <footer className="game-help">
        <span>{gameHelp(setup.gameId)}</span>
        <span>Esc 暂停{autoPause ? ' · 失去焦点自动暂停' : ''}</span>
      </footer>

      {finished ? (
        <ResultDialog
          gameId={setup.gameId}
          result={roundResult}
          completion={completion}
          onReplay={handleReplay}
          onBack={() => void handleExit()}
        />
      ) : null}
    </main>
  );
}

interface ResultDialogProps {
  gameId: GameId;
  result: GameResult | null;
  completion: GameCompletionResult | null;
  onReplay: () => void;
  onBack: () => void;
}

/**
 * 结算对话框，对应基准 ui/game_result_dialog.py：
 * 评价、本局分数、历史最高（新纪录）、最大连击、接取率/命中率、
 * 奖励明细、评论文案、再来一局/返回桌面宠物。
 */
function ResultDialog({
  gameId,
  result,
  completion,
  onReplay,
  onBack,
}: ResultDialogProps) {
  const previousHigh = completion?.record
    ? Math.max(0, completion.record.highScore - (result?.score ?? 0))
    : 0;
  const score = result?.score ?? 0;
  const isNewRecord = Boolean(completion?.record) && score > previousHigh;
  const rewards = completion?.rewards;
  const rewardParts: string[] = [];
  if (rewards) {
    if (rewards.experience !== 0) rewardParts.push(`经验 ${formatDelta(rewards.experience)}`);
    if (rewards.affection !== 0) rewardParts.push(`好感 ${formatDelta(rewards.affection)}`);
    if (rewards.hunger !== 0) rewardParts.push(`饱食 ${formatDelta(rewards.hunger)}`);
    if (rewards.mood !== 0) rewardParts.push(`心情 ${formatDelta(rewards.mood)}`);
    if (rewards.energy !== 0) rewardParts.push(`体力 ${formatDelta(rewards.energy)}`);
  }
  const accuracyLabel =
    gameId === 'catch_food'
      ? `接取率：${((result?.accuracy ?? 0) * 100).toFixed(1)}%`
      : `命中率：${((result?.accuracy ?? 0) * 100).toFixed(1)}%`;
  return (
    <div className="result-panel" role="dialog" aria-label="小游戏结算">
      <h2 className="result-grade">评价 {result?.grade ?? 'D'}</h2>
      <p className="result-lines">
        本局分数：{score}
        <br />
        历史最高：{completion?.record?.highScore ?? score}
        {isNewRecord ? '  新纪录' : ''}
        <br />
        最大连击：{result?.maxCombo ?? 0}
        <br />
        {accuracyLabel}
        <br />
        奖励：{rewardParts.length > 0 ? rewardParts.join('、') : '本局未获得额外奖励'}
      </p>
      <p className="result-comment">{resultComment(gameId, result?.grade)}</p>
      <div className="result-actions">
        <button type="button" onClick={onReplay}>
          再来一局
        </button>
        <button type="button" onClick={onBack}>
          返回桌面宠物
        </button>
      </div>
    </div>
  );
}

function resultComment(gameId: GameId, grade?: string): string {
  if (grade === 'S' || grade === 'A') {
    return '我怀疑你的鼠标偷偷练过。';
  }
  if (gameId === 'catch_food') {
    return '你接食物的速度，比我吃东西还快。';
  }
  return '技术不错，下次我会认真一点。';
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function difficultyLabel(difficulty: GameDifficulty): string {
  if (difficulty === 'easy') {
    return '轻松';
  }
  if (difficulty === 'challenge') {
    return '挑战';
  }
  return '标准';
}

function createEngine(setup: GameSetup): GameEngine {
  if (setup.gameId === 'catch_food') {
    const config = loadCatchFoodConfig(
      setup.catchFoodConfig,
      setup.difficulty,
    );
    return new CatchFoodGame(config);
  }
  const config = loadDodgeMouseConfig(
    setup.dodgeMouseConfig,
    setup.difficulty,
  );
  return new DodgeMouseGame(config);
}

function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>): {
  x: number;
  y: number;
} {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left)
      * (event.currentTarget.width / rect.width),
    y: (event.clientY - rect.top)
      * (event.currentTarget.height / rect.height),
  };
}

interface DrawOptions {
  trails: boolean;
  effectLevel: number;
  particles: boolean;
  showPerf?: boolean;
  perf?: { fps: number; logicMs: number; entities: number };
  phase?: string;
}

function drawGame(
  canvas: HTMLCanvasElement,
  gameId: GameId,
  snapshot: GameSnapshot,
  image: HTMLImageElement,
  options: DrawOptions,
): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  if (gameId === 'catch_food') {
    drawCatchFood(context, snapshot as CatchFoodSnapshot, image, options);
  } else {
    drawDodgeMouse(context, snapshot as DodgeMouseSnapshot, image, options);
  }
  if (options.showPerf && options.perf) {
    drawPerfOverlay(context, options.perf, options.phase ?? '');
  }
}

/** F3 性能覆盖层，对应基准 base_game._draw_performance_overlay。 */
function drawPerfOverlay(
  context: CanvasRenderingContext2D,
  perf: { fps: number; logicMs: number; entities: number },
  phase: string,
): void {
  context.save();
  context.globalAlpha = 0.78;
  context.fillStyle = '#000';
  context.fillRect(10, 70, 238, 110);
  context.globalAlpha = 1;
  context.fillStyle = '#fff';
  context.font = '12px ui-monospace, monospace';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const lines = [
    `FPS: ${perf.fps.toFixed(1)}`,
    `逻辑: ${perf.logicMs.toFixed(2)} ms`,
    `实体: ${perf.entities}`,
    `状态: ${phase}`,
  ];
  lines.forEach((line, index) => {
    context.fillText(line, 20, 90 + index * 16);
  });
  context.restore();
}

function drawCatchFood(
  context: CanvasRenderingContext2D,
  snapshot: CatchFoodSnapshot,
  image: HTMLImageElement,
  options: DrawOptions,
): void {
  const width = 880;
  const height = 560;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#DDF4FF');
  gradient.addColorStop(1, '#FFF3C9');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    snapshot.score,
    snapshot.combo,
    snapshot.comboMultiplier,
    snapshot.remainingSeconds,
    `阶段 ${snapshot.stageName}`,
    width,
    '#3F4A55',
  );
  if (snapshot.feverRemaining > 0) {
    drawCenterBanner(
      context,
      `狂热 ${snapshot.feverRemaining.toFixed(1)}s`,
      '#E39121',
      width,
    );
  } else if (snapshot.specialEventText) {
    drawCenterBanner(
      context,
      snapshot.specialEventText,
      '#925A91',
      width,
    );
  }
  context.fillStyle = '#7ECF78';
  context.fillRect(0, height - 36, width, 36);
  for (const item of snapshot.items) {
    if (item.warningRemaining > 0) {
      context.strokeStyle = item.config.color;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(item.x + item.size / 2, 8);
      context.lineTo(item.x + item.size / 2, 38);
      context.stroke();
      continue;
    }
    context.save();
    context.translate(item.x + item.size / 2, item.y + item.size / 2);
    context.rotate((item.rotation * Math.PI) / 180);
    context.fillStyle = item.config.color;
    context.strokeStyle =
      snapshot.feverRemaining > 0 ? '#FFD84C' : '#4D4542';
    context.lineWidth = snapshot.feverRemaining > 0 ? 3 : 2;
    context.beginPath();
    context.arc(0, 0, item.size / 2, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle =
      item.config.category === 'danger' ? '#FFFFFF' : '#443B36';
    context.font = `700 ${Math.max(8, Math.round(item.size / 4))}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(item.config.symbol, 0, 0);
    context.restore();
  }
  drawPet(
    context,
    image,
    snapshot.petX,
    snapshot.petY,
    snapshot.petWidth,
    snapshot.petHeight,
    options,
    snapshot.feverRemaining > 0,
  );
  if (options.effectLevel > 0) {
    context.font = '600 14px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const effect of snapshot.effects) {
      context.fillStyle = effect.color;
      context.fillText(effect.text, effect.x, effect.y);
    }
  }
  const badges = [
    snapshot.magnetRemaining > 0
      ? `磁铁 ${snapshot.magnetRemaining.toFixed(1)}s`
      : '',
    snapshot.doubleScoreRemaining > 0
      ? `双倍 ${snapshot.doubleScoreRemaining.toFixed(1)}s`
      : '',
    snapshot.reverseControlRemaining > 0
      ? `混乱 ${snapshot.reverseControlRemaining.toFixed(1)}s`
      : '',
    snapshot.shieldCharges > 0 ? `护盾 ×${snapshot.shieldCharges}` : '',
  ].filter(Boolean);
  drawBadges(context, badges);
  drawStateOverlay(context, snapshot.phase, snapshot.countdownSeconds, width);
}

function drawDodgeMouse(
  context: CanvasRenderingContext2D,
  snapshot: DodgeMouseSnapshot,
  image: HTMLImageElement,
  options: DrawOptions,
): void {
  const width = 900;
  const height = 560;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#E8E3FF');
  gradient.addColorStop(1, '#FFF0C9');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    snapshot.score,
    snapshot.combo,
    snapshot.comboMultiplier,
    snapshot.remainingSeconds,
    `命中率 ${(snapshot.accuracy * 100).toFixed(1)}%`,
    width,
    '#474253',
  );
  if (snapshot.specialEventText) {
    drawCenterBanner(context, snapshot.specialEventText, '#925A91', width);
  }
  if (snapshot.pointerX !== null && snapshot.pointerY !== null) {
    context.strokeStyle = 'rgba(99, 133, 188, 0.25)';
    context.beginPath();
    context.arc(
      snapshot.pointerX,
      snapshot.pointerY,
      snapshot.warningRadius,
      0,
      Math.PI * 2,
    );
    context.stroke();
    context.strokeStyle = 'rgba(228, 92, 92, 0.32)';
    context.beginPath();
    context.arc(
      snapshot.pointerX,
      snapshot.pointerY,
      snapshot.dangerRadius,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  for (const decoy of snapshot.decoys) {
    context.globalAlpha = 0.34;
    drawPet(
      context,
      image,
      decoy.x,
      decoy.y,
      decoy.width,
      decoy.height,
      options,
      false,
    );
    context.globalAlpha = 1;
  }
  if (snapshot.dashRemaining > 0 && options.trails) {
    context.globalAlpha = 0.18;
    drawPet(
      context,
      image,
      snapshot.petX - snapshot.velocityX * 0.05,
      snapshot.petY - snapshot.velocityY * 0.05,
      snapshot.petSize,
      snapshot.petSize,
      options,
      false,
    );
    context.globalAlpha = 1;
  }
  drawPet(
    context,
    image,
    snapshot.petX,
    snapshot.petY,
    snapshot.petSize,
    snapshot.petSize,
    options,
    false,
  );
  context.fillStyle = 'rgba(71, 66, 83, 0.2)';
  roundRect(context, 370, 22, 160, 13, 7);
  context.fill();
  context.fillStyle = '#65b982';
  roundRect(
    context,
    370,
    22,
    160 * (snapshot.stamina / Math.max(1, snapshot.staminaMaximum)),
    13,
    7,
  );
  context.fill();
  if (options.effectLevel > 0) {
    context.font = '600 14px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const effect of snapshot.effects) {
      context.fillStyle = effect.color;
      context.fillText(effect.text, effect.x, effect.y);
    }
  }
  drawBadges(
    context,
    [
      snapshot.dashRemaining > 0 ? '冲刺' : '',
      snapshot.stunnedRemaining > 0 ? '被抓住' : '',
      snapshot.tauntRemaining > 0 ? '挑衅加分' : '',
    ].filter(Boolean),
  );
  drawStateOverlay(context, snapshot.phase, snapshot.countdownSeconds, width);
}

function drawHeader(
  context: CanvasRenderingContext2D,
  score: number,
  combo: number,
  comboMultiplier: number,
  remainingSeconds: number,
  detail: string,
  width: number,
  color: string,
): void {
  context.fillStyle = color;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.font = '700 16px sans-serif';
  context.fillText(`得分 ${score}`, 20, 27);
  context.font = '500 13px sans-serif';
  context.fillText(`连击 ${combo}  ×${comboMultiplier}`, 20, 50);
  context.textAlign = 'right';
  context.font = '700 16px ui-monospace, monospace';
  context.fillText(
    `剩余 ${remainingSeconds.toFixed(1)}s`,
    width - 20,
    27,
  );
  context.font = '500 13px sans-serif';
  context.fillText(detail, width - 20, 50);
}

function drawCenterBanner(
  context: CanvasRenderingContext2D,
  text: string,
  color: string,
  width: number,
): void {
  context.fillStyle = color;
  context.font = '700 18px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.fillText(text, width / 2, 18);
}

function drawPet(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options: DrawOptions,
  fever: boolean,
): void {
  const drawY = fever ? y - 5 : y;
  if (options.effectLevel > 0) {
    context.fillStyle = 'rgba(45, 52, 58, 0.16)';
    context.beginPath();
    context.ellipse(
      x + width / 2,
      y + height - 6,
      width * 0.36,
      7,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  if (image.complete && image.naturalWidth > 0) {
    context.drawImage(image, 0, 0, 192, 208, x, drawY, width, height);
    return;
  }
  context.fillStyle = '#d9994c';
  context.beginPath();
  context.ellipse(
    x + width / 2,
    drawY + height / 2,
    width / 2,
    height / 2,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.fillStyle = '#30251e';
  context.font = '700 16px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('土豆', x + width / 2, drawY + height / 2);
}

function drawBadges(
  context: CanvasRenderingContext2D,
  badges: string[],
): void {
  let x = 20;
  context.font = '600 12px sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (const badge of badges) {
    const width = context.measureText(badge).width + 20;
    context.fillStyle = 'rgba(216, 163, 90, 0.86)';
    roundRect(context, x, 72, width, 25, 12);
    context.fill();
    context.fillStyle = '#171411';
    context.fillText(badge, x + 10, 84.5);
    x += width + 8;
  }
}

function drawStateOverlay(
  context: CanvasRenderingContext2D,
  phase: GameSnapshot['phase'],
  countdownSeconds: number,
  width: number,
): void {
  if (phase !== 'countdown' && phase !== 'paused') {
    return;
  }
  context.fillStyle = 'rgba(25, 31, 38, 0.49)';
  context.fillRect(0, 0, width, 560);
  context.fillStyle = '#fff';
  context.font = '700 42px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (phase === 'paused') {
    context.fillText('已暂停', width / 2, 260);
    context.font = '500 18px sans-serif';
    context.fillText('按 Esc 继续', width / 2, 310);
  } else {
    context.fillText(
      String(Math.max(1, Math.ceil(countdownSeconds))),
      width / 2,
      280,
    );
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, Math.max(0, width), height, radius);
}

function gameTitle(gameId: GameId): string {
  return gameId === 'catch_food'
    ? '接食物大作战'
    : '抓住土豆';
}

function gameHelp(gameId: GameId): string {
  return gameId === 'catch_food'
    ? '移动鼠标或使用 A / D、左右方向键接住食物'
    : '移动鼠标逼近土豆，点击土豆得分，连续命中提高倍率';
}
