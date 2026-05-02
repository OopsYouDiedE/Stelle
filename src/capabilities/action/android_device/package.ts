import type { ComponentPackage, ComponentRegisterContext } from "../../../core/protocol/component.js";
import { AndroidAdbDriver } from "./adb_driver.js";

export const androidDeviceCapability: ComponentPackage = {
  id: "capability.action.android_device",
  kind: "capability",
  version: "1.0.0",
  displayName: "Android Device",
  provides: [{ id: "action.driver.android_device", kind: "service" }],
  register(ctx: ComponentRegisterContext) {
    ctx.registry.provideForPackage?.(
      androidDeviceCapability.id,
      "action.driver.android_device",
      new AndroidAdbDriver(),
    ) ?? ctx.registry.provide("action.driver.android_device", new AndroidAdbDriver());
  },
};
