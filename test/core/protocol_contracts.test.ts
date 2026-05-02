import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ComponentPackage } from "../../src/core/protocol/component.js";
import type { ResourceRef, StreamRef } from "../../src/core/protocol/data_ref.js";
import type { ExecutionCommand, ExecutionResult } from "../../src/core/protocol/execution.js";
import type { Intent, StageOutputIntentPayload } from "../../src/core/protocol/intent.js";
import type { PerceptualEvent, TextPerceptualPayload } from "../../src/core/protocol/perceptual_event.js";
import type { DebugProvider } from "../../src/debug/contracts/debug_provider.js";

describe("core protocol contracts", () => {
  it("allows packages to declare lifecycle contracts without concrete capability imports", () => {
    const pkg: ComponentPackage = {
      id: "capability.example",
      kind: "capability",
      version: "1.0.0",
      provides: [{ id: "capability.example", kind: "service" }],
      register(ctx) {
        ctx.registry.provide("capability.example", { ok: true });
      },
    };

    expect(pkg.id).toBe("capability.example");
  });

  it("models control-plane events and data-plane references separately", () => {
    const ref: ResourceRef = {
      id: "frame_1",
      kind: "image",
      mediaType: "image/png",
      ownerPackageId: "window.fixture",
      createdAt: 1,
      ttlMs: 5000,
      accessScope: "runtime",
    };
    const stream: StreamRef = {
      id: "stream_1",
      kind: "video_stream",
      ownerPackageId: "window.fixture",
      createdAt: 1,
      transport: "memory_ring",
      latestOnly: true,
    };
    const event: PerceptualEvent<TextPerceptualPayload> = {
      id: "evt_1",
      type: "live.text_message",
      sourceWindow: "window.live",
      occurredAt: 1,
      payload: { text: "hello" },
      resourceRefs: [ref],
      streamRefs: [stream],
    };

    expect(event.payload.text).toBe("hello");
    expect(event.resourceRefs?.[0].id).toBe("frame_1");
  });

  it("models intents and execution results with mandatory reasons", () => {
    const intent: Intent<StageOutputIntentPayload> = {
      id: "intent_1",
      type: "stage.output.say",
      ownerPackageId: "capability.cognition.runtime_kernel",
      createdAt: 1,
      priority: "normal",
      reason: "addressable text message",
      payload: {
        lane: "direct_response",
        text: "hello back",
        salience: "medium",
        interrupt: "none",
        ttlMs: 30000,
      },
    };
    const command: ExecutionCommand = {
      id: "cmd_1",
      type: "stage.output.propose",
      ownerPackageId: "window.live",
      createdAt: 2,
      risk: "safe_write",
      payload: { intentId: intent.id },
      sourceIntentIds: [intent.id],
      reason: "route kernel intent to stage output",
    };
    const result: ExecutionResult = {
      id: "res_1",
      commandId: command.id,
      ownerPackageId: "capability.expression.stage_output",
      completedAt: 3,
      status: "completed",
      reason: "accepted by output arbiter",
    };

    expect(intent.reason).toContain("addressable");
    expect(result.status).toBe("completed");
  });

  it("keeps DebugProvider as a debug contract owned by packages", () => {
    const provider: DebugProvider = {
      id: "example.debug",
      title: "Example",
      ownerPackageId: "capability.example",
      panels: [{ id: "snapshot", title: "Snapshot", kind: "json", getData: () => ({ ok: true }) }],
    };

    expect(provider.panels?.[0].kind).toBe("json");
  });

  it("does not import concrete capability or window code from core protocols", () => {
    const protocolDir = path.join(process.cwd(), "src", "core", "protocol");
    for (const file of ["component.ts", "data_ref.ts", "execution.ts", "intent.ts", "perceptual_event.ts"]) {
      const source = readFileSync(path.join(protocolDir, file), "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/\.\.\/(capabilities|windows|live|cursor|stage|device)\//);
    }
  });
});
