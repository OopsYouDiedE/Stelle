import type { StelleEventBus } from "../../utils/event_bus.js";
import { normalizeLiveEvent } from "../../utils/live_event.js";
import { ViewerProfileStore } from "./viewer_profile.js";

export class LiveRelationshipService {
  private unsubscribes: Array<() => void> = [];

  constructor(
    private readonly eventBus: StelleEventBus,
    readonly profiles = new ViewerProfileStore(),
  ) {}

  start(): void {
    this.unsubscribes.push(this.eventBus.subscribe("live.event.received", (event) => {
      const normalized = normalizeLiveEvent(event.payload);
      this.profiles.updateFromEvent(normalized).catch((error) => {
        console.warn("[LiveRelationshipService] profile update failed:", error);
      });
    }));
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }
}
