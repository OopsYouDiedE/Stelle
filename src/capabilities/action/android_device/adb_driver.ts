import { execFile } from "node:child_process";
import type { DeviceActionDriver, DeviceActionIntent, DeviceActionResult } from "../device_action/types.js";
import { asNumber, asRecord, asString, safeErrorMessage } from "../../../utils/json.js";

export class AndroidAdbDriver implements DeviceActionDriver {
  readonly resourceKind = "android_device" as const;

  constructor(private readonly options: { adbPath?: string; timeoutMs?: number } = {}) {}

  async execute(intent: DeviceActionIntent): Promise<DeviceActionResult> {
    try {
      const observation = await this.runIntent(intent);
      return {
        ok: true,
        summary: `ADB ${intent.actionKind} completed for ${intent.resourceId}.`,
        observation,
      };
    } catch (error) {
      return { ok: false, summary: `ADB ${intent.actionKind} failed: ${safeErrorMessage(error)}` };
    }
  }

  private async runIntent(intent: DeviceActionIntent): Promise<Record<string, unknown>> {
    const payload = asRecord(intent.payload);
    switch (intent.actionKind) {
      case "observe": {
        const [windowInfo, activityInfo] = await Promise.all([
          this.adb(intent.resourceId, ["shell", "dumpsys", "window", "windows"]).catch((error) =>
            safeErrorMessage(error),
          ),
          this.adb(intent.resourceId, ["shell", "dumpsys", "activity", "top"]).catch((error) =>
            safeErrorMessage(error),
          ),
        ]);
        return {
          resourceKind: this.resourceKind,
          actionKind: intent.actionKind,
          window: windowInfo.slice(0, 4000),
          activity: activityInfo.slice(0, 4000),
        };
      }
      case "android_tap": {
        const x = asNumber(payload.x);
        const y = asNumber(payload.y);
        if (x === undefined || y === undefined) throw new Error("android_tap requires payload.x and payload.y.");
        await this.adb(intent.resourceId, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, x, y };
      }
      case "android_text": {
        const text = asString(payload.text) ?? "";
        await this.adb(intent.resourceId, ["shell", "input", "text", adbInputText(text)]);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, textLength: text.length };
      }
      case "android_back":
        await this.adb(intent.resourceId, ["shell", "input", "keyevent", "4"]);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind };
      default:
        throw new Error(`Unsupported android action: ${intent.actionKind}.`);
    }
  }

  private adb(resourceId: string, args: string[]): Promise<string> {
    const adbPath = this.options.adbPath ?? process.env.ANDROID_ADB_PATH ?? "adb";
    const serialArgs = resourceId && resourceId !== "default" ? ["-s", resourceId] : [];
    return new Promise((resolve, reject) => {
      execFile(
        adbPath,
        [...serialArgs, ...args],
        { timeout: this.options.timeoutMs ?? 10000, windowsHide: true, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.trim() || error.message));
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}

function adbInputText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\s/g, "%s")
    .replace(/[&|;<>()$`"']/g, "\\$&");
}
