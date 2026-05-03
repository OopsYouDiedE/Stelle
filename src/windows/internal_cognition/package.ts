import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import { InternalCognitionWindow } from "./runtime.js";
import { CognitionCapability } from "../../capabilities/cognition/api.js";
import { DecisionPolicyCapability } from "../../capabilities/decision_policy/api.js";
import { NarrativeCapability } from "../../capabilities/narrative/api.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { VersionedStore } from "../../core/state/versioned_store.js";
import type { LlmClient } from "../../capabilities/model/llm.js";

export const internalCognitionPackage: ComponentPackage = {
  id: "window.internal_cognition",
  kind: "window",
  version: "1.0.0",
  displayName: "Internal Cognition Window",

  provides: [
    { id: "window.internal_cognition", kind: "service" },
  ],

  register(ctx: ComponentRegisterContext) {
    const eventBus = ctx.registry.resolve<StelleEventBus>("core.event_bus");
    const versionedStore = ctx.registry.resolve<VersionedStore>("core.versioned_store");
    const llm = ctx.registry.resolve<LlmClient>("model.llm");
    const cognition = new CognitionCapability(llm!);
    const decisionPolicy = new DecisionPolicyCapability();
    const narrative = new NarrativeCapability();

    const window = new InternalCognitionWindow({
      eventBus: eventBus!,
      cognition,
      decisionPolicy,
      narrative,
      versionedStore: versionedStore!,
      agentId: "stelle",
    });

    ctx.registry.provide("window.internal_cognition", window);
  },

  async start(ctx: ComponentRuntimeContext) {},
  async stop(ctx: ComponentRuntimeContext) {},
};
