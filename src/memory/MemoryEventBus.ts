import type { MemoryEvent } from "./events.js";

export type MemoryEventListener = (event: MemoryEvent) => void;

export class MemoryEventBus {
  private readonly listeners = new Set<MemoryEventListener>();
  private readonly history: MemoryEvent[] = [];

  subscribe(listener: MemoryEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: MemoryEvent): void {
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  snapshot(): MemoryEvent[] {
    return [...this.history];
  }
}
