import type { ModuleRegistrar } from "../registrar.js";
import type { RuntimeServices } from "../container.js";
import type { StelleCursor } from "../../cursor/types.js";

export class DiscordModule implements ModuleRegistrar {
  readonly name = "discord";
  private cursor?: StelleCursor;

  constructor(private readonly cursors: StelleCursor[]) {
    this.cursor = cursors.find(c => c.id === "discord_text_channel" || c.id === "discord");
  }

  register(services: RuntimeServices): void {
    services.discord.onMessage((message) => {
      services.eventBus.publish({
        type: "discord.text.message.received",
        source: "discord",
        payload: { message }
      });
    });
  }

  async start(): Promise<void> {
    // Discord login is currently handled in application.ts, 
    // but could be moved here if we pass the token.
  }

  async stop(): Promise<void> {
    // Discord destroy is currently handled in application.ts
  }
}
