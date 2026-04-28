import { brotliDecompressSync, inflateSync } from "node:zlib";
import { EventEmitter } from "node:events";
import { safeErrorMessage } from "./json.js";

const ROOM_INIT_URL = "https://api.live.bilibili.com/room/v1/Room/room_init";
const DANMU_INFO_URL = "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo";

const HEADER_LENGTH = 16;
const PROTOCOL_JSON = 0;
const PROTOCOL_HEARTBEAT = 1;
const PROTOCOL_ZLIB = 2;
const PROTOCOL_BROTLI = 3;
const OP_HEARTBEAT = 2;
const OP_HEARTBEAT_REPLY = 3;
const OP_COMMAND = 5;
const OP_AUTH = 7;
const OP_AUTH_REPLY = 8;

export interface BilibiliRoomInfo {
  requestedRoomId: number;
  roomId: number;
  shortId?: number;
}

export interface BilibiliDanmuHost {
  host: string;
  port?: number;
  wss_port?: number;
  ws_port?: number;
}

export interface BilibiliDanmuInfo {
  token: string;
  hostList: BilibiliDanmuHost[];
}

export interface BilibiliPacket {
  protocolVersion: number;
  operation: number;
  sequence: number;
  body: Buffer;
}

export interface BilibiliCommand {
  cmd?: string;
  [key: string]: unknown;
}

export interface BilibiliDanmakuClientOptions {
  roomId: number;
  uid?: number;
  fetchImpl?: typeof fetch;
  heartbeatIntervalMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

export interface BilibiliClientStatus {
  requestedRoomId: number;
  roomId?: number;
  connected: boolean;
  authenticated: boolean;
  url?: string;
  popularity?: number;
  reconnectAttempts: number;
  lastError?: string;
}

type WebSocketLike = WebSocket & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};

export class BilibiliDanmakuClient extends EventEmitter {
  private socket?: WebSocketLike;
  private heartbeatTimer?: NodeJS.Timeout;
  private closedByUser = false;
  private statusState: BilibiliClientStatus;
  private token = "";

  constructor(private readonly options: BilibiliDanmakuClientOptions) {
    super();
    this.statusState = {
      requestedRoomId: options.roomId,
      connected: false,
      authenticated: false,
      reconnectAttempts: 0,
    };
  }

  get status(): BilibiliClientStatus {
    return { ...this.statusState };
  }

  async start(): Promise<BilibiliClientStatus> {
    this.closedByUser = false;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const room = await resolveBilibiliRoom(this.options.roomId, fetchImpl);
    const danmuInfo = await fetchBilibiliDanmuInfo(room.roomId, fetchImpl);
    this.token = danmuInfo.token;
    const url = selectBilibiliWsUrl(danmuInfo.hostList);
    this.statusState = {
      ...this.statusState,
      requestedRoomId: room.requestedRoomId,
      roomId: room.roomId,
      url,
      lastError: undefined,
    };
    await this.connect(url);
    return this.status;
  }

  stop(): void {
    this.closedByUser = true;
    this.clearHeartbeat();
    this.socket?.close();
    this.socket = undefined;
    this.statusState = { ...this.statusState, connected: false, authenticated: false };
  }

