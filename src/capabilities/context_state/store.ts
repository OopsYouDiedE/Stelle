import type { ContextState } from "./schema.js";

/**
 * 上下文状态存储 (Context State Store)
 */
export class ContextStateStore {
  private currentState: ContextState;

  constructor(initialState?: Partial<ContextState>) {
    this.currentState = {
      contextId: "default",
      version: 0,
      availableDomains: ["reply", "memory"],
      ...initialState,
    };
  }

  public get(): ContextState {
    return { ...this.currentState };
  }

  public update(patch: Partial<ContextState>): ContextState {
    this.currentState = {
      ...this.currentState,
      ...patch,
      version: this.currentState.version + 1,
    };
    return this.get();
  }
}
