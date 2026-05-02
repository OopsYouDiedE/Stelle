import type { DeviceActionDriver, DeviceActionIntent, DeviceActionResult } from "../action_types.js";
import { asNumber, asRecord, asString, asStringArray, safeErrorMessage } from "../../utils/json.js";

interface CdpTarget {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

type CdpResponse = { id: number; result?: unknown; error?: { message?: string; data?: string } };

export class BrowserCdpDriver implements DeviceActionDriver {
  readonly resourceKind = "browser" as const;

  constructor(private readonly options: { baseUrl?: string; timeoutMs?: number } = {}) {}

  async execute(intent: DeviceActionIntent): Promise<DeviceActionResult> {
    try {
      const target = await this.resolveTarget(intent);
      const client = await CdpClient.connect(target.webSocketDebuggerUrl!, this.options.timeoutMs ?? 7000);
      try {
        await client.send("Runtime.enable");
        await client.send("Page.enable").catch(() => undefined);
        const result = await this.executeOnTarget(client, intent);
        return {
          ok: true,
          summary: `CDP ${intent.actionKind} completed for ${target.title || target.url || target.id || intent.resourceId}.`,
          observation: result,
        };
      } finally {
        client.close();
      }
    } catch (error) {
      return { ok: false, summary: `Browser CDP ${intent.actionKind} failed: ${safeErrorMessage(error)}` };
    }
  }

  private async executeOnTarget(client: CdpClient, intent: DeviceActionIntent): Promise<Record<string, unknown>> {
    const payload = asRecord(intent.payload);
    switch (intent.actionKind) {
      case "observe":
        return this.observe(client);
      case "navigate": {
        const url = asString(payload.url);
        if (!url) throw new Error("navigate requires payload.url.");
        await client.send("Page.navigate", { url });
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, url };
      }
      case "click":
        await this.click(client, payload);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, payload };
      case "type":
        await this.typeText(client, payload);
        return {
          resourceKind: this.resourceKind,
          actionKind: intent.actionKind,
          textLength: String(payload.text ?? "").length,
        };
      case "hotkey":
        await this.hotkey(client, asStringArray(payload.keys));
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, keys: asStringArray(payload.keys) };
      case "scroll":
        await this.scroll(client, payload);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, payload };
      default:
        throw new Error(`Unsupported browser action: ${intent.actionKind}.`);
    }
  }

  private async observe(client: CdpClient): Promise<Record<string, unknown>> {
    const expression = [
      "(() => ({",
      "url: location.href,",
      "title: document.title,",
      "activeElement: document.activeElement ? { tag: document.activeElement.tagName, id: document.activeElement.id, name: document.activeElement.getAttribute('name') } : null,",
      "text: document.body ? document.body.innerText.slice(0, 4000) : ''",
      "}))()",
    ].join("");
    const value = await this.evaluate(client, expression, true);
    return { resourceKind: this.resourceKind, actionKind: "observe", page: value };
  }

  private async click(client: CdpClient, payload: Record<string, unknown>): Promise<void> {
    const selector = asString(payload.selector);
    if (selector) {
      await this.evaluate(
        client,
        `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("selector not found: ${escapeForJsTemplate(selector)}");
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
        return true;
      })()`,
      );
      return;
    }

    const x = asNumber(payload.x);
    const y = asNumber(payload.y);
    if (x === undefined || y === undefined) throw new Error("click requires payload.selector or payload.x/payload.y.");
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  private async typeText(client: CdpClient, payload: Record<string, unknown>): Promise<void> {
    const text = asString(payload.text) ?? "";
    const selector = asString(payload.selector);
    if (selector) {
      await this.evaluate(
        client,
        `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("selector not found: ${escapeForJsTemplate(selector)}");
        el.scrollIntoView({ block: "center", inline: "center" });
        el.focus();
        return true;
      })()`,
      );
    }
    await client.send("Input.insertText", { text });
  }

  private async hotkey(client: CdpClient, keys: string[]): Promise<void> {
    if (!keys.length) throw new Error("hotkey requires payload.keys.");
    let modifiers = 0;
    for (const key of keys) {
      const def = normalizeKey(key);
      if (def.modifier) modifiers |= def.modifier;
      await client.send("Input.dispatchKeyEvent", keyEvent("keyDown", key, modifiers));
    }
    for (const key of [...keys].reverse()) {
      const def = normalizeKey(key);
      await client.send("Input.dispatchKeyEvent", keyEvent("keyUp", key, modifiers));
      if (def.modifier) modifiers &= ~def.modifier;
    }
  }

  private async scroll(client: CdpClient, payload: Record<string, unknown>): Promise<void> {
    const deltaX = asNumber(payload.deltaX) ?? 0;
    const deltaY = asNumber(payload.deltaY) ?? asNumber(payload.amount) ?? 0;
    await this.evaluate(client, `window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)})`);
  }

  private async evaluate(client: CdpClient, expression: string, returnByValue = false): Promise<unknown> {
    const response = asRecord(
      await client.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue,
        userGesture: true,
      }),
    );
    const result = asRecord(response.result);
    if (result.subtype === "error") throw new Error(String(result.description ?? "Runtime.evaluate failed."));
    return returnByValue ? result.value : response;
  }

  private async resolveTarget(intent: DeviceActionIntent): Promise<CdpTarget> {
    const payload = asRecord(intent.payload);
    const directWs =
      asString(payload.webSocketDebuggerUrl) ?? (intent.resourceId.startsWith("ws") ? intent.resourceId : undefined);
    if (directWs) return { id: intent.resourceId, webSocketDebuggerUrl: directWs };

    const targets = await this.listTargets();
    const wanted = intent.resourceId === "default" ? undefined : intent.resourceId;
    const target =
      targets.find(
        (t) =>
          t.webSocketDebuggerUrl &&
          (!wanted || t.id === wanted || t.url === wanted || t.title === wanted || t.url?.includes(wanted)),
      ) ??
      targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ??
      targets.find((t) => t.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) {
      throw new Error(
        `No CDP target found. Start Chrome/Edge with --remote-debugging-port=9222 or pass payload.webSocketDebuggerUrl.`,
      );
    }
    return target;
  }

  private async listTargets(): Promise<CdpTarget[]> {
    const base = (this.options.baseUrl ?? process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222").replace(/\/+$/, "");
    const response = await fetch(`${base}/json`);
    if (!response.ok) throw new Error(`CDP target list failed: ${response.status} ${response.statusText}`);
    return (await response.json()) as CdpTarget[];
  }
}