  private async connect(url: string): Promise<void> {
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      throw new Error("Global WebSocket is unavailable. Use Node.js >= 20.");
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocketCtor(url) as WebSocketLike;
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      socket.onopen = () => {
        this.statusState = { ...this.statusState, connected: true, lastError: undefined };
        this.emit("open", this.status);
        this.sendAuth();
        this.startHeartbeat();
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.onmessage = (event) => {
        void this.handleSocketMessage(event.data).catch((error) => {
          this.statusState = { ...this.statusState, lastError: safeErrorMessage(error) };
          this.emit("error", error);
        });
      };

      socket.onerror = () => {
        const error = new Error("Bilibili danmaku WebSocket error.");
        this.statusState = { ...this.statusState, lastError: error.message };
        this.emit("error", error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      socket.onclose = () => {
        this.clearHeartbeat();
        this.statusState = { ...this.statusState, connected: false, authenticated: false };
        this.emit("close", this.status);
        if (!this.closedByUser && this.options.reconnect !== false) {
          void this.reconnect();
        }
      };
    });
  }

  private async reconnect(): Promise<void> {
    const maxAttempts = this.options.maxReconnectAttempts ?? 20;
    if (this.statusState.reconnectAttempts >= maxAttempts) return;
    const attempt = this.statusState.reconnectAttempts + 1;
    this.statusState = { ...this.statusState, reconnectAttempts: attempt };
    const delayMs = Math.min(30_000, 1000 * attempt);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    if (this.closedByUser || !this.statusState.url) return;
    try {
      await this.connect(this.statusState.url);
    } catch (error) {
      this.statusState = { ...this.statusState, lastError: safeErrorMessage(error) };
      this.emit("error", error);
      await this.reconnect();
    }
  }

  private sendAuth(): void {
    const body = JSON.stringify({
      uid: this.options.uid ?? 0,
      roomid: this.statusState.roomId,
      protover: PROTOCOL_BROTLI,
      platform: "web",
      type: 2,
      key: this.token,
    });
    this.socket?.send(encodeBilibiliPacket(OP_AUTH, body, PROTOCOL_JSON));
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.options.heartbeatIntervalMs ?? 30_000);
  }

  private sendHeartbeat(): void {
    this.socket?.send(encodeBilibiliPacket(OP_HEARTBEAT, "[object Object]", PROTOCOL_JSON));
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private async handleSocketMessage(data: unknown): Promise<void> {
    const buffer = Buffer.from(data instanceof ArrayBuffer ? data : await (data as Blob).arrayBuffer());
    for (const packet of decodeBilibiliPackets(buffer)) {
      if (packet.operation === OP_AUTH_REPLY) {
        this.statusState = { ...this.statusState, authenticated: true, reconnectAttempts: 0 };
        this.emit("authenticated", this.status);
        continue;
      }
      if (packet.operation === OP_HEARTBEAT_REPLY && packet.body.byteLength >= 4) {
        const popularity = packet.body.readUInt32BE(0);
        this.statusState = { ...this.statusState, popularity };
        this.emit("popularity", popularity);
        continue;
      }
      if (packet.operation !== OP_COMMAND) continue;
      for (const command of decodeBilibiliCommands(packet)) {
        this.emit("command", command);
      }
    }
  }
}

export async function resolveBilibiliRoom(roomId: number, fetchImpl: typeof fetch = fetch): Promise<BilibiliRoomInfo> {
  const url = new URL(ROOM_INIT_URL);
  url.searchParams.set("id", String(roomId));
  const payload = await getBilibiliJson(url, fetchImpl);
  const data = asRecord(payload.data);
  const resolvedRoomId = Number(data.room_id ?? roomId);
  if (!Number.isFinite(resolvedRoomId) || resolvedRoomId <= 0) {
    throw new Error(`Invalid Bilibili room id response for ${roomId}.`);
  }
  return {
    requestedRoomId: roomId,
    roomId: resolvedRoomId,
    shortId: numberOrUndefined(data.short_id),
  };
}

export async function fetchBilibiliDanmuInfo(roomId: number, fetchImpl: typeof fetch = fetch): Promise<BilibiliDanmuInfo> {
  const url = new URL(DANMU_INFO_URL);
  url.searchParams.set("id", String(roomId));
  url.searchParams.set("type", "0");
  const payload = await getBilibiliJson(url, fetchImpl);
  const data = asRecord(payload.data);
  const token = String(data.token ?? "");
  const hostList = Array.isArray(data.host_list) ? data.host_list.map(toDanmuHost).filter(isDanmuHost) : [];
  if (!token || hostList.length === 0) {
    throw new Error("Bilibili getDanmuInfo did not return token/host_list.");
  }
  return { token, hostList };
}

export function selectBilibiliWsUrl(hostList: BilibiliDanmuHost[]): string {
  const host = hostList.find(item => item.host && item.wss_port) ?? hostList.find(item => item.host);
  if (!host?.host) return "wss://broadcastlv.chat.bilibili.com/sub";
  const port = host.wss_port ?? host.port ?? 443;
  return `wss://${host.host}:${port}/sub`;
}

export function encodeBilibiliPacket(operation: number, body: string | Buffer = "", protocolVersion = PROTOCOL_JSON, sequence = 1): Buffer {
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const packet = Buffer.alloc(HEADER_LENGTH + bodyBuffer.byteLength);
  packet.writeUInt32BE(packet.byteLength, 0);
  packet.writeUInt16BE(HEADER_LENGTH, 4);
  packet.writeUInt16BE(protocolVersion, 6);
  packet.writeUInt32BE(operation, 8);
  packet.writeUInt32BE(sequence, 12);
  bodyBuffer.copy(packet, HEADER_LENGTH);
  return packet;
}

export function decodeBilibiliPackets(buffer: Buffer): BilibiliPacket[] {
  const packets: BilibiliPacket[] = [];
  let offset = 0;
  while (offset + HEADER_LENGTH <= buffer.byteLength) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const protocolVersion = buffer.readUInt16BE(offset + 6);
    const operation = buffer.readUInt32BE(offset + 8);
    const sequence = buffer.readUInt32BE(offset + 12);
    if (packetLength < headerLength || offset + packetLength > buffer.byteLength) break;
    const body = buffer.subarray(offset + headerLength, offset + packetLength);

    if (operation === OP_COMMAND && protocolVersion === PROTOCOL_ZLIB) {
      packets.push(...decodeBilibiliPackets(inflateSync(body)));
    } else if (operation === OP_COMMAND && protocolVersion === PROTOCOL_BROTLI) {
      packets.push(...decodeBilibiliPackets(brotliDecompressSync(body)));
    } else {
      packets.push({ protocolVersion, operation, sequence, body });
    }
    offset += packetLength;
  }
  return packets;
}

