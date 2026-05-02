import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(workspaceRoot, "src");

describe("architecture import boundaries", () => {
  const imports = collectImports(srcRoot);

  it("prevents Core from importing concrete capabilities, windows, or debug", () => {
    const violations = imports.filter(
      (entry) =>
        isInside(entry.from, "src/core") &&
        (isInside(entry.to, "src/capabilities") ||
          isInside(entry.to, "src/windows") ||
          isInside(entry.to, "src/debug")),
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("prevents Capability packages from importing windows or the runtime host", () => {
    const violations = imports.filter(
      (entry) =>
        isInside(entry.from, "src/capabilities") &&
        (isInside(entry.to, "src/windows") || normalize(entry.to).endsWith("/src/runtime/host.ts")),
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("prevents Debug server code from importing package internals", () => {
    const violations = imports.filter(
      (entry) =>
        isInside(entry.from, "src/debug/server") &&
        (isInside(entry.to, "src/capabilities") || isInside(entry.to, "src/windows")),
    );

    expect(formatViolations(violations)).toEqual([]);
  });
});

interface ImportEdge {
  from: string;
  to: string;
  specifier: string;
}

function collectImports(root: string): ImportEdge[] {
  return listTsFiles(root).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    return [...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((specifier): specifier is string => Boolean(specifier?.startsWith(".")))
      .map((specifier) => ({ from: file, to: resolveImport(file, specifier), specifier }));
  });
}

function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

function resolveImport(from: string, specifier: string): string {
  const resolved = path.resolve(path.dirname(from), specifier);
  if (resolved.endsWith(".js")) return `${resolved.slice(0, -3)}.ts`;
  return resolved;
}

function isInside(file: string, relativeDir: string): boolean {
  const target = normalize(path.join(workspaceRoot, relativeDir));
  const normalizedFile = normalize(file);
  return normalizedFile === target || normalizedFile.startsWith(`${target}/`);
}

function normalize(file: string): string {
  return file.replace(/\\/g, "/");
}

function formatViolations(violations: ImportEdge[]): string[] {
  return violations.map((entry) => {
    const from = path.relative(workspaceRoot, entry.from).replace(/\\/g, "/");
    const to = path.relative(workspaceRoot, entry.to).replace(/\\/g, "/");
    return `${from} imports ${entry.specifier} -> ${to}`;
  });
}
