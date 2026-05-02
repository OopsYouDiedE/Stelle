import fs from "node:fs";
import YAML from "yaml";
import { asRecord } from "../../shared/json.js";

export function loadYamlConfig(filePath = "config.yaml"): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  return asRecord(YAML.parse(fs.readFileSync(filePath, "utf8")));
}

export function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function stringList(value: unknown, fallback: string[]): string[] {
  const list = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return list.length ? list : fallback;
}

export function mergeRecords(...records: Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...records);
}
