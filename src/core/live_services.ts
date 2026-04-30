import { LiveStageDirector } from "../live/controller/stage_director.js";
import { LiveEventJournal } from "../live/controller/event_journal.js";
import { LiveHealthService } from "../live/controller/health_service.js";
import { LiveRelationshipService } from "../live/controller/relationship_service.js";
import { LivePlatformManager } from "../live/adapters/manager.js";
import { PromptLabService } from "../live/controller/prompt_lab.js";
import { TopicScriptRuntimeService } from "../live/controller/topic_script_runtime.js";
import { TopicScriptReviewService } from "../live/controller/topic_script_review.js";
import { TopicScriptRepository } from "../live/controller/topic_script_repository.js";
import type { RuntimeServices } from "./container.js";
import type { LiveRendererServer } from "../live/infra/renderer_server.js";

export class LiveRuntimeServices {
  private liveStageDirector?: LiveStageDirector;
  private liveJournal?: LiveEventJournal;
  private liveHealth?: LiveHealthService;
  private liveRelationship?: LiveRelationshipService;
  private topicScriptRuntime?: TopicScriptRuntimeService;
  private topicScriptReview?: TopicScriptReviewService;
  private livePlatforms?: LivePlatformManager;

  constructor(
    private readonly services: RuntimeServices,
    private readonly renderer: LiveRendererServer | undefined,
  ) {}

  get health(): LiveHealthService | undefined { return this.liveHealth; }
  get journal(): LiveEventJournal | undefined { return this.liveJournal; }
  get topicScripts(): TopicScriptRuntimeService | undefined { return this.topicScriptRuntime; }

  async start(): Promise<void> {
    this.liveStageDirector = new LiveStageDirector({
      config: this.services.config,
      eventBus: this.services.eventBus,
      live: this.services.live,
      stageOutput: this.services.stageOutput,
      promptLab: new PromptLabService(this.services.llm),
      now: () => Date.now(),
    });
    this.liveStageDirector.start();

    this.liveJournal = new LiveEventJournal(this.services.eventBus);
    await this.liveJournal.start();
    this.liveRelationship = new LiveRelationshipService(this.services.eventBus, this.services.viewerProfiles);
    this.liveRelationship.start();
    this.livePlatforms = new LivePlatformManager(this.services.config, this.services.eventBus);
    await this.livePlatforms.start();
    this.liveHealth = new LiveHealthService({
      sessionId: this.liveJournal.sessionId,
      eventBus: this.services.eventBus,
      stageOutput: this.services.stageOutput,
      live: this.services.live,
      renderer: this.renderer,
      platforms: this.livePlatforms,
    });
    this.liveHealth.start();

    const topicScriptRepository = new TopicScriptRepository();
    this.topicScriptReview = new TopicScriptReviewService({ repository: topicScriptRepository });
    this.topicScriptRuntime = new TopicScriptRuntimeService({
      eventBus: this.services.eventBus,
      stageOutput: this.services.stageOutput,
      repository: topicScriptRepository,
    });
    await this.topicScriptRuntime.start();

    const enabled = this.livePlatforms.status()
      .filter(status => status.enabled)
      .map(status => `${status.platform}:${status.connected ? "connected" : status.lastError ?? "idle"}`);
    if (enabled.length) console.log(`[Stelle] Live platform bridges: ${enabled.join(", ")}`);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([
      this.liveHealth?.stop(),
      this.liveStageDirector?.stop(),
      this.topicScriptRuntime?.stop(),
      this.liveJournal?.stop(),
      this.livePlatforms?.stop(),
    ]);
    this.liveRelationship?.stop();
  }

  async runTopicScriptCommand(input: Record<string, unknown>): Promise<unknown> {
    const action = String(input.action ?? input.type ?? "");
    if (!this.topicScriptRuntime || !this.topicScriptReview) return { ok: false, reason: "topic_script_unavailable" };
    if (action === "topic_script.snapshot") return { ok: true, runtime: this.topicScriptRuntime.snapshot(), revisions: await this.topicScriptReview.repository.list() };
    if (action === "topic_script.pause") return { ok: true, runtime: this.topicScriptRuntime.pause() };
    if (action === "topic_script.resume") return { ok: true, runtime: this.topicScriptRuntime.resume() };
    if (action === "topic_script.skip_section") return { ok: true, runtime: await this.topicScriptRuntime.skipSection(String(input.reason ?? "operator_skip")) };
    if (action === "topic_script.force_fallback") return { ok: true, runtime: await this.topicScriptRuntime.forceFallback(String(input.reason ?? "operator_fallback")) };
    if (action === "topic_script.load_latest") return { ok: await this.topicScriptRuntime.loadLatestApproved(), runtime: this.topicScriptRuntime.snapshot() };
    if (action === "topic_script.approve") {
      const record = await this.topicScriptReview.approve(readRevisionInput(input));
      this.services.eventBus.publish({
        type: "topic_script.approved" as any,
        source: "topic_script_review",
        payload: { scriptId: record.scriptId, revision: record.revision },
      });
      return { ok: true, record };
    }
    if (action === "topic_script.archive") return { ok: true, record: await this.topicScriptReview.archive(readRevisionInput(input)) };
    if (action === "topic_script.lock_section") {
      const record = await this.topicScriptReview.lockSection({
        ...readRevisionInput(input),
        sectionId: String(input.sectionId ?? input.section_id ?? ""),
      });
      return { ok: true, record };
    }
    return { ok: false, reason: `unknown_topic_script_action:${action}` };
  }
}

function readRevisionInput(input: Record<string, unknown>): { scriptId: string; revision: number; actor?: string; note?: string } {
  const scriptId = String(input.scriptId ?? input.script_id ?? "");
  const revision = Number(input.revision);
  if (!scriptId || !Number.isFinite(revision)) throw new Error("scriptId and revision are required");
  return {
    scriptId,
    revision,
    actor: typeof input.actor === "string" ? input.actor : "operator",
    note: typeof input.note === "string" ? input.note : undefined,
  };
}
