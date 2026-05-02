import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import { RuntimeKernel } from "./kernel.js";
import { DefaultRuntimeKernelPipeline } from "./default_pipeline.js";
import { createRuntimeKernelDebugProvider } from "./debug_provider.js";

let activeKernel: RuntimeKernel | undefined;
let unsubscribePerceptualEvents: (() => void) | undefined;

export const runtimeKernelCapability: ComponentPackage = {
  id: "capability.cognition.runtime_kernel",
  kind: "capability",
  version: "1.0.0",
  displayName: "Runtime Kernel",

  provides: [
    { id: "cognition.kernel", kind: "service" },
    { id: "cognition.kernel.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const pipeline = new DefaultRuntimeKernelPipeline();
    const kernel = new RuntimeKernel(pipeline);
    activeKernel = kernel;
    ctx.registry.provideForPackage?.(runtimeKernelCapability.id, "cognition.kernel", kernel) ??
      ctx.registry.provide("cognition.kernel", kernel);
    ctx.registry.provideDebugProvider(createRuntimeKernelDebugProvider(kernel));
  },

  async start(ctx: ComponentRuntimeContext) {
    const kernel = ctx.registry.resolve<RuntimeKernel>("cognition.kernel");
    unsubscribePerceptualEvents = ctx.events.subscribe("perceptual.event", (event) => {
      const payload = asRecord(event).payload;
      if (!kernel || !isPerceptualEvent(payload)) return;
      void kernel
        .step(payload)
        .then((decisions) => {
          for (const decision of decisions) {
            if (decision.kind !== "intent") continue;
            ctx.events.publish({
              type: "cognition.intent",
              source: runtimeKernelCapability.id,
              payload: decision.intent,
              metadata: { reason: decision.reason, sourceEventIds: decision.intent.sourceEventIds },
            });
          }
        })
        .catch((error) => ctx.logger.error("Runtime Kernel failed to process perceptual event", error));
    });
    ctx.logger.log("Runtime Kernel started");
  },

  async stop(ctx: ComponentRuntimeContext) {
    unsubscribePerceptualEvents?.();
    unsubscribePerceptualEvents = undefined;
    ctx.logger.log("Runtime Kernel stopped");
  },

  async snapshotState() {
    return activeKernel?.snapshot();
  },

  async hydrateState(state: unknown) {
    if (activeKernel && state && typeof state === "object") {
      activeKernel.hydrate(state as ReturnType<RuntimeKernel["snapshot"]>);
    }
  },
};

function isPerceptualEvent(value: unknown): value is PerceptualEvent {
  const record = asRecord(value);
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    typeof record.sourceWindow === "string" &&
    typeof record.timestamp === "number" &&
    "payload" in record
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
