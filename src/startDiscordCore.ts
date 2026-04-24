import { startDiscordAttachedCoreMind } from "./index.js";

const defaultChannelId = process.env.DISCORD_TEST_CHANNEL_ID;

const app = await startDiscordAttachedCoreMind({ defaultChannelId });

const status = await app.discordRuntime.getStatus();
console.log(
  `[Stelle] Core Mind defaulted to Inner Cursor; Discord Cursor online. connected=${status.connected} botUserId=${status.botUserId ?? "unknown"} defaultChannel=${defaultChannelId ?? "unset"}`
);

process.on("SIGINT", () => {
  void app.stop().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void app.stop().finally(() => process.exit(0));
});
