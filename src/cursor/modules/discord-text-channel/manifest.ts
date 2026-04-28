import { DiscordTextChannelCursor } from "../../discord/cursor.js";
import type { CursorModuleDefinition } from "../../manifest.js";

export const discordTextChannelCursorModule: CursorModuleDefinition = {
  id: "discord_text_channel",
  kind: "discord_text_channel",
  displayName: "Discord Text Channel Cursor",
  enabledInModes: ["runtime", "discord"],
  requires: ["discord"],
  create: (context) => new DiscordTextChannelCursor(context),
};
