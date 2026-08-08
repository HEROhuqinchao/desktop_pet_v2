import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ATLAS_ANIMATIONS,
  animationForMotion,
  frameAtElapsed,
  framePosition,
} from '../../core/atlas';
import {
  actionForMotion,
  actionFrameAtElapsed,
  actionFramePosition,
  actionHasCompleted,
} from '../../core/action-atlas';
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  type MotionState,
  type PetActionDefinition,
  type PetCatalogEntry,
  type PetSettings,
} from '../../shared/contracts';
import { drawPetOverlays } from './pet-overlays';

const ALPHA_HIT_THRESHOLD = 12;
const DRAG_START_DISTANCE = 4;
/** 单击等待双击的窗口，对应基准 doubleClickInterval + 20（200~520ms）。 */
const SINGLE_CLICK_DELAY_MS = 300;

const DEFAULT_MOTION: MotionState = {
  phase: 'idle',
  behaviorState: 'IDLE',
  velocityX: 0,
  velocityY: 0,
  lookFrame: null,
  animationCue: null,
  overlay: {
    emotion: 'normal',
    activeEvent: null,
    eventVariant: null,
    activeFood: null,
    hungerLow: false,
    cleanlinessLow: false,
    sleeping: false,
  },
};
const DEFAULT_SETTINGS: PetSettings = {
  scale: 1,
  alwaysOnTop: true,
  autoMove: true,
  chaseCursor: true,
  allowThrowing: true,
  activityFrequency: 55,
  launchAtStartup: false,
  selectedPetId: 'codex:tudou',
  codexHomeOverride: '',
  updateManifestUrl: '',
  soundEnabled: false,
  soundVolume: 35,
  desktopEffects: true,
  showStatusReminders: true,
  lowPowerMode: false,
  particlesEnabled: true,
  shadowsEnabled: true,
  trailsEnabled: true,
  autoPauseGames: true,
  quietNightMode: true,
  autoSleep: true,
  bubbleEnabled: true,
  dialogueFrequency: 45,
  gameTargetFps: 60,
  gameEffectLevel: 2,
  preferredScreen: '',
  personalityId: 'lime',
  anonymousAnalytics: false,
};

/**
 * 宠物窗口交互，对应 desktop_pet pet/pet_window.py：
 * 左键按住拖动、单击摸摸（等待双击窗口）、双击打开状态面板、
 * 滚轮互动、右键弹出完整菜单。
 */