class CdpClient {
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  private constructor(
    private readonly ws: any,
    private readonly timeoutMs: number,
  ) {
    ws.onmessage = (event: { data: string }) => this.handleMessage(event.data);
    ws.onerror = () => this.rejectAll(new Error("CDP websocket error."));
    ws.onclose = () => this.rejectAll(new Error("CDP websocket closed."));
  }

  static connect(url: string, timeoutMs: number): Promise<CdpClient> {
    const WebSocketCtor = (globalThis as any).WebSocket;
    if (!WebSocketCtor) return Promise.reject(new Error("Global WebSocket is unavailable. Use Node.js >= 20."));

    return new Promise((resolve, reject) => {
      const ws = new WebSocketCtor(url);
      const timer = setTimeout(() => reject(new Error("CDP websocket connection timed out.")), timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws, timeoutMs));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP websocket connection failed."));
      };
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // best effort
    }
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as CdpResponse;
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error([message.error.message, message.error.data].filter(Boolean).join(": ")));
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function keyEvent(type: "keyDown" | "keyUp", key: string, modifiers: number): Record<string, unknown> {
  const normalized = normalizeKey(key);
  return {
    type,
    key: normalized.key,
    code: normalized.code,
    windowsVirtualKeyCode: normalized.windowsVirtualKeyCode,
    modifiers,
  };
}

function normalizeKey(key: string): { key: string; code: string; windowsVirtualKeyCode: number; modifier: number } {
  const k = key.toLowerCase();
  if (k === "control" || k === "ctrl")
    return { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifier: 2 };
  if (k === "shift") return { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifier: 8 };
  if (k === "alt") return { key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifier: 1 };
  if (k === "meta" || k === "win") return { key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifier: 4 };
  if (k === "enter") return { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifier: 0 };
  if (k === "escape" || k === "esc") return { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, modifier: 0 };
  if (k === "tab") return { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifier: 0 };
  if (k === "backspace") return { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, modifier: 0 };
  if (k === "delete") return { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, modifier: 0 };
  if (/^[a-z]$/i.test(key)) {
    const upper = key.toUpperCase();
    return { key: key.toLowerCase(), code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), modifier: 0 };
  }
  if (/^\d$/.test(key)) {
    return { key, code: `Digit${key}`, windowsVirtualKeyCode: key.charCodeAt(0), modifier: 0 };
  }
  return { key, code: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), modifier: 0 };
}

function escapeForJsTemplate(value: string): string {
  return value.replace(/[\\`$]/g, "\\$&");
}