export function decodeBilibiliCommands(packet: BilibiliPacket): BilibiliCommand[] {
  if (packet.operation !== OP_COMMAND) return [];
  const text = packet.body.toString("utf8").trim();
  if (!text) return [];
  try {
    return [JSON.parse(text) as BilibiliCommand];
  } catch {
    return text
      .split(/(?<=})\s*(?={)/)
      .map(chunk => {
        try {
          return JSON.parse(chunk) as BilibiliCommand;
        } catch {
          return undefined;
        }
      })
      .filter((value): value is BilibiliCommand => Boolean(value));
  }
}

async function getBilibiliJson(url: URL, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const cookie = process.env.BILIBILI_COOKIE;
  const response = await fetchImpl(url, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "origin": "https://live.bilibili.com",
      "referer": "https://live.bilibili.com/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...(cookie ? { "cookie": cookie } : {}),
    },
  });
  if (!response.ok) throw new Error(`Bilibili API failed ${response.status}: ${response.statusText}`);
  const payload = asRecord(await response.json());
  const code = Number(payload.code ?? 0);
  if (code !== 0) {
    const message = String(payload.message ?? payload.msg ?? "");
    const hint = code === -352 ? " (risk control; set BILIBILI_COOKIE from a logged-in browser session)" : "";
    throw new Error(`Bilibili API returned code=${code}: ${message}${hint}`);
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toDanmuHost(value: unknown): BilibiliDanmuHost | undefined {
  const record = asRecord(value);
  const host = typeof record.host === "string" ? record.host : "";
  if (!host) return undefined;
  return {
    host,
    port: numberOrUndefined(record.port),
    wss_port: numberOrUndefined(record.wss_port),
    ws_port: numberOrUndefined(record.ws_port),
  };
}

function isDanmuHost(value: BilibiliDanmuHost | undefined): value is BilibiliDanmuHost {
  return Boolean(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
