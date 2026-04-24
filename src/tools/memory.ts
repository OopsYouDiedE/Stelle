import path from "node:path";
import type { ToolDefinition } from "../types.js";
import { MarkdownMemoryStore, parseMemoryCollection } from "../memory/MarkdownMemoryStore.js";
import { MEMORY_COLLECTIONS } from "../memory/types.js";
import { fail, ok, sideEffects } from "./shared.js";

function createStore(): MarkdownMemoryStore {
  return new MarkdownMemoryStore(path.resolve(process.cwd(), "memory"));
}

function validateCollection(input: Record<string, unknown>) {
  if (input.collection === undefined) return;
  if (!parseMemoryCollection(input.collection)) {
    return fail("invalid_collection", `Collection must be one of: ${MEMORY_COLLECTIONS.join(", ")}.`);
  }
}

export function createMemoryTools(): ToolDefinition[] {
  return [
    {
      identity: { namespace: "memory", name: "read_record", authorityClass: "cursor", version: "0.1.0" },
      description: {
        summary: "Read a markdown memory record by collection and id.",
        whenToUse: "Use when a cursor needs a stable long-term memory entry.",
        whenNotToUse: "Do not use for broad fuzzy search across many records.",
      },
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          id: { type: "string" },
        },
        required: ["collection", "id"],
      },
      sideEffects: sideEffects(),
      authority: { level: "read", scopes: ["memory.records"], requiresUserConfirmation: false },
      validate(input) {
        return validateCollection(input);
      },
      async execute(input) {
        const collection = parseMemoryCollection(input.collection);
        if (!collection) return fail("invalid_collection", "Invalid memory collection.");
        const id = String(input.id ?? "").trim();
        if (!id) return fail("invalid_id", "Memory id must not be empty.");

        const store = createStore();
        const record = await store.read(collection, id);
        if (!record) {
          return fail("memory_not_found", `Memory record not found: ${collection}/${id}`);
        }

        return ok(`Read memory record ${collection}/${id}.`, {
          record,
          relativePath: path.relative(process.cwd(), record.path),
        });
      },
    },
    {
      identity: { namespace: "memory", name: "search_records", authorityClass: "cursor", version: "0.1.0" },
      description: {
        summary: "Search markdown memory records by collection, id, tag, or keyword.",
        whenToUse: "Use when a cursor needs to retrieve related long-term memory context.",
        whenNotToUse: "Do not use as a replacement for writing a new memory record.",
      },
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          id: { type: "string" },
          tag: { type: "string" },
          query: { type: "string" },
          limit: { type: "integer" },
        },
      },
      sideEffects: sideEffects(),
      authority: { level: "read", scopes: ["memory.records"], requiresUserConfirmation: false },
      validate(input) {
        return validateCollection(input);
      },
      async execute(input) {
        const parsedCollection = input.collection === undefined ? null : parseMemoryCollection(input.collection);
        if (input.collection !== undefined && !parsedCollection) {
          return fail("invalid_collection", "Invalid memory collection.");
        }

        const store = createStore();
        const results = await store.search({
          collection: parsedCollection ?? undefined,
          id: typeof input.id === "string" ? input.id.trim() || undefined : undefined,
          tag: typeof input.tag === "string" ? input.tag.trim() || undefined : undefined,
          query: typeof input.query === "string" ? input.query.trim() || undefined : undefined,
          limit: typeof input.limit === "number" ? input.limit : undefined,
        });

        return ok(`Found ${results.length} memory record(s).`, {
          results: results.map((result) => ({
            ...result,
            relativePath: path.relative(process.cwd(), result.path),
          })),
        });
      },
    },
    {
      identity: { namespace: "memory", name: "write_record", authorityClass: "stelle", version: "0.1.0" },
      description: {
        summary: "Write or update a markdown memory record.",
        whenToUse: "Use when Stelle decides a stable memory entry should be persisted.",
        whenNotToUse: "Do not use for transient scratch thoughts or unreviewed raw dumps.",
      },
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          id: { type: "string" },
          type: { type: "string" },
          source: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          related_ids: { type: "array", items: { type: "string" } },
          created_at: { type: "string" },
          updated_at: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["collection", "id", "type", "source", "content"],
      },
      sideEffects: sideEffects({ writesFileSystem: true }),
      authority: { level: "local_write", scopes: ["memory.records"], requiresUserConfirmation: false },
      validate(input) {
        return validateCollection(input);
      },
      async execute(input) {
        const collection = parseMemoryCollection(input.collection);
        if (!collection) return fail("invalid_collection", "Invalid memory collection.");

        const store = createStore();
        const record = await store.write({
          collection,
          id: String(input.id ?? ""),
          type: String(input.type ?? ""),
          source: String(input.source ?? ""),
          title: typeof input.title === "string" ? input.title : undefined,
          content: String(input.content ?? ""),
          tags: Array.isArray(input.tags) ? input.tags.map((item) => String(item)) : [],
          relatedIds: Array.isArray(input.related_ids) ? input.related_ids.map((item) => String(item)) : undefined,
          createdAt: typeof input.created_at === "string" ? input.created_at : undefined,
          updatedAt: typeof input.updated_at === "string" ? input.updated_at : undefined,
          metadata:
            input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
              ? (input.metadata as Record<string, unknown>)
              : undefined,
        });

        return {
          ...ok(`Wrote memory record ${collection}/${record.id}.`, {
            record,
            relativePath: path.relative(process.cwd(), record.path),
          }),
          sideEffects: [
            {
              type: "file_write",
              summary: `Updated memory markdown ${collection}/${record.id}.`,
              visible: false,
              timestamp: Date.now(),
            },
          ],
        };
      },
    },
  ];
}
