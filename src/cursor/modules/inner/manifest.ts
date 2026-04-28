import { InnerCursor } from "../../inner_cursor.js";
import type { CursorModuleDefinition } from "../../manifest.js";

export const innerCursorModule: CursorModuleDefinition = {
  id: "inner",
  kind: "inner",
  displayName: "Inner Cursor",
  enabledInModes: ["runtime", "discord", "live"],
  create: (context) => new InnerCursor(context),
};
