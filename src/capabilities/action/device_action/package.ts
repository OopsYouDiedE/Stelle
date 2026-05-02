import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { DeviceActionArbiter } from "./arbiter.js";
import { createDeviceActionDebugProvider } from "./debug_provider.js";
import { BrowserCdpDriver } from "../browser_control/browser_driver.js";
import { DesktopInputDriver } from "../desktop_input/desktop_driver.js";
import { AndroidAdbDriver } from "../android_device/adb_driver.js";
import { buildDeviceActionAllowlist } from "./allowlist.js";
import type { RuntimeConfig } from "../../../config/index.js";

export const deviceActionCapability: ComponentPackage = {
  id: "capability.action.device_action",
  kind: "capability",
  version: "1.0.0",
  displayName: "Device Action",

  provides: [
    { id: "action.device_action", kind: "service" },
    { id: "action.device_action.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const config = ctx.config as RuntimeConfig;
    const arbiter = new DeviceActionArbiter({
      eventBus: ctx.events as never,
      now: () => Date.now(),
      drivers: [new BrowserCdpDriver(), new DesktopInputDriver(), new AndroidAdbDriver()],
      allowlist: buildDeviceActionAllowlist(config),
    });

    ctx.registry.provideForPackage?.(deviceActionCapability.id, "action.device_action", arbiter) ??
      ctx.registry.provide("action.device_action", arbiter);
    ctx.registry.provideDebugProvider(createDeviceActionDebugProvider(arbiter));
  },
};
