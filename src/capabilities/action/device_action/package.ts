import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { DeviceActionArbiter } from "./arbiter.js";
import { createDeviceActionDebugProvider } from "./debug_provider.js";
import { buildDeviceActionAllowlist } from "./allowlist.js";
import type { RuntimeConfig } from "../../../config/index.js";
import type { DeviceActionDriver } from "./types.js";

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
    const drivers = [
      ctx.registry.resolve<DeviceActionDriver>("action.driver.browser_control"),
      ctx.registry.resolve<DeviceActionDriver>("action.driver.desktop_input"),
      ctx.registry.resolve<DeviceActionDriver>("action.driver.android_device"),
    ].filter((driver): driver is DeviceActionDriver => Boolean(driver));
    const arbiter = new DeviceActionArbiter({
      eventBus: ctx.events as never,
      now: () => Date.now(),
      drivers,
      allowlist: buildDeviceActionAllowlist(config),
    });

    ctx.registry.provideForPackage?.(deviceActionCapability.id, "action.device_action", arbiter) ??
      ctx.registry.provide("action.device_action", arbiter);
    ctx.registry.provideDebugProvider(createDeviceActionDebugProvider(arbiter));
  },
};
