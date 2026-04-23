import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type {
  MinecraftBlockSummary,
  MinecraftEnvironmentImage,
  MinecraftObservation,
} from "./types.js";

let captureBrowser: Browser | null = null;
let capturePage: Page | null = null;

export interface MinecraftViewerSession {
  port: number;
  url: string;
}

export async function startMinecraftViewer(
  bot: any,
  options?: {
    port?: number;
    firstPerson?: boolean;
    viewDistance?: number;
  }
): Promise<MinecraftViewerSession> {
  const port = options?.port ?? 3007;
  const viewerModule = await import("prismarine-viewer");
  const viewerApi = viewerModule.default ?? viewerModule;
  viewerApi.mineflayer(bot, {
    port,
    firstPerson: options?.firstPerson ?? true,
    viewDistance: options?.viewDistance ?? 6,
  });
  return {
    port,
    url: `http://127.0.0.1:${port}`,
  };
}

export function closeMinecraftViewer(bot: any): void {
  try {
    bot?.viewer?.close?.();
  } catch {
    // Viewer shutdown should never block disconnecting the Minecraft bot.
  }
}

export async function captureMinecraftViewerImage(
  viewer: MinecraftViewerSession,
  observation: MinecraftObservation,
  cwd: string
): Promise<MinecraftEnvironmentImage | null> {
  const dir = path.join(cwd, "artifacts", "minecraft");
  await mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, "minecraft-current.png");

  if (!captureBrowser) {
    captureBrowser = await chromium.launch({
      headless: true,
    });
  }
  if (!capturePage || capturePage.isClosed()) {
    capturePage = await captureBrowser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
  }

  if (!capturePage.url().startsWith(viewer.url)) {
    await capturePage.goto(viewer.url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
  }

  await capturePage.waitForSelector("canvas", { timeout: 15000 });
  await capturePage.waitForTimeout(900);
  await capturePage.screenshot({
    path: outputPath,
    type: "png",
    fullPage: false,
  });

  return {
    path: outputPath,
    mimeType: "image/png",
    description: `Prismarine Viewer first-person frame for ${observation.username ?? "Minecraft bot"}.`,
    timestamp: Date.now(),
  };
}

function blockColor(name: string): string {
  if (name.includes("log")) return "#8b5a2b";
  if (name.includes("leaves")) return "#3f8f46";
  if (name.includes("grass")) return "#5aa64f";
  if (name.includes("dirt")) return "#8a5b35";
  if (name.includes("stone")) return "#848484";
  if (name.includes("water")) return "#4a90d9";
  if (name.includes("planks")) return "#c89b52";
  if (name.includes("crafting_table")) return "#9b6a38";
  return "#b8b8b8";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBlock(block: MinecraftBlockSummary, centerX: number, centerZ: number): string {
  const scale = 18;
  const x = 320 + (block.position.x - centerX) * scale;
  const y = 260 + (block.position.z - centerZ) * scale;
  return [
    `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="${blockColor(block.name)}" opacity="0.88" />`,
    `<title>${escapeXml(block.name)} ${block.position.x},${block.position.y},${block.position.z}</title>`,
  ].join("");
}

export async function renderMinecraftFallbackImage(
  observation: MinecraftObservation,
  cwd: string
): Promise<MinecraftEnvironmentImage | null> {
  const dir = path.join(cwd, "artifacts", "minecraft");
  await mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, "minecraft-current.svg");
  const pos = observation.position;
  const centerX = Math.floor(pos?.x ?? 0);
  const centerZ = Math.floor(pos?.z ?? 0);
  const inventory = observation.inventory
    .map((item) => `${item.name} x${item.count}`)
    .join(", ") || "empty";
  const entities = observation.nearbyEntities
    .map((entity) => `${entity.name}:${entity.type}`)
    .join(", ") || "none";

  const blocks = observation.nearbyBlocks
    .slice(0, 96)
    .map((block) => renderBlock(block, centerX, centerZ))
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101820" />
      <stop offset="1" stop-color="#243447" />
    </linearGradient>
  </defs>
  <rect width="900" height="620" fill="url(#bg)" />
  <text x="28" y="42" fill="#f4f7fb" font-family="Consolas, monospace" font-size="22" font-weight="700">Minecraft Environment Frame</text>
  <text x="28" y="76" fill="#b9c7d4" font-family="Consolas, monospace" font-size="14">user=${escapeXml(observation.username ?? "unknown")} mode=${escapeXml(observation.gameMode ?? "unknown")} dim=${escapeXml(observation.dimension ?? "unknown")}</text>
  <text x="28" y="100" fill="#b9c7d4" font-family="Consolas, monospace" font-size="14">pos=${pos ? `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}` : "unknown"} health=${observation.health ?? "?"} food=${observation.food ?? "?"}</text>
  <rect x="28" y="126" width="584" height="388" rx="18" fill="#0b1218" stroke="#718096" stroke-opacity="0.35" />
  <g>
    ${blocks}
    <circle cx="320" cy="260" r="12" fill="#ffdb5c" stroke="#1f2937" stroke-width="3" />
    <text x="338" y="265" fill="#ffefad" font-family="Consolas, monospace" font-size="13">BOT</text>
  </g>
  <text x="46" y="494" fill="#9fb2c4" font-family="Consolas, monospace" font-size="12">Top-down schematic. Blocks are nearby known blocks, not a rendered client camera.</text>
  <rect x="636" y="126" width="236" height="388" rx="18" fill="#0b1218" stroke="#718096" stroke-opacity="0.35" />
  <text x="656" y="158" fill="#f4f7fb" font-family="Consolas, monospace" font-size="16" font-weight="700">Inventory</text>
  <foreignObject x="656" y="172" width="196" height="108">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 13px Consolas, monospace; color: #b9c7d4; line-height: 1.45; word-break: break-word;">${escapeXml(inventory)}</div>
  </foreignObject>
  <text x="656" y="316" fill="#f4f7fb" font-family="Consolas, monospace" font-size="16" font-weight="700">Entities</text>
  <foreignObject x="656" y="330" width="196" height="92">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 13px Consolas, monospace; color: #b9c7d4; line-height: 1.45; word-break: break-word;">${escapeXml(entities)}</div>
  </foreignObject>
  <text x="28" y="562" fill="#b9c7d4" font-family="Consolas, monospace" font-size="13">generated=${new Date(observation.timestamp).toISOString()}</text>
</svg>`;

  await writeFile(outputPath, svg, "utf8");
  return {
    path: outputPath,
    mimeType: "image/svg+xml",
    description: "Top-down Minecraft environment schematic generated from Cursor observation.",
    timestamp: Date.now(),
  };
}

export async function closeMinecraftViewerCapture(): Promise<void> {
  try {
    await capturePage?.close();
  } catch {
    // ignore
  } finally {
    capturePage = null;
  }
  try {
    await captureBrowser?.close();
  } catch {
    // ignore
  } finally {
    captureBrowser = null;
  }
}
