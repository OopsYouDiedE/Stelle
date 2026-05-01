import { z } from "zod";
import { MEMORY_LAYERS, type MemoryStore } from "../../memory/memory.js";
import { sanitizeExternalText } from "../../utils/text.js";
import { ok, sideEffects } from "../types.js";
import type { ToolDefinition } from "../types.js";
import type { ToolRegistryDeps } from "./deps.js";

export function createMemoryTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const memoryRequired = (): MemoryStore => {
    if (!deps.memory) throw new Error("Memory store is not configured.");
    return deps.memory;
  };
  const MemoryScopeSchema = z.object({
    kind: z.enum(["discord_channel", "discord_global", "live", "long_term"]),
    channelId: z.string().optional(),
    guildId: z.string().nullable().optional(),
  });
  const MemoryLayerSchema = z.enum(MEMORY_LAYERS);
  const MemoryProposalStatusSchema = z.enum(["pending", "approved", "rejected"]);

  return [
    {
      name: "memory.write_recent",
      title: "Write Recent Memory",
      description: "Append a recent memory entry.",
      authority: "safe_write",
      inputSchema: z.object({
        scope: MemoryScopeSchema,
        id: z.string().optional(),
        source: z.enum(["discord", "live", "core", "debug"]),
        type: z.string(),
        text: z.string().min(1),
        metadata: z.record(z.any()).optional(),
      }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        const id = input.id || `mem-${Date.now()}`;
        await memoryRequired().writeRecent(input.scope as any, {
          id,
          timestamp: Date.now(),
          source: input.source,
          type: input.type,
          text: sanitizeExternalText(input.text),
          metadata: input.metadata,
        });
        return ok(`Wrote recent memory ${id}.`, { id });
      },
    },
    {
      name: "memory.propose_write",
      title: "Propose Memory Write",
      description: "Suggest a fact to be remembered long-term.",
      authority: "readonly",
      inputSchema: z.object({
        content: z.string().min(1),
        reason: z.string(),
        layer: MemoryLayerSchema.optional().default("user_facts"),
      }),
      sideEffects: sideEffects({ affectsUserState: true }),
      async execute(input, context) {
        const id = await memoryRequired().proposeMemory({
          authorId: context.cursorId || "unknown",
          source: context.caller,
          content: input.content,
          reason: input.reason,
          layer: input.layer as any,
        });
        return ok(`Memory proposal submitted: ${id}.`, { proposal_id: id });
      },
    },
    {
      name: "memory.list_proposals",
      title: "List Memory Proposals",
      description: "List pending, approved, or rejected memory proposals.",
      authority: "readonly",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional().default(50),
        status: MemoryProposalStatusSchema.optional().default("pending"),
      }),
      sideEffects: sideEffects(),
      async execute(input) {
        const proposals = await memoryRequired().listMemoryProposals(input.limit, input.status);
        return ok(`Found ${proposals.length} ${input.status} memory proposal(s).`, { proposals });
      },
    },
    {
      name: "memory.approve_proposal",
      title: "Approve Memory Proposal",
      description: "Promote a memory proposal into long-term memory.",
      authority: "safe_write",
      inputSchema: z.object({
        proposal_id: z.string().min(1),
        target_key: z.string().min(1).optional(),
        reason: z.string().optional(),
      }),
      sideEffects: sideEffects({ writesFileSystem: true, affectsUserState: true }),
      async execute(input, context) {
        const result = await memoryRequired().approveMemoryProposal(input.proposal_id, {
          decidedBy: context.cursorId || context.caller,
          reason: input.reason,
          targetKey: input.target_key,
        });
        return ok(`Approved memory proposal ${input.proposal_id}.`, result);
      },
    },
    {
      name: "memory.reject_proposal",
      title: "Reject Memory Proposal",
      description: "Reject a pending memory proposal.",
      authority: "safe_write",
      inputSchema: z.object({ proposal_id: z.string().min(1), reason: z.string().optional() }),
      sideEffects: sideEffects({ writesFileSystem: true, affectsUserState: true }),
      async execute(input, context) {
        const result = await memoryRequired().rejectMemoryProposal(input.proposal_id, {
          decidedBy: context.cursorId || context.caller,
          reason: input.reason,
        });
        return ok(`Rejected memory proposal ${input.proposal_id}.`, result);
      },
    },
    {
      name: "memory.read_recent",
      title: "Read Recent Memory",
      description: "Read recent entries.",
      authority: "readonly",
      inputSchema: z.object({
        scope: MemoryScopeSchema,
        limit: z.number().int().min(1).max(100).optional().default(20),
      }),
      sideEffects: sideEffects(),
      async execute(input) {
        const entries = await memoryRequired().readRecent(input.scope as any, input.limit);
        return ok(`Read ${entries.length} entries.`, { entries });
      },
    },
    {
      name: "memory.search",
      title: "Search Memory",
      description: "Search scoped memory.",
      authority: "readonly",
      inputSchema: z.object({
        scope: MemoryScopeSchema,
        text: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        limit: z.number().int().optional().default(3),
        layers: z.array(MemoryLayerSchema).optional(),
      }),
      sideEffects: sideEffects(),
      async execute(input) {
        const results = await memoryRequired().searchHistory(input.scope as any, {
          text: input.text,
          keywords: input.keywords,
          limit: input.limit,
          layers: input.layers as any,
        });
        return ok(`Found ${results.length} result(s).`, { results });
      },
    },
    {
      name: "memory.read_long_term",
      title: "Read Long-Term Memory",
      description: "Read a long-term memory key.",
      authority: "readonly",
      inputSchema: z.object({ key: z.string().min(1), layer: MemoryLayerSchema.optional().default("self_state") }),
      sideEffects: sideEffects(),
      async execute(input) {
        const value = await memoryRequired().readLongTerm(input.key, input.layer as any);
        return ok(value ? `Read ${input.key}.` : `Key ${input.key} empty.`, { value });
      },
    },
    {
      name: "memory.write_long_term",
      title: "Write Long-Term Memory",
      description: "Write a long-term memory key. System only.",
      authority: "safe_write",
      inputSchema: z.object({
        key: z.string().min(1),
        value: z.string().min(1),
        layer: MemoryLayerSchema.optional().default("self_state"),
      }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        await memoryRequired().writeLongTerm(input.key, input.value, input.layer as any);
        return ok(`Wrote ${input.key} to ${input.layer}.`);
      },
    },
    {
      name: "memory.append_long_term",
      title: "Append Long-Term Memory",
      description: "Append to a long-term memory key without replacing existing content.",
      authority: "safe_write",
      inputSchema: z.object({
        key: z.string().min(1),
        value: z.string().min(1),
        layer: MemoryLayerSchema.optional().default("observations"),
      }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        await memoryRequired().appendLongTerm(input.key, input.value, input.layer as any);
        return ok(`Appended ${input.key} to ${input.layer}.`);
      },
    },
    {
      name: "memory.append_research_log",
      title: "Append Research Log",
      description: "Append a reflection log.",
      authority: "safe_write",
      inputSchema: z.object({
        focus: z.string().min(1),
        process: z.array(z.string()).min(1),
        conclusion: z.string().min(1),
      }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        const id = await memoryRequired().appendResearchLog({
          focus: input.focus,
          process: input.process,
          conclusion: input.conclusion,
        });
        return ok(`Appended research log ${id}.`, { id });
      },
    },
  ];
}
