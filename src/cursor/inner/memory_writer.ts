import type { ResearchAgendaUpdate, SelfModelUpdate, IdentityProposal } from "./types.js";

export interface InnerMemoryWriter {
  writeResearchLog(update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void>;
  writeSelfState(key: string, value: string): Promise<void>;
  proposeIdentityChange(proposal: IdentityProposal): Promise<void>;
}

export class DefaultMemoryWriter implements InnerMemoryWriter {
  async writeResearchLog(_update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void> {}
  async writeSelfState(_key: string, _value: string): Promise<void> {}
  async proposeIdentityChange(_proposal: IdentityProposal): Promise<void> {}
}
