import type { ComponentPackage, ComponentRegisterContext } from "../../core/protocol/component.js";
import type { DataPlane } from "../../core/runtime/data_plane.js";
import { DesktopInputWindow } from "./desktop_input_window.js";
import { createDesktopInputWindowDebugProvider } from "./debug_provider.js";

export const desktopInputWindowPackage: ComponentPackage = {
  id: "window.desktop_input",
  kind: "window",
  version: "1.0.0",
  displayName: "Desktop Input Window",
  requires: [{ id: "capability.action.device_action" }],
  provides: [
    { id: "window.desktop_input", kind: "service" },
    { id: "window.desktop_input.debug", kind: "debug_provider" },
  ],
  register(ctx: ComponentRegisterContext) {
    const window = new DesktopInputWindow(ctx.registry, ctx.dataPlane as DataPlane);
    ctx.registry.provideForPackage?.(desktopInputWindowPackage.id, "window.desktop_input", window) ??
      ctx.registry.provide("window.desktop_input", window);
    ctx.registry.provideDebugProvider(createDesktopInputWindowDebugProvider(window));
  },
};
