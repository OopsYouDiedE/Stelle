import type { ComponentPackage, ComponentRegisterContext } from "../../../core/protocol/component.js";
import { BrowserCdpDriver } from "./browser_driver.js";

export const browserControlCapability: ComponentPackage = {
  id: "capability.action.browser_control",
  kind: "capability",
  version: "1.0.0",
  displayName: "Browser Control",
  provides: [{ id: "action.driver.browser_control", kind: "service" }],
  register(ctx: ComponentRegisterContext) {
    ctx.registry.provideForPackage?.(
      browserControlCapability.id,
      "action.driver.browser_control",
      new BrowserCdpDriver(),
    ) ?? ctx.registry.provide("action.driver.browser_control", new BrowserCdpDriver());
  },
};
