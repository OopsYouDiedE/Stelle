import { InnerCursor } from "../../inner/cursor.js";
import type { CursorModuleDefinition } from "../../manifest.js";

// === Module Definition ===

export const innerCursorModule: CursorModuleDefinition = {
  id: "inner",
  kind: "inner",
  displayName: "Inner Cursor",
  enabledInModes: ["runtime", "discord", "live"],
  create: (context) => new InnerCursor(context),
};
