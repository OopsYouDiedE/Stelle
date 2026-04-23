import type { Client } from "discord.js";

let discordClient: Client | null = null;

export function setDiscordToolClient(client: Client): void {
  discordClient = client;
}

export function getDiscordToolClient(): Client {
  if (!discordClient) {
    throw new Error("Discord client is not ready for tool usage.");
  }
  return discordClient;
}
