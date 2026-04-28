export const CURSOR_CAPABILITIES = {
  discord: {
    planTools: [
      "memory.read_recent", "memory.search", "memory.read_long_term",
      "discord.status", "discord.get_channel_history", "live.status",
      "search.web_search", "search.web_read",
    ],
    executeTools: [
      "memory.read_recent", "memory.search", "memory.read_long_term", "memory.write_long_term",
      "memory.append_research_log", "search.web_search", "search.web_read",
      "discord.status", "discord.get_channel_history", "discord.reply_message",
      "live.status", "obs.status",
    ],
  },
  live: {
    planTools: [
      "memory.read_recent", "memory.search", "memory.read_long_term",
      "live.status", "obs.status", "basic.datetime",
      "search.web_search", "search.web_read",
    ],
    stageTools: [
      "basic.datetime", "memory.read_long_term", "memory.write_recent", "memory.search",
      "memory.propose_write", "search.web_search", "search.web_read", "live.status",
      "live.push_event", "obs.status", "tts.kokoro_speech",
    ],
    executeTools: [
      "memory.read_recent", "memory.search", "memory.read_long_term",
      "live.status", "live.push_event", "obs.status", "basic.datetime",
      "search.web_search", "search.web_read",
    ],
  },
} as const;

export function capabilitySet(values: readonly string[]): Set<string> {
  return new Set(values);
}
