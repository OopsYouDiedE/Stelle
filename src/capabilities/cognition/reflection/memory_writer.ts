import type { ResearchAgendaUpdate, SelfModelUpdate, IdentityProposal } from "./types.js";
import type { MemoryStore } from "../../memory/store/memory_store.js";
import type { ToolRegistry } from "../../../tool.js";

// === Region: Interfaces ===

export interface InnerMemoryWriter {
  appendResearchLog(log: { focus: string; process: string[]; conclusion: string }): Promise<void>;
  writeResearchLog(update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void>;
  writeSelfState(key: string, value: string): Promise<void>;
  proposeIdentityChange(proposal: IdentityProposal): Promise<void>;
}

// === Region: Default Implementation ===

export class DefaultMemoryWriter implements InnerMemoryWriter {
  constructor(
    private readonly memory: MemoryStore,
    private readonly tools?: ToolRegistry,
    private readonly cwd = process.cwd(),
  ) {}

  async writeResearchLog(update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void> {
    if (isSelfModelUpdate(update)) {
      await this.appendResearchLog({
        focus: update.snapshot.currentFocus || "Self model update",
        process: update.changes.length ? update.changes : ["Self model refreshed."],
        conclusion: `Self model updated: mood=${update.snapshot.mood}`,
      });
      return;
    }

    const topicLines: string[] = [];
    for (const topic of update.addedTopics) topicLines.push(`Added ${topic.id}: ${topic.title}`);
    for (const topic of update.updatedTopics) topicLines.push(`Updated ${topic.id}: ${topic.title}`);
    for (const topic of update.closedTopics) topicLines.push(`Closed ${topic.id}: ${topic.title}`);

    await this.appendResearchLog({
      focus: "Research agenda update",
      process: topicLines.length ? topicLines : ["Research agenda checked; no topic changes."],
      conclusion: `Agenda changed: +${update.addedTopics.length} ~${update.updatedTopics.length} -${update.closedTopics.length}`,
    });
  }

  async writeSelfState(key: string, value: string): Promise<void> {
    if (this.tools) {
      await this.tools.execute(
        "memory.write_long_term",
        { key, value, layer: "self_state" },
        { caller: "core", cwd: this.cwd, allowedAuthority: ["safe_write"], allowedTools: ["memory.write_long_term"] },
      );
      return;
    }
    await this.memory.writeLongTerm(key, value, "self_state");
  }

  async proposeIdentityChange(proposal: IdentityProposal): Promise<void> {
    await this.memory.proposeMemory({
      authorId: "inner",
      source: "inner",
      content: proposal.change,
      reason: `${proposal.rationale} (confidence=${proposal.confidence})`,
      layer: "core_identity",
    });
  }

  async appendResearchLog(input: { focus: string; process: string[]; conclusion: string }): Promise<void> {
    if (this.tools) {
      await this.tools.execute("memory.append_research_log", input, {
        caller: "core",
        cwd: this.cwd,
        allowedAuthority: ["safe_write"],
        allowedTools: ["memory.append_research_log"],
      });
      return;
    }
    await this.memory.appendResearchLog(input);
  }
}

// === Region: Helpers ===

function isSelfModelUpdate(update: ResearchAgendaUpdate | SelfModelUpdate): update is SelfModelUpdate {
  return "snapshot" in update && "changes" in update;
}
