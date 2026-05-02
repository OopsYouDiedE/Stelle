import type { ComponentPackage, ComponentRegisterContext } from "../../../core/protocol/component.js";
import { SceneObservationCapability } from "./observer.js";

export const sceneObservationPackage: ComponentPackage = {
  id: "capability.perception.scene_observation",
  kind: "capability",
  version: "1.0.0",
  displayName: "Scene Observation",

  requires: [],
  provides: [{ id: "perception.scene_observation", kind: "service" }],

  register(ctx: ComponentRegisterContext) {
    const observer = new SceneObservationCapability(ctx.dataPlane, ctx.events as never);
    ctx.registry.provideForPackage?.(sceneObservationPackage.id, "perception.scene_observation", observer) ??
      ctx.registry.provide("perception.scene_observation", observer);
  },
};
