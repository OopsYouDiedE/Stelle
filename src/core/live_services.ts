import { LiveEngagementService } from "../live/engagement_service.js";
import { LiveEventJournal } from "../live/ops/event_journal.js";
import { LiveHealthService } from "../live/ops/health_service.js";
import { LiveRelationshipService } from "../live/ops/relationship_service.js";
import { LivePlatformManager } from "../live/platforms/manager.js";
import { LiveProgramService } from "../live/program/service.js";
import { PromptLabService } from "../live/program/prompt_lab.js";
import type { RuntimeServices } from "./container.js";
import type { LiveRendererServer } from "../utils/renderer.js";

export class LiveRuntimeServices {
  private liveEngagement?: LiveEngagementService;
  private liveJournal?: LiveEventJournal;
  private liveHealth?: LiveHealthService;
  private liveRelationship?: LiveRelationshipService;
  private liveProgram?: LiveProgramService;
  private livePlatforms?: LivePlatformManager;

  constructor(
    private readonly services: RuntimeServices,
    private readonly renderer: LiveRendererServer | undefined,
  ) {}

  get health(): LiveHealthService | undefined { return this.liveHealth; }
  get journal(): LiveEventJournal | undefined { return this.liveJournal; }

  async start(): Promise<void> {
    this.liveEngagement = new LiveEngagementService({
      config: this.services.config,
      eventBus: this.services.eventBus,
      stageOutput: this.services.stageOutput,
      now: () => Date.now(),
    });
    this.liveEngagement.start();

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
    this.liveProgram = new LiveProgramService({
      eventBus: this.services.eventBus,
      live: this.services.live,
      stageOutput: this.services.stageOutput,
      promptLab: new PromptLabService(this.services.llm),
    });
    this.liveProgram.start();

    const enabled = this.livePlatforms.status()
      .filter(status => status.enabled)
      .map(status => `${status.platform}:${status.connected ? "connected" : status.lastError ?? "idle"}`);
    if (enabled.length) console.log(`[Stelle] Live platform bridges: ${enabled.join(", ")}`);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([
      this.liveHealth?.stop(),
      this.liveProgram?.stop(),
      this.liveJournal?.stop(),
      this.livePlatforms?.stop(),
    ]);
    this.liveEngagement?.stop();
    this.liveRelationship?.stop();
  }
}
