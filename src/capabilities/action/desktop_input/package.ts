import type { ComponentPackage, ComponentRegisterContext } from "../../../core/protocol/component.js";
import { DesktopInputDriver } from "./desktop_driver.js";

export const desktopInputCapability: ComponentPackage = {
  id: "capability.action.desktop_input",
  kind: "capability",
  version: "1.0.0",
  displayName: "Desktop Input",
  provides: [{ id: "action.driver.desktop_input", kind: "service" }],
  register(ctx: ComponentRegisterContext) {
    ctx.registry.provideForPackage?.(
      desktopInputCapability.id,
      "action.driver.desktop_input",
      new DesktopInputDriver(),
    ) ?? ctx.registry.provide("action.driver.desktop_input", new DesktopInputDriver());
  },
};
