import type { DebugProvider } from "../../../core/protocol/debug.js";
import type { LiveRelationshipService } from "./relationship_service.js";

export function createViewerProfileDebugProvider(service: LiveRelationshipService): DebugProvider {
  return {
    id: "memory.viewer_profile.debug",
    title: "Viewer Profiles",
    ownerPackageId: "capability.memory.viewer_profile",
    panels: [
      {
        id: "stats",
        title: "Profile Stats",
        kind: "json",
        getData: () => ({
          // Mock stats for now
          totalProfiles: 0,
        }),
      },
    ],
    getSnapshot: () => ({}),
  };
}
