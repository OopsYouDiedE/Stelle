import { execFile } from "node:child_process";
import type { DeviceActionDriver, DeviceActionIntent, DeviceActionResult } from "../action_types.js";
import { asNumber, asRecord, asString, asStringArray, safeErrorMessage } from "../../utils/json.js";

export class DesktopInputDriver implements DeviceActionDriver {
  readonly resourceKind = "desktop_input" as const;

  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async execute(intent: DeviceActionIntent): Promise<DeviceActionResult> {
    if (process.platform !== "win32") {
      return { ok: false, summary: "Desktop input driver currently supports Windows only." };
    }

    try {
      const observation = await this.runIntent(intent);
      return {
        ok: true,
        summary: `Desktop input ${intent.actionKind} completed for ${intent.resourceId}.`,
        observation,
      };
    } catch (error) {
      return { ok: false, summary: `Desktop input ${intent.actionKind} failed: ${safeErrorMessage(error)}` };
    }
  }

  private async runIntent(intent: DeviceActionIntent): Promise<Record<string, unknown>> {
    const payload = asRecord(intent.payload);
    switch (intent.actionKind) {
      case "observe":
        return await this.runPowerShell(`${desktopPrelude()}\nGet-ActiveWindowJson`);
      case "move_mouse": {
        const { x, y } = requirePoint(payload, "move_mouse");
        await this.runPowerShell(`${desktopPrelude()}\n[NativeInput]::SetCursorPos(${x}, ${y}) | Out-Null`);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, x, y };
      }
      case "click":
      case "mouse_down":
      case "mouse_up": {
        const point = optionalPoint(payload);
        const script = [
          desktopPrelude(),
          point ? `[NativeInput]::SetCursorPos(${point.x}, ${point.y}) | Out-Null` : "",
          mouseCommand(intent.actionKind),
        ]
          .filter(Boolean)
          .join("\n");
        await this.runPowerShell(script);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, ...point };
      }
      case "drag": {
        const startX = asNumber(payload.startX);
        const startY = asNumber(payload.startY);
        const endX = asNumber(payload.endX);
        const endY = asNumber(payload.endY);
        if ([startX, startY, endX, endY].some((v) => v === undefined))
          throw new Error("drag requires startX/startY/endX/endY.");
        await this.runPowerShell(
          [
            desktopPrelude(),
            `[NativeInput]::SetCursorPos(${startX}, ${startY}) | Out-Null`,
            "[NativeInput]::MouseEvent(0x0002)",
            "Start-Sleep -Milliseconds 80",
            `[NativeInput]::SetCursorPos(${endX}, ${endY}) | Out-Null`,
            "Start-Sleep -Milliseconds 80",
            "[NativeInput]::MouseEvent(0x0004)",
          ].join("\n"),
        );
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, startX, startY, endX, endY };
      }
      case "type": {
        const text = asString(payload.text) ?? "";
        await this.runPowerShell(`${desktopPrelude()}\nSend-Text ${psString(text)}`);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, textLength: text.length };
      }
      case "hotkey": {
        const keys = asStringArray(payload.keys);
        if (!keys.length) throw new Error("hotkey requires payload.keys.");
        await this.runPowerShell(`${desktopPrelude()}\nSend-Hotkey @(${keys.map(psString).join(", ")})`);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, keys };
      }
      case "key_down":
      case "key_up": {
        const key = asString(payload.key);
        if (!key) throw new Error(`${intent.actionKind} requires payload.key.`);
        await this.runPowerShell(
          `${desktopPrelude()}\nSend-Key ${psString(key)} ${intent.actionKind === "key_down" ? "$true" : "$false"}`,
        );
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, key };
      }
      case "scroll": {
        const delta = Math.round(asNumber(payload.deltaY) ?? asNumber(payload.amount) ?? 0);
        await this.runPowerShell(`${desktopPrelude()}\n[NativeInput]::MouseWheel(${delta})`);
        return { resourceKind: this.resourceKind, actionKind: intent.actionKind, deltaY: delta };
      }
      default:
        throw new Error(`Unsupported desktop input action: ${intent.actionKind}.`);
    }
  }

  private async runPowerShell(script: string): Promise<Record<string, unknown>> {
    const stdout = await execPowerShell(script, this.options.timeoutMs ?? 7000);
    const trimmed = stdout.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return { stdout: trimmed };
    }
  }
}

function execPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
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

function desktopPrelude(): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public struct POINT { public int X; public int Y; }
  public static void MouseEvent(uint flags) { mouse_event(flags, 0, 0, 0, UIntPtr.Zero); }
  public static void MouseWheel(int delta) { mouse_event(0x0800, 0, 0, unchecked((uint)delta), UIntPtr.Zero); }
}
"@
function Get-ActiveWindowJson {
  $p = New-Object NativeInput+POINT
  [NativeInput]::GetCursorPos([ref]$p) | Out-Null
  $h = [NativeInput]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [NativeInput]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  @{ resourceKind = "desktop_input"; actionKind = "observe"; activeWindow = $sb.ToString(); cursor = @{ x = $p.X; y = $p.Y } } | ConvertTo-Json -Compress
}
function Send-Text([string]$text) {
  [System.Windows.Forms.SendKeys]::SendWait($text.Replace("{", "{{}").Replace("}", "{}}").Replace("+", "{+}").Replace("^", "{^}").Replace("%", "{%}").Replace("~", "{~}").Replace("(", "{(}").Replace(")", "{)}").Replace("[", "{[}").Replace("]", "{]}"))
}
function Convert-Key([string]$key) {
  switch ($key.ToLowerInvariant()) {
    "control" { return 0x11 }
    "ctrl" { return 0x11 }
    "shift" { return 0x10 }
    "alt" { return 0x12 }
    "enter" { return 0x0D }
    "escape" { return 0x1B }
    "esc" { return 0x1B }
    "tab" { return 0x09 }
    "backspace" { return 0x08 }
    "delete" { return 0x2E }
    "left" { return 0x25 }
    "up" { return 0x26 }
    "right" { return 0x27 }
    "down" { return 0x28 }
    default {
      if ($key.Length -eq 1) { return [byte][char]$key.ToUpperInvariant() }
      throw "Unsupported key: $key"
    }
  }
}
function Send-Key([string]$key, [bool]$down) {
  $vk = [byte](Convert-Key $key)
  $flags = if ($down) { 0 } else { 0x0002 }
  [NativeInput]::keybd_event($vk, 0, $flags, [UIntPtr]::Zero)
}
function Send-Hotkey([string[]]$keys) {
  foreach ($key in $keys) { Send-Key $key $true; Start-Sleep -Milliseconds 20 }
  [array]::Reverse($keys)
  foreach ($key in $keys) { Send-Key $key $false; Start-Sleep -Milliseconds 20 }
}
`;
}

function mouseCommand(kind: DeviceActionIntent["actionKind"]): string {
  if (kind === "mouse_down") return "[NativeInput]::MouseEvent(0x0002)";
  if (kind === "mouse_up") return "[NativeInput]::MouseEvent(0x0004)";
  return "[NativeInput]::MouseEvent(0x0002); Start-Sleep -Milliseconds 40; [NativeInput]::MouseEvent(0x0004)";
}

function requirePoint(payload: Record<string, unknown>, action: string): { x: number; y: number } {
  const point = optionalPoint(payload);
  if (!point) throw new Error(`${action} requires payload.x and payload.y.`);
  return point;
}

function optionalPoint(payload: Record<string, unknown>): { x: number; y: number } | undefined {
  const x = asNumber(payload.x);
  const y = asNumber(payload.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
