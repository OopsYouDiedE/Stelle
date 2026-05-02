import { z } from "zod";
import { ok, fail, sideEffects } from "../../tooling/types.js";
import type { ToolDefinition } from "../../tooling/types.js";
import type { ToolRegistryDeps } from "../../tooling/deps.js";

export function createSceneTools(deps: ToolRegistryDeps): ToolDefinition[] {
  return [
    {
      name: "scene.observe",
      title: "Observe Scene",
      description: "Read a structured, read-only observation of the current live scene.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      async execute() {
        if (!deps.sceneObserver) return fail("scene_unavailable", "Scene observer is not configured.");
        const observation = (await deps.sceneObserver.observe()) as { timestamp: number };
        deps.eventBus?.publish({
          type: "scene.observation.received",
          source: "scene",
          id: `scene-observation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: observation.timestamp,
          payload: observation as any,
        } as any);
        return ok("Scene observed.", { observation });
      },
    },
  ];
}
