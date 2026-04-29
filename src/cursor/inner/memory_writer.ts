import type { ResearchAgendaUpdate, SelfModelUpdate, IdentityProposal } from "./types.js";
import type { MemoryStore } from "../../utils/memory.js";

export interface InnerMemoryWriter {
  writeResearchLog(update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void>;
  writeSelfState(key: string, value: string): Promise<void>;
  proposeIdentityChange(proposal: IdentityProposal): Promise<void>;
}

export class DefaultMemoryWriter implements InnerMemoryWriter {
  constructor(private readonly memory: MemoryStore) {}

  async writeResearchLog(update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void> {
    if (isSelfModelUpdate(update)) {
      await this.memory.appendResearchLog({
        focus: update.snapshot.currentFocus || "Self model update",
        process: update.changes.length ? update.changes : ["Self model refreshed."],
        conclusion: `Self model updated: mood=${update.snapshot.mood}`,
      });
      return;
    }

    const topicLines = [
      ...update.addedTopics.map(topic => `Added ${topic.id}: ${topic.title}`),
      ...update.updatedTopics.map(topic => `Updated ${topic.id}: ${topic.title}`),
      ...update.closedTopics.map(topic => `Closed ${topic.id}: ${topic.title}`),
    ];
    await this.memory.appendResearchLog({
      focus: "Research agenda update",
      process: topicLines.length ? topicLines : ["Research agenda checked; no topic changes."],
      conclusion: `Agenda changed: +${update.addedTopics.length} ~${update.updatedTopics.length} -${update.closedTopics.length}`,
    });
  }

  async writeSelfState(key: string, value: string): Promise<void> {
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
}

function isSelfModelUpdate(update: ResearchAgendaUpdate | SelfModelUpdate): update is SelfModelUpdate {
  return "snapshot" in update && "changes" in update;
}
