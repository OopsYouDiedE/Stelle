import fs from "node:fs/promises";
import path from "node:path";
import type { Live2DModelConfig } from "./types.js";

function defaultResourcesRoot(): string {
  return path.resolve(process.env.LIVE2D_RESOURCES_ROOT ?? "ai-live2d-go/public/Resources");
}

export function createHiyoriModelConfigs(resourcesRoot = defaultResourcesRoot()): Live2DModelConfig[] {
  return [
    {
      id: "Hiyori",
      displayName: "Hiyori",
      dir: "Hiyori",
      jsonName: "Hiyori.model3.json",
      resourcesRoot,
      modelJsonPath: path.join(resourcesRoot, "Hiyori", "Hiyori.model3.json"),
      motions: {
        idle: "Idle",
        tapBody: "TapBody",
      },
      hitAreas: {
        body: "Body",
      },
    },
    {
      id: "Hiyori_pro",
      displayName: "Hiyori Pro",
      dir: "Hiyori_pro",
      jsonName: "hiyori_pro_t11.model3.json",
      resourcesRoot,
      modelJsonPath: path.join(resourcesRoot, "Hiyori_pro", "hiyori_pro_t11.model3.json"),
      motions: {
        idle: "Idle",
        tap: "Tap",
        tapBody: "Tap@Body",
        flick: "Flick",
        flickUp: "FlickUp",
        flickDown: "FlickDown",
        flickBody: "Flick@Body",
      },
      hitAreas: {
        body: "Body",
      },
    },
  ];
}

export class Live2DModelRegistry {
  private readonly models = new Map<string, Live2DModelConfig>();

  constructor(models: Live2DModelConfig[] = createHiyoriModelConfigs()) {
    for (const model of models) {
      this.models.set(model.id, model);
    }
  }

  list(): Live2DModelConfig[] {
    return [...this.models.values()].map((model) => ({ ...model, motions: { ...model.motions }, hitAreas: { ...model.hitAreas } }));
  }

  get(id: string): Live2DModelConfig | undefined {
    const model = this.models.get(id);
    return model ? { ...model, motions: { ...model.motions }, hitAreas: { ...model.hitAreas } } : undefined;
  }

  getDefault(): Live2DModelConfig {
    const preferred = process.env.LIVE2D_DEFAULT_MODEL ?? "Hiyori_pro";
    return this.get(preferred) ?? this.list()[0]!;
  }

  async checkAssets(id: string): Promise<{ ok: boolean; model?: Live2DModelConfig; missing?: string[] }> {
    const model = this.get(id);
    if (!model) return { ok: false, missing: [`model:${id}`] };
    const modelJsonPath = model.modelJsonPath ?? path.join(model.resourcesRoot, model.dir, model.jsonName);
    try {
      await fs.access(modelJsonPath);
      return { ok: true, model: { ...model, modelJsonPath } };
    } catch {
      return { ok: false, model: { ...model, modelJsonPath }, missing: [modelJsonPath] };
    }
  }
}