export function PetApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const actionImageRef = useRef<HTMLImageElement | null>(null);
  const renderKeyRef = useRef('base:idle');
  const animationStartedAtRef = useRef(0);
  const handledCueIdRef = useRef<number | null>(null);
  const cuePlaybackRef = useRef<{
    id: number;
    action: string;
    definition: PetActionDefinition;
    startedAt: number;
  } | null>(null);
  const phaseStartedAtRef = useRef(0);
  const motionRef = useRef<MotionState>(DEFAULT_MOTION);
  const settingsRef = useRef<PetSettings>(DEFAULT_SETTINGS);
  const draggingRef = useRef(false);
  const dragRejectedRef = useRef(false);
  const pressRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const pendingClickRef = useRef<{ relativeY: number } | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const passthroughRef = useRef(false);
  const interactionUntilRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activePet, setActivePet] = useState<PetCatalogEntry | null>(null);

  useEffect(() => {
    const applyCatalog = (entries: PetCatalogEntry[]) => {
      setReady(false);
      setLoadFailed(false);
      setActivePet(entries.find((entry) => entry.active) ?? null);
    };
    void window.desktopPet.listPets().then(applyCatalog);
    return window.desktopPet.onPetCatalogChanged(applyCatalog);
  }, []);

  useEffect(() => {
    if (!activePet) {
      return;
    }
    let cancelled = false;
    actionImageRef.current = null;
    cuePlaybackRef.current = null;
    handledCueIdRef.current = null;
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) {
        return;
      }
      imageRef.current = image;
      hitCanvasRef.current = document.createElement('canvas');
      hitCanvasRef.current.width = PET_CELL_WIDTH;
      hitCanvasRef.current.height = PET_CELL_HEIGHT;
      setReady(true);
    };
    image.onerror = () => {
      if (!cancelled) {
        setLoadFailed(true);
      }
    };
    image.src =
      `pet-asset://current/spritesheet?v=${encodeURIComponent(
        activePet.contentHash,
      )}`;
    if (activePet.actionManifest) {
      const actionImage = new Image();
      actionImage.decoding = 'async';
      actionImage.crossOrigin = 'anonymous';
      actionImage.onload = () => {
        if (!cancelled) {
          actionImageRef.current = actionImage;
        }
      };
      actionImage.onerror = () => {
        if (!cancelled) {
          actionImageRef.current = null;
        }
      };
      actionImage.src =
        `pet-asset://current/actions?v=${encodeURIComponent(
          activePet.contentHash,
        )}`;
    }
    return () => {
      cancelled = true;
      imageRef.current = null;
      actionImageRef.current = null;
    };
  }, [activePet]);

  useEffect(() => {
    void window.desktopPet.getSettings().then((settings) => {
      settingsRef.current = settings;
    });
    const removeMotionListener = window.desktopPet.onMotionState((motion) => {
      motionRef.current = motion;
    });
    const removeSettingsListener = window.desktopPet.onSettingsChanged(
      (settings) => {
        settingsRef.current = settings;
      },
    );
    return () => {
      removeMotionListener();
      removeSettingsListener();
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    let animationFrame = 0;

    const draw = (timestamp: number) => {
      const canvas = canvasRef.current;
      const hitCanvas = hitCanvasRef.current;
      const image = imageRef.current;
      if (!canvas || !hitCanvas || !image) {
        return;
      }

      const scale = settingsRef.current.scale;
      const deviceScale = window.devicePixelRatio || 1;
      const backingWidth = Math.max(
        1,
        Math.round(PET_CELL_WIDTH * scale * deviceScale),
      );
      const backingHeight = Math.max(
        1,
        Math.round(PET_CELL_HEIGHT * scale * deviceScale),
      );
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }

      const motion = motionRef.current;
      const actionManifest = activePet?.actionManifest ?? null;
      const actionImage = actionImageRef.current;
      const cue = motion.animationCue;
      if (
        cue
        && cue.id !== handledCueIdRef.current
        && actionManifest
        && actionImage
      ) {
        handledCueIdRef.current = cue.id;
        const definition = actionManifest.animations[cue.action];
        if (definition) {
          cuePlaybackRef.current = {
            id: cue.id,
            action: cue.action,
            definition,
            startedAt: timestamp,
          };
        }
      }

      let cuePlayback = cuePlaybackRef.current;
      if (
        cuePlayback
        && actionHasCompleted(
          cuePlayback.definition,
          (timestamp - cuePlayback.startedAt) / 1_000,
        )
      ) {
        cuePlaybackRef.current = null;
        cuePlayback = null;
      }

      const lookActive =
        activePet?.spriteVersionNumber === 2
        && motion.lookFrame !== null
        && ['IDLE', 'LOOK_AT_CURSOR'].includes(motion.behaviorState);
      const stateAction =
        !cuePlayback
        && timestamp >= interactionUntilRef.current
        && !lookActive
        && actionManifest
        && actionImage
          ? actionForMotion(actionManifest, motion)
          : null;

      let sourceImage = image;
      let sourceRow: number;
      let sourceColumn: number;
      if (cuePlayback && actionImage) {
        const renderKey = `cue:${cuePlayback.id}:${cuePlayback.action}`;
        if (renderKeyRef.current !== renderKey) {
          renderKeyRef.current = renderKey;
          animationStartedAtRef.current = cuePlayback.startedAt;
        }
        const frame = actionFrameAtElapsed(
          cuePlayback.definition,
          (timestamp - cuePlayback.startedAt) / 1_000,
          false,
        );
        [sourceRow, sourceColumn] = actionFramePosition(
          cuePlayback.definition,
          frame,
        );
        sourceImage = actionImage;
      } else if (stateAction && actionManifest && actionImage) {
        const renderKey = `action:${stateAction}`;
        if (renderKeyRef.current !== renderKey) {
          renderKeyRef.current = renderKey;
          animationStartedAtRef.current = timestamp;
        }
        const definition = actionManifest.animations[stateAction]!;
        const frame = actionFrameAtElapsed(
          definition,
          (timestamp - animationStartedAtRef.current) / 1_000,
        );
        [sourceRow, sourceColumn] = actionFramePosition(definition, frame);
        sourceImage = actionImage;
      } else {
        const preferredAnimation =
          timestamp < interactionUntilRef.current
            ? 'wave'
            : lookActive
              ? 'look'
              : animationForMotion(motion);
        const renderKey = `base:${preferredAnimation}`;
        if (renderKeyRef.current !== renderKey) {
          renderKeyRef.current = renderKey;
          animationStartedAtRef.current = timestamp;
        }
        const animation = ATLAS_ANIMATIONS[preferredAnimation];
        const elapsedSeconds =
          (timestamp - animationStartedAtRef.current) / 1_000;
        const frame =
          preferredAnimation === 'look' && motion.lookFrame !== null
            ? motion.lookFrame
            : frameAtElapsed(animation, elapsedSeconds);
        [sourceRow, sourceColumn] = framePosition(animation, frame);
      }
      const sourceX = sourceColumn * PET_CELL_WIDTH;
      const sourceY = sourceRow * PET_CELL_HEIGHT;

      const context = canvas.getContext('2d', { alpha: true });
      if (context) {
        context.setTransform(
          deviceScale * scale,
          0,
          0,
          deviceScale * scale,
          0,
          0,
        );
        context.clearRect(0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          sourceImage,
          sourceX,
          sourceY,
          PET_CELL_WIDTH,
          PET_CELL_HEIGHT,
          0,
          0,
          PET_CELL_WIDTH,
          PET_CELL_HEIGHT,
        );
        const phaseSeconds = (timestamp - phaseStartedAtRef.current) / 1_000;
        drawPetOverlays(context, {
          behaviorState: motion.behaviorState,
          phaseSeconds,
          overlay: motion.overlay,
          desktopEffects: settingsRef.current.desktopEffects,
          customActionVisuals: sourceImage === actionImage,
        });
      }

      const hitContext = hitCanvas.getContext('2d', {
        alpha: true,
        willReadFrequently: true,
      });
      if (hitContext) {
        hitContext.clearRect(0, 0, PET_CELL_WIDTH, PET_CELL_HEIGHT);
        hitContext.drawImage(
          sourceImage,
          sourceX,
          sourceY,
          PET_CELL_WIDTH,
          PET_CELL_HEIGHT,
          0,
          0,
          PET_CELL_WIDTH,
          PET_CELL_HEIGHT,
        );
      }

      animationFrame = requestAnimationFrame(draw);
    };

    animationStartedAtRef.current = performance.now();
    phaseStartedAtRef.current = performance.now();
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [activePet?.spriteVersionNumber, activePet?.actionManifest, ready]);

  const isOpaqueAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const hitCanvas = hitCanvasRef.current;
    if (!canvas || !hitCanvas) {
      return false;
    }
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }
    const x = Math.floor((clientX / bounds.width) * PET_CELL_WIDTH);
    const y = Math.floor((clientY / bounds.height) * PET_CELL_HEIGHT);
    if (x < 0 || y < 0 || x >= PET_CELL_WIDTH || y >= PET_CELL_HEIGHT) {
      return false;
    }
    const context = hitCanvas.getContext('2d', { willReadFrequently: true });
    return Boolean(
      context
      && context.getImageData(x, y, 1, 1).data[3] > ALPHA_HIT_THRESHOLD,
    );
  }, []);

  const updatePassthrough = useCallback((ignored: boolean) => {
    if (passthroughRef.current === ignored || draggingRef.current) {
      return;
    }
    passthroughRef.current = ignored;
    void window.desktopPet.setPointerPassthrough(ignored);
  }, []);

  const scheduleSingleClick = useCallback((relativeY: number) => {
    pendingClickRef.current = { relativeY };
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      const pending = pendingClickRef.current;
      pendingClickRef.current = null;
      if (pending) {
        void window.desktopPet.petSingleClick(pending.relativeY);
      }
    }, SINGLE_CLICK_DELAY_MS);
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const press = pressRef.current;
      if (press && !draggingRef.current && !dragRejectedRef.current) {
        if (
          Math.hypot(
            event.clientX - press.clientX,
            event.clientY - press.clientY,
          ) >= DRAG_START_DISTANCE
        ) {
          void window.desktopPet.beginDrag().then((started) => {
            if (started) {
              draggingRef.current = true;
              if (clickTimerRef.current !== null) {
                window.clearTimeout(clickTimerRef.current);
                clickTimerRef.current = null;
              }
              pendingClickRef.current = null;
            } else {
              dragRejectedRef.current = true;
            }
          });
        }
        return;
      }
      if (draggingRef.current) {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      void window.desktopPet.updatePointer({
        hovering: true,
        relativeX:
          bounds.width > 0 ? event.clientX / bounds.width : 0.5,
        relativeY:
          bounds.height > 0 ? event.clientY / bounds.height : 0.5,
      });
      updatePassthrough(!isOpaqueAt(event.clientX, event.clientY));
    },
    [isOpaqueAt, updatePassthrough],
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const wasDragging = draggingRef.current;
      const wasPressed = pressRef.current !== null;
      draggingRef.current = false;
      dragRejectedRef.current = false;
      const relativeY = pressRef.current
        ? (event.clientY
          - event.currentTarget.getBoundingClientRect().top)
          / Math.max(1, event.currentTarget.getBoundingClientRect().height)
        : 0.5;
      pressRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (wasDragging) {
        void window.desktopPet.endDrag();
        return;
      }
      if (wasPressed) {
        scheduleSingleClick(relativeY);
      }
    },
    [scheduleSingleClick],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (
        event.button !== 0
        || !isOpaqueAt(event.clientX, event.clientY)
      ) {
        return;
      }
      event.preventDefault();
      passthroughRef.current = false;
      void window.desktopPet.setPointerPassthrough(false);
      pressRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isOpaqueAt],
  );

  if (loadFailed) {
    return <div className="pet-error">土豆图集加载失败</div>;
  }

  return (
    <main className="pet-surface" data-ready={ready}>
      <canvas
        ref={canvasRef}
        className="pet-canvas"
        aria-label="桌面宠物土豆"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          if (pressRef.current) {
            return;
          }
          void window.desktopPet.updatePointer({
            hovering: false,
            relativeX: 0.5,
            relativeY: 0.5,
          });
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={() => {
          if (clickTimerRef.current !== null) {
            window.clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
          }
          pendingClickRef.current = null;
          interactionUntilRef.current = performance.now() + 1_200;
          void window.desktopPet.petDoubleClick();
        }}
        onWheel={(event) => {
          void window.desktopPet.petWheel(event.deltaY);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void window.desktopPet.showPetContextMenu();
        }}
      />
    </main>
  );
}
