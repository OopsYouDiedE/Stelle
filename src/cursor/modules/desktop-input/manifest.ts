import type { CursorModuleDefinition } from "../../manifest.js";
import { DesktopInputCursor } from "./cursor.js";

export const desktopInputCursorModule: CursorModuleDefinition = {
  id: "desktop_input",
  kind: "device_desktop_input",
  displayName: "Desktop Input Cursor",
  enabledInModes: ["runtime"],
  requires: ["desktop_input"],
  create: (context) => new DesktopInputCursor(context),
};
