import fs from "node:fs";
import path from "node:path";

const promptBodyCache = new Map<string, string>();

export function renderPromptTemplate(templateId: string, variables: Record<string, unknown>): string {
  const body = loadPromptBody(templateId);
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => stringifyPromptVariable(variables[key]));
}

function loadPromptBody(templateId: string): string {
  const cached = promptBodyCache.get(templateId);
  if (cached) return cached;

  const filePath = path.resolve(process.cwd(), "prompts", `${templateId}.md`);
  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/^[#]{1,6}\s*Body\s*$([\s\S]*)/im);
  if (!match) {
    throw new Error(`Prompt template is missing a Body section: ${templateId}`);
  }

  const body = match[1]!.replace(/^\s*\r?\n/, "").trimEnd();
  promptBodyCache.set(templateId, body);
  return body;
}

function stringifyPromptVariable(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyPromptVariable(item)).join("\n");
  return JSON.stringify(value, null, 2);
}
