import { describe, expect, it, vi } from "vitest";
import { buildDeviceActionAllowlist } from "../../src/capabilities/action/device_action/allowlist.js";
import { DeviceActionArbiter } from "../../src/capabilities/action/device_action/arbiter.js";
import type { DeviceActionDriver, DeviceActionIntent } from "../../src/capabilities/action/device_action/types.js";
import { LiveResponder } from "../../src/windows/live/legacy_cursor/responder.js";
import { DefaultMemoryWriter } from "../../src/capabilities/cognition/reflection/memory_writer.js";
import { ObsWebSocketController } from "../../src/utils/live.js";
import { createDefaultToolRegistry } from "../../src/tool.js";
import { recordEvalCase } from "../utils/report.js";
import { summarizeChecks, type CheckResult } from "../utils/scoring.js";

describe("Runtime Capability Coverage Eval", () => {
  it("records deterministic capability evidence for formerly stubbed features", async () => {
    await recordCapabilityCase(
      "device_actions_real_driver_contract",
      "Device actions route through non-mock driver contracts",
      async () => {
        const allowlist = buildDeviceActionAllowlist({
          browser: { enabled: false },
          desktopInput: { enabled: false },
          android: {
            enabled: true,
            allowlist: { resources: ["emulator-5554"], risks: ["readonly", "safe_interaction"] },
          },
        } as any);
        const driver = new RecordingDriver();
        const arbiter = new DeviceActionArbiter({
          drivers: [driver],
          now: () => 1000,
          allowlist,
        });
        const decision = await arbiter.propose(deviceIntent());
        return {
          output: { decision, executed: driver.executed },
          checks: [
            { ok: decision.status === "completed", name: "device_action_completed", note: `status=${decision.status}` },
            { ok: driver.executed.length === 1, name: "driver_called_once", note: `calls=${driver.executed.length}` },
            { ok: allowlist?.resourceKinds?.includes("android_device") === true, name: "android_allowlist_enabled" },
          ],
        };
      },
    );

    await recordCapabilityCase(
      "obs_websocket_control_contract",
      "OBS control exposes real status/start/stop/scene tools and disabled fail-closed behavior",
      async () => {
        const registry = createDefaultToolRegistry({ live: {} as any });
        const disabledStart = await new ObsWebSocketController({ enabled: false }).startStream();
        return {
          output: {
            tools: ["obs.status", "obs.start_stream", "obs.stop_stream", "obs.set_scene"].map((name) =>
              Boolean(registry.get(name)),
            ),
            disabledStart,
          },
          checks: [
            { ok: Boolean(registry.get("obs.status")), name: "obs_status_registered" },
            { ok: Boolean(registry.get("obs.start_stream")), name: "obs_start_registered" },
            { ok: Boolean(registry.get("obs.stop_stream")), name: "obs_stop_registered" },
            { ok: Boolean(registry.get("obs.set_scene")), name: "obs_scene_registered" },
            {
              ok: disabledStart.ok === false && disabledStart.summary.includes("disabled"),
              name: "obs_disabled_fail_closed",
            },
          ],
        };
      },
    );

    await recordCapabilityCase(
      "live_emotion_expression_mapping",
      "Live emotions map to concrete Live2D expression and motion commands",
      async () => {
        const stageOutput = {
          propose: vi
            .fn()
            .mockImplementation(async (intent) => ({ status: "accepted", outputId: intent.id, reason: "ok", intent })),
        };
        const responder = new LiveResponder({ config: { live: { ttsEnabled: false } }, stageOutput } as any);
        await responder.enqueue("response", "收到。", "laughing", { groupId: "eval" });
        const intent = stageOutput.propose.mock.calls[0][0];
        return {
          output: intent.output,
          checks: [
            {
              ok: intent.output.expression === "exp_02",
              name: "laughing_expression_mapped",
              note: `expression=${intent.output.expression}`,
            },
            {
              ok: intent.output.motion === "TapBody",
              name: "laughing_motion_mapped",
              note: `motion=${intent.output.motion}`,
            },
          ],
        };
      },
    );

    await recordCapabilityCase(
      "inner_memory_writer_persistence",
      "InnerMemoryWriter persists self state, research logs, and identity proposals",
      async () => {
        const memory = {
          writeLongTerm: vi.fn().mockResolvedValue(undefined),
          appendResearchLog: vi.fn().mockResolvedValue("log-1"),
          proposeMemory: vi.fn().mockResolvedValue("prop-1"),
        };
        const writer = new DefaultMemoryWriter(memory as any);
        await writer.writeSelfState("current_focus", "focus");
        await writer.writeResearchLog({ addedTopics: [], updatedTopics: [], closedTopics: [] });
        await writer.proposeIdentityChange({
          id: "p1",
          change: "identity proposal",
          rationale: "test",
          confidence: 0.7,
        });
        return {
          output: {
            writeLongTermCalls: memory.writeLongTerm.mock.calls,
            appendResearchLogCalls: memory.appendResearchLog.mock.calls,
            proposeMemoryCalls: memory.proposeMemory.mock.calls,
          },
          checks: [
            { ok: memory.writeLongTerm.mock.calls[0]?.[2] === "self_state", name: "self_state_write_layer" },
            { ok: memory.appendResearchLog.mock.calls.length === 1, name: "research_log_appended" },
            { ok: memory.proposeMemory.mock.calls[0]?.[0]?.layer === "core_identity", name: "identity_proposal_layer" },
          ],
        };
      },
    );
  });
});

async function recordCapabilityCase(
  caseId: string,
  title: string,
  run: () => Promise<{ output: unknown; checks: CheckResult[] }>,
): Promise<void> {
  const startedAt = Date.now();
  const { output, checks } = await run();
  const score = summarizeChecks(checks);
  expect(score.passed, score.failedChecks.join(", ")).toBe(true);
  await recordEvalCase({
    suite: "runtime_capabilities",
    caseId,
    title,
    model: "deterministic-runtime",
    latencyMs: Date.now() - startedAt,
    input: { caseId, title },
    output,
    score,
  });
}

class RecordingDriver implements DeviceActionDriver {
  readonly resourceKind = "android_device" as const;
  readonly executed: DeviceActionIntent[] = [];

  async execute(intent: DeviceActionIntent) {
    this.executed.push(intent);
    return {
      ok: true,
      summary: `recorded ${intent.actionKind}`,
      observation: { resourceKind: intent.resourceKind, actionKind: intent.actionKind },
    };
  }
}

function deviceIntent(): DeviceActionIntent {
  return {
    id: "eval-android-tap",
    cursorId: "android_device",
    resourceId: "emulator-5554",
    resourceKind: "android_device",
    actionKind: "android_tap",
    risk: "safe_interaction",
    priority: 50,
    createdAt: 1000,
    ttlMs: 5000,
    reason: "eval",
    payload: { x: 10, y: 20 },
  };
}
