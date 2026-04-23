import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createTtsTools, ToolRegistry } from "../index.js";

const TEST_DIR = path.resolve("test");
const AUDIO_DIR = path.join(TEST_DIR, "kokoro-tool-audio");
const RESULT_PATH = path.join(TEST_DIR, "kokoro-tool-test.json");

async function main(): Promise<void> {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const requests: unknown[] = [];
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push(JSON.parse(body || "{}"));
    response.writeHead(200, { "content-type": "audio/wav" });
    response.end(Buffer.from("RIFFkokoro-smoke-wave-data"));
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to allocate local Kokoro smoke server port.");

  try {
    process.env.KOKORO_TTS_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.KOKORO_TTS_ENDPOINT_PATH = "/v1/audio/speech";
    process.env.KOKORO_TTS_MODEL = "kokoro";
    process.env.KOKORO_TTS_VOICE = "af_heart";
    process.env.KOKORO_TTS_RESPONSE_FORMAT = "wav";

    const registry = new ToolRegistry();
    for (const tool of createTtsTools()) registry.register(tool);

    const result = await registry.execute("tts.kokoro_stream_speech", {
      chunks: ["Kokoro stream chunk one. ", "Kokoro stream chunk two."],
      output_dir: AUDIO_DIR,
      file_prefix: "kokoro-smoke",
      voice_name: "af_heart",
    }, {
      caller: "stelle",
      authority: { caller: "stelle", allowedAuthorityClasses: ["stelle"] },
      audit: { record() {} },
    });

    await fs.writeFile(RESULT_PATH, JSON.stringify({
      ok: result.ok,
      summary: result.summary,
      data: result.data,
      requests,
    }, null, 2), "utf8");

    if (!result.ok) throw new Error(result.summary);
    console.log(`Kokoro tool smoke output: ${RESULT_PATH}`);
  } finally {
    await close(server);
  }
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
