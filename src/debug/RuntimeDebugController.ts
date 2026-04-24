import type { LiveRendererDebugController } from "../live/renderer/LiveRendererServer.js";
import type { DiscordAttachedCoreMind } from "../stelle/DiscordAttachedCoreMind.js";

export class RuntimeDebugController implements LiveRendererDebugController {
  constructor(private readonly app: DiscordAttachedCoreMind) {}

  getSnapshot(): Promise<Record<string, unknown>> {
    return this.app.createDebugSnapshot();
  }

  switchCursor(cursorId: string, reason: string): Promise<void> {
    return this.app.switchCursorForDebug(cursorId, reason);
  }

  observeCursor(cursorId?: string): Promise<unknown> {
    return this.app.observeCursorForDebug(cursorId);
  }

  useTool(
    name: string,
    input: Record<string, unknown>,
    options?: { cursorId?: string; returnToInner?: boolean }
  ): Promise<unknown> {
    return this.app.useToolAsStelle(name, input, options);
  }

  sendDiscordMessage(input: {
    channel_id: string;
    content: string;
    mention_user_ids?: string[];
    reply_to_message_id?: string;
  }): Promise<unknown> {
    return this.app.sendStelleDiscordMessage(input);
  }

  getDiscordHistory(channelId?: string): unknown {
    return this.app.getDiscordLocalHistory(channelId);
  }
}
