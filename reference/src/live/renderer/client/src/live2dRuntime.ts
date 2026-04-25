import type * as PIXIModule from "pixi.js";
import type * as Live2DModule from "pixi-live2d-display/cubism4";

const CUBISM_CORE_ID = "stelle-live2d-cubism-core";
const CUBISM_CORE_SRC = "/Core/live2dcubismcore.js";

export interface Live2dRuntime {
  PIXI: typeof PIXIModule;
  Live2DModel: typeof Live2DModule.Live2DModel;
  MotionPriority: typeof Live2DModule.MotionPriority;
}

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

let runtimePromise: Promise<Live2dRuntime> | undefined;
let cubismCorePromise: Promise<void> | undefined;

function markScriptLoaded(script: HTMLScriptElement): void {
  script.dataset.loaded = "true";
}

function isScriptLoaded(script: HTMLScriptElement | null): boolean {
  return script?.dataset.loaded === "true";
}

function ensureCubismCore(): Promise<void> {
  if (window.Live2DCubismCore) return Promise.resolve();
  if (cubismCorePromise) return cubismCorePromise;

  cubismCorePromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(CUBISM_CORE_ID) as HTMLScriptElement | null;
    if (existing) {
      if (isScriptLoaded(existing) || window.Live2DCubismCore) {
        markScriptLoaded(existing);
        resolve();
        return;
      }
      existing.addEventListener(
        "load",
        () => {
          markScriptLoaded(existing);
          resolve();
        },
        { once: true }
      );
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${CUBISM_CORE_SRC}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = CUBISM_CORE_ID;
    script.src = CUBISM_CORE_SRC;
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        markScriptLoaded(script);
        resolve();
      },
      { once: true }
    );
    script.addEventListener("error", () => reject(new Error(`Failed to load ${CUBISM_CORE_SRC}`)), {
      once: true,
    });
    document.head.appendChild(script);
  }).catch((error) => {
    cubismCorePromise = undefined;
    throw error;
  });

  return cubismCorePromise;
}

export async function loadLive2dRuntime(): Promise<Live2dRuntime> {
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    await ensureCubismCore();
    const PIXI = await import("pixi.js");
    const { Live2DModel, MotionPriority } = await import("pixi-live2d-display/cubism4");
    Live2DModel.registerTicker(PIXI.Ticker);
    return { PIXI, Live2DModel, MotionPriority };
  })().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });

  return runtimePromise;
}
