import type { CursorModuleDefinition } from "../../manifest.js";
import { BrowserCursor } from "./cursor.js";

export const browserCursorModule: CursorModuleDefinition = {
  id: "browser",
  kind: "device_browser",
  displayName: "Browser Cursor",
  enabledInModes: ["runtime"],
  requires: ["browser"],
  create: (context) => new BrowserCursor(context),
};
