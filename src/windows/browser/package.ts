import type { ComponentPackage, ComponentRegisterContext } from "../../core/protocol/component.js";
import type { DataPlane } from "../../core/runtime/data_plane.js";
import { BrowserWindow } from "./browser_window.js";
import { createBrowserWindowDebugProvider } from "./debug_provider.js";

export const browserWindowPackage: ComponentPackage = {
  id: "window.browser",
  kind: "window",
  version: "1.0.0",
  displayName: "Browser Window",
  requires: [{ id: "capability.action.device_action" }],
  provides: [
    { id: "window.browser", kind: "service" },
    { id: "window.browser.debug", kind: "debug_provider" },
  ],
  register(ctx: ComponentRegisterContext) {
    const window = new BrowserWindow(ctx.registry, ctx.dataPlane as DataPlane);
    ctx.registry.provideForPackage?.(browserWindowPackage.id, "window.browser", window) ??
      ctx.registry.provide("window.browser", window);
    ctx.registry.provideDebugProvider(createBrowserWindowDebugProvider(window));
  },
};
