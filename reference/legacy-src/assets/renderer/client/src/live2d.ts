import * as PIXI from "pixi.js";

declare global {
  interface Window {
    PIXI?: typeof PIXI;
  }
}

type Live2DModule = typeof import("pixi-live2d-display/cubism4");
type Live2DModelInstance = Awaited<ReturnType<Live2DModule["Live2DModel"]["from"]>>;

interface AvatarOptions {
  canvas: HTMLCanvasElement;
  status?: HTMLElement | null;
  lipSyncLevel?: HTMLElement | null;
  modelUrl?: string | null;
}

const DEFAULT_MODEL_URL = "/models/白-免费版/白-免费版.model3.json";
const LOCAL_CUBISM_CORE = "/vendor/live2dcubismcore.min.js";
const REMOTE_CUBISM_CORE = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const MOUTH_PARAMETER_CANDIDATES = ["ParamA", "ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y"];

export class Live2DAvatar {
  private app?: PIXI.Application;
  private model?: Live2DModelInstance;
  private live2d?: Live2DModule;
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private mediaSource?: MediaElementAudioSourceNode;
  private boundAudio?: HTMLAudioElement;
  private frequencyData?: Uint8Array;
  private timeDomainData?: Uint8Array;
  private mouthOpen = 0;
  private targetMouthOpen = 0;
  private speaking = false;
  private statusPulseAt = 0;
  private readonly modelUrl: string;

  constructor(private readonly options: AvatarOptions) {
    this.modelUrl = options.modelUrl || DEFAULT_MODEL_URL;
  }

  async mount(): Promise<void> {
    try {
      this.setStatus("loading Live2D runtime");
      await ensureCubismCore();
      window.PIXI = PIXI;
      this.live2d = await import("pixi-live2d-display/cubism4");

      this.app = new PIXI.Application({
        view: this.options.canvas,
        resizeTo: this.options.canvas.parentElement ?? window,
        autoDensity: true,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });

      this.setStatus("loading Live2D model");
      this.model = await this.live2d.Live2DModel.from(this.modelUrl, { autoInteract: true, autoUpdate: false });
      this.model.anchor.set(0.5, 0.56);
      this.model.interactive = true;
      this.model.on("hit", (hitAreas: string[]) => {
        if (hitAreas.some((area) => /body|head/i.test(area))) void this.triggerMotion("TapBody", "force");
      });
      this.model.internalModel.on("beforeModelUpdate", () => {
        this.applyMouthParameter(this.mouthOpen);
      });
      this.app.stage.addChild(this.model);
      this.app.ticker.add(() => {
        this.model?.update(this.app?.ticker.deltaMS ?? 16.67);
        this.fitModel();
        this.updateLipSync();
      });
      this.fitModel();
      void this.triggerMotion("Idle", "idle").catch(() => undefined);
      this.setStatus("Live2D ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Live2D failed: ${message}`);
      throw error;
    }
  }

  async startLipSync(audio: HTMLAudioElement): Promise<void> {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();

    if (this.boundAudio !== audio) {
      this.mediaSource?.disconnect();
      this.analyser?.disconnect();
      this.mediaSource = this.audioContext.createMediaElementSource(audio);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.48;
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeDomainData = new Uint8Array(this.analyser.fftSize);
      this.mediaSource.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      this.boundAudio = audio;
    }

    this.speaking = true;
    this.setStatus("Live2D voice sync");
  }

  async startLipSyncFromAnalyser(analyser: AnalyserNode): Promise<void> {
    if (!this.audioContext) this.audioContext = analyser.context as AudioContext;
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    this.analyser = analyser;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeDomainData = new Uint8Array(this.analyser.fftSize);
    this.speaking = true;
    this.setStatus("Live2D voice sync");
  }

  stopLipSync(): void {
    this.speaking = false;
    this.targetMouthOpen = 0;
    this.setStatus("Live2D ready");
  }

  async triggerMotion(group: string, priority: "idle" | "normal" | "force" = "normal"): Promise<void> {
    if (!this.model || !this.live2d) return;
    const motionPriority =
      priority === "force"
        ? this.live2d.MotionPriority.FORCE
        : priority === "idle"
          ? this.live2d.MotionPriority.IDLE
          : this.live2d.MotionPriority.NORMAL;
    try {
      await this.model.motion(group, undefined, motionPriority);
    } catch (error) {
      console.warn(`Live2D motion failed: ${group}`, error);
    }
  }

  async setExpression(expression: string): Promise<void> {
    const expressionManager = this.model?.internalModel.motionManager.expressionManager;
    if (!expressionManager) return;
    await expressionManager.setExpression(expression);
  }

  private updateLipSync(): void {
    if (this.speaking && this.analyser && this.frequencyData && this.timeDomainData) {
      this.analyser.getByteFrequencyData(this.frequencyData);
      this.analyser.getByteTimeDomainData(this.timeDomainData);
      let squareSum = 0;
      for (const sample of this.timeDomainData) {
        const centered = (sample - 128) / 128;
        squareSum += centered * centered;
      }
      const rms = Math.sqrt(squareSum / this.timeDomainData.length);
      this.targetMouthOpen = clamp((rms - 0.012) * 9.5, 0, 1);
      this.pulseVoiceStatus(this.targetMouthOpen);
    }

    this.mouthOpen += (this.targetMouthOpen - this.mouthOpen) * (this.speaking ? 0.42 : 0.2);
    this.updateLipSyncIndicator(this.mouthOpen);
  }

  private applyMouthParameter(value: number): void {
    const coreModel = this.model?.internalModel.coreModel as
      | {
          setParameterValueById?: (id: string, value: number, weight?: number) => void;
          setParamFloat?: (id: string, value: number, weight?: number) => void;
        }
      | undefined;
    if (!coreModel) return;

    for (const parameter of MOUTH_PARAMETER_CANDIDATES) {
      try {
        coreModel.setParameterValueById?.(parameter, value, 1);
        coreModel.setParamFloat?.(parameter, value, 1);
      } catch {
        // Models vary in mouth parameter naming; try the next common id.
      }
    }
  }

  private fitModel(): void {
    if (!this.app || !this.model) return;
    const width = this.app.renderer.width / this.app.renderer.resolution;
    const height = this.app.renderer.height / this.app.renderer.resolution;
    const bounds = this.model.getLocalBounds();
    const scale = Math.min((width * 0.76) / bounds.width, (height * 1.08) / bounds.height);
    this.model.scale.set(scale);
    this.model.position.set(width * 0.52, height * 0.58);
  }

  private setStatus(text: string): void {
    if (this.options.status) this.options.status.textContent = text;
  }

  private updateLipSyncIndicator(value: number): void {
    if (!this.options.lipSyncLevel) return;
    this.options.lipSyncLevel.style.transform = `scaleX(${clamp(value, 0, 1)})`;
    this.options.lipSyncLevel.style.opacity = String(0.28 + clamp(value, 0, 1) * 0.72);
  }

  private pulseVoiceStatus(value: number): void {
    const now = performance.now();
    if (now - this.statusPulseAt < 250) return;
    this.statusPulseAt = now;
    this.setStatus(`Live2D voice sync ${Math.round(value * 100)}%`);
  }
}

function ensureCubismCore(): Promise<void> {
  if ("Live2DCubismCore" in window) return Promise.resolve();
  return loadScript(LOCAL_CUBISM_CORE).catch(() => loadScript(REMOTE_CUBISM_CORE));
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`failed to load ${src}`)), { once: true });
    document.head.append(script);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
