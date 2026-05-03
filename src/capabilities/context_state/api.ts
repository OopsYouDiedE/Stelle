import { ContextStateStore } from "./store.js";
import type { ContextState } from "./schema.js";

export interface ContextStateApi {
  get_snapshot(): ContextState;
  update_state(patch: Partial<ContextState>): ContextState;
}

export class ContextStateCapability implements ContextStateApi {
  private readonly store = new ContextStateStore();

  public get_snapshot(): ContextState {
    return this.store.get();
  }

  public update_state(patch: Partial<ContextState>): ContextState {
    return this.store.update(patch);
  }
}
