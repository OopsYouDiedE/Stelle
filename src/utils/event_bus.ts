import { EventEmitter } from "node:events";
import type { StelleEvent } from "../cursor/types.js";

export class StelleEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(event: StelleEvent): void {
    const type = event.type;
    this.emit(type, event);
    this.emit("*", event);
  }

  subscribe<T extends StelleEvent["type"]>(
    type: T,
    listener: (event: Extract<StelleEvent, { type: T }>) => void
  ): () => void {
    this.on(type, listener as (...args: any[]) => void);
    return () => this.off(type, listener as (...args: any[]) => void);
  }
}
