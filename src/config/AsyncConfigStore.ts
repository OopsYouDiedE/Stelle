import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const SECRET_KEY_PATTERN = /(?:secret|token|api[_-]?key|password|cookie)/i;

function sanitizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfig(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeConfig(child);
    }
    return output;
  }
  return value;
}

export class AsyncConfigStore<T extends object> {
  private pending: Promise<void> = Promise.resolve();
  private latest: T | null = null;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    private readonly allowedRoot: string = process.cwd()
  ) {}

  get isDirty(): boolean {
    return this.dirty;
  }

  save(config: T): Promise<void> {
    this.latest = config;
    this.dirty = true;
    this.pending = this.pending.then(() => this.flushLatest());
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private async flushLatest(): Promise<void> {
    if (!this.latest) return;
    const target = resolve(this.filePath);
    const root = resolve(this.allowedRoot);
    const rel = relative(root, target);
    if (rel.startsWith("..") || rel === ".." || resolve(root, rel) !== target) {
      throw new Error(`Config path is outside allowed root: ${target}`);
    }

    const payload = JSON.stringify(sanitizeConfig(this.latest), null, 2);
    const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, target);
    this.dirty = false;
  }
}

export { sanitizeConfig };
