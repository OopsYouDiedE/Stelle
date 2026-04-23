import "dotenv/config";
import { LiveRendererServer } from "./live/renderer/LiveRendererServer.js";

const port = process.env.LIVE_RENDERER_PORT ? Number(process.env.LIVE_RENDERER_PORT) : 8787;
const host = process.env.LIVE_RENDERER_HOST ?? "127.0.0.1";
const server = new LiveRendererServer({ host, port });
const url = await server.start();

console.log(`[Stelle] Live renderer ready: ${url}/live`);
console.log("[Stelle] POST renderer commands to /command.");

process.on("SIGINT", () => {
  void server.stop().finally(() => process.exit(0));
});
