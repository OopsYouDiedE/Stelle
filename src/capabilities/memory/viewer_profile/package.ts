import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { LiveRelationshipService } from "./relationship_service.js";
import { createViewerProfileDebugProvider } from "./debug_provider.js";

export const viewerProfileCapability: ComponentPackage = {
  id: "capability.memory.viewer_profile",
  kind: "capability",
  version: "1.0.0",
  displayName: "Viewer Profile",

  provides: [
    { id: "memory.viewer_profile", kind: "service" },
    { id: "memory.viewer_profile.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const service = new LiveRelationshipService(ctx.events as never);
    ctx.registry.provideForPackage?.(viewerProfileCapability.id, "memory.viewer_profile", service) ??
      ctx.registry.provide("memory.viewer_profile", service);
    ctx.registry.provideDebugProvider(createViewerProfileDebugProvider(service));
  },

  async start(ctx: ComponentRuntimeContext) {
    const service = ctx.registry.resolve<LiveRelationshipService>("memory.viewer_profile");
    if (service) {
      service.start();
    }
  },

  async stop(ctx: ComponentRuntimeContext) {
    const service = ctx.registry.resolve<LiveRelationshipService>("memory.viewer_profile");
    if (service) {
      service.stop();
    }
  },
};
