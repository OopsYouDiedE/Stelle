import type { StelleEventBus } from "../../../core/event/event_bus.js";
import { ViewerProfileStore, type ViewerInteractionEvent } from "./viewer_profile_store.js";

export class LiveRelationshipService {
  private unsubscribes: Array<() => void> = [];

  constructor(
    private readonly eventBus: StelleEventBus,
    readonly profiles = new ViewerProfileStore(),
  ) {}

  start(): void {
    this.unsubscribes.push(
      this.eventBus.subscribe("perceptual.event", (event) => {
        const normalized = toViewerInteractionEvent(event.payload as Record<string, unknown>);
        if (!normalized) return;
        this.profiles.updateFromEvent(normalized).catch((error) => {
          console.warn("[LiveRelationshipService] profile update failed:", error);
        });
      }),
    );
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }
}

function toViewerInteractionEvent(payload: Record<string, unknown>): ViewerInteractionEvent | undefined {
  const event = payload as { id?: string; sourceWindow?: string; actorId?: string; timestamp?: number; payload?: any; metadata?: any };
  const inner = event.payload ?? payload;
  const actor = inner.actor && typeof inner.actor === "object" ? inner.actor : {};
  const actorRecord = actor as { id?: unknown; name?: unknown; displayName?: unknown };
  const text = String(inner.text ?? "").trim();
  const actorId = String(event.actorId ?? actorRecord.id ?? actorRecord.name ?? "");
  if (!actorId && !text) return undefined;
  const kind = inner.kind === "super_chat" || inner.kind === "gift" || inner.kind === "guard" ? inner.kind : "text";
  return {
    id: String(event.id ?? `viewer-event-${Date.now()}`),
    source: String(event.sourceWindow ?? event.metadata?.rawPlatform ?? "runtime"),
    kind,
    priority: event.metadata?.priority,
    receivedAt: Number(event.timestamp ?? Date.now()),
    user: {
      id: actorId || undefined,
      name: String(actorRecord.name ?? actorRecord.displayName ?? actorId ?? ""),
    },
    text,
    trustedPayment:
      inner.trust?.paid === true && (kind === "gift" || kind === "super_chat" || kind === "guard")
        ? { rawType: kind }
        : undefined,
  };
}
