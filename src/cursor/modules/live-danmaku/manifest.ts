import { LiveDanmakuCursor } from "../../live/cursor.js";
import type { CursorModuleDefinition } from "../../manifest.js";

export const liveDanmakuCursorModule: CursorModuleDefinition = {
  id: "live_danmaku",
  kind: "live_danmaku",
  displayName: "Live Danmaku Cursor",
  enabledInModes: ["runtime", "live"],
  requires: ["live"],
  create: (context) => new LiveDanmakuCursor(context),
};
