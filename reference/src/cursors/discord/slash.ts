import type {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
  TextBasedChannel,
  User,
} from "discord.js";
import type { DiscordCursorController } from "./controller.js";

export interface DiscordSlashHandlerDeps {
  discordController: DiscordCursorController;
  loc(locale: string | null | undefined, en: string, zh: string): string;
  isAuthorized(
    member: GuildMember | null,
    user: User,
    channelId: string
  ): boolean;
  forgetUserProfile(userId: string): Promise<boolean>;
  clearChannelMemory(channelId: string): Promise<void>;
  getChannelConfig(channelId: string): Record<string, unknown>;
  defaultChannelConfig: Record<string, unknown>;
  setChannelConfig(
    channelId: string,
    updates: Record<string, unknown>
  ): Promise<void>;
  setGuildConfig(
    guildId: string,
    updates: Record<string, unknown>
  ): Promise<void>;
  userIndex: {
    search(keyword: string): Array<[string, string]>;
    getOrCreateNickname(message: Message): Promise<string>;
  };
  getBotId(): string;
  formatMessage(
    message: Message,
    nickname: string,
    lastAuthorId: string,
    lastMsgTime: number
  ): Promise<{ lines: string[]; authorId: string; ts: number }>;
}

function dateToSnowflake(date: Date): string {
  const discordEpoch = 1_420_070_400_000n;
  return String(((BigInt(date.getTime()) - discordEpoch) << 22n) | 0n);
}

async function collectChannelHistory(
  channel: TextBasedChannel,
  limit: number,
  beforeTime?: Date
): Promise<Message[]> {
  const out: Message[] = [];
  if (!("messages" in channel)) return out;
  let before: string | undefined = beforeTime
    ? dateToSnowflake(beforeTime)
    : undefined;
  while (out.length < limit) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, limit - out.length),
      before,
    });
    if (!batch.size) break;
    let oldest: Message | null = null;
    for (const message of batch.values()) {
      if (!oldest || message.createdTimestamp < oldest.createdTimestamp) {
        oldest = message;
      }
      out.push(message);
    }
    before = oldest?.id;
    if (batch.size < Math.min(100, limit - out.length)) break;
  }
  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out.slice(0, limit);
}

export async function handleDiscordSlash(
  interaction: ChatInputCommandInteraction,
  deps: DiscordSlashHandlerDeps
): Promise<void> {
  const locale = interaction.locale;
  const member = interaction.member as GuildMember | null;
  const user = interaction.user;
  const channel = interaction.channel;
  const channelId = interaction.channelId;
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: "? 无效频道", ephemeral: true });
    return;
  }

  try {
    switch (interaction.commandName) {
      case "shut_up": {
        await interaction.deferReply({ ephemeral: false });
        if (deps.discordController.muteChannel(channelId, 300)) {
          await interaction.editReply(
            deps.loc(
              locale,
              "?? Received. I will remain absolutely silent for the next 5 minutes.",
              "?? 收到。我将在接下来的 5 分钟内保持绝对沉默。"
            )
          );
        } else {
          await interaction.editReply(
            deps.loc(
              locale,
              "?? The current channel is not actively monitored, no need to mute.",
              "?? 当前频道并未激活监听，无需静音。"
            )
          );
        }
        break;
      }
      case "forget_me": {
        await interaction.deferReply({ ephemeral: true });
        const ok = await deps.forgetUserProfile(user.id);
        await interaction.editReply(
          ok
            ? deps.loc(
                locale,
                "??? Your global profile has been completely destroyed.",
                "??? 你的全局个人档案已被彻底销毁。"
              )
            : deps.loc(
                locale,
                "?? The AI has not yet established a global profile for you.",
                "?? AI 目前还没有建立你的跨服个人档案。"
              )
        );
        break;
      }
      case "clear": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        await deps.clearChannelMemory(channelId);
        deps.discordController.clearChannelRuntime(channelId);
        await interaction.editReply(
          deps.loc(
            locale,
            "?? Format complete! Channel memory and context have been cleared.",
            "?? 格式化完毕！当前频道的记忆和上下文已全部清空。"
          )
        );
        break;
      }
      case "memorize": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: false });
        const reviewStatus = await deps.discordController.runManualReview(channelId);
        if (reviewStatus === "missing" || reviewStatus === "empty") {
          await interaction.editReply(
            deps.loc(
              locale,
              "?? Channel not activated or no chat history.",
              "?? 频道未激活或暂无对话记录。"
            )
          );
          return;
        }
        if (reviewStatus === "success") {
          await interaction.editReply(
            deps.loc(locale, "? **Memory successfully packed!**", "? **记忆已打包！**")
          );
        } else {
          await interaction.editReply(
            deps.loc(
              locale,
              "? Memory packing failed, check background logs.",
              "? 记忆打包失败，请查看后台日志。"
            )
          );
        }
        break;
      }
      case "distill": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: false });
        const status = await deps.discordController.startDistill(channelId);
        if (status === "missing") {
          await interaction.editReply(
            deps.loc(locale, "?? Channel not activated.", "?? 频道未激活。")
          );
          return;
        }
        if (status === "empty") {
          await interaction.editReply(
            deps.loc(
              locale,
              "?? Channel historical events are empty.",
              "?? 频道历史事件为空。"
            )
          );
          return;
        }
        await interaction.editReply(
          deps.loc(
            locale,
            "? **Engine started:** Scanning all historical events in background...",
            "? **引擎启动：** 正在后台扫描所有历史事件..."
          )
        );
        break;
      }
      case "activate": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        deps.discordController.ensurePersistentSession(channelId);
        await deps.setChannelConfig(channelId, { activated: true });
        await interaction.editReply(
          deps.loc(
            locale,
            "?? Stelle activated in this channel.",
            "?? Stelle 已在此频道激活。"
          )
        );
        break;
      }
      case "deactivate": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        deps.discordController.deactivateChannel(channelId);
        await deps.setChannelConfig(channelId, { activated: false });
        await interaction.editReply(
          deps.loc(
            locale,
            "?? Stelle has stopped listening.",
            "?? Stelle 已停止监听。"
          )
        );
        break;
      }
      case "config": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString("key");
        const value = interaction.options.getString("value");
        const cfg = deps.getChannelConfig(channelId);
        if (!key) {
          const head = deps.loc(locale, "**Channel Config:**\n", "**频道配置：**\n");
          const body = Object.entries(cfg)
            .filter(([entry]) => entry !== "authorized_users")
            .map(([entry, entryValue]) => `\`${entry}\` = \`${String(entryValue)}\``)
            .join("\n");
          await interaction.editReply({ content: head + body });
          return;
        }
        if (!(key in deps.defaultChannelConfig)) {
          await interaction.editReply(
            deps.loc(
              locale,
              `? Unknown config key: \`${key}\``,
              `? 未知的频道配置: \`${key}\``
            )
          );
          return;
        }
        if (!value) {
          await interaction.editReply({
            content: `\`${key}\` = \`${String(cfg[key])}\``,
          });
          return;
        }
        const original = deps.defaultChannelConfig[key];
        let typed: unknown;
        try {
          if (typeof original === "boolean") {
            typed = ["true", "1", "yes"].includes(value.toLowerCase());
          } else if (typeof original === "number") {
            typed = Number(value);
            if (Number.isNaN(typed)) throw new Error("nan");
          } else {
            typed = value;
          }
        } catch {
          await interaction.editReply(
            deps.loc(locale, "? Type error", "? 类型错误")
          );
          return;
        }
        await deps.setChannelConfig(channelId, { [key]: typed });
        await interaction.editReply(
          deps.loc(
            locale,
            `? Updated channel config \`${key}\` = \`${String(typed)}\``,
            `? 更新频道 \`${key}\` = \`${String(typed)}\``
          )
        );
        break;
      }
      case "set_api": {
        if (!interaction.guild) {
          await interaction.reply({
            content: deps.loc(
              locale,
              "? This command is only available in servers. DMs automatically use your server's config.",
              "? 此命令仅限服务器内使用，私聊将自动读取您所在服务器的配置。"
            ),
            ephemeral: true,
          });
          return;
        }
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const model = interaction.options.getString("model", true);
        const apiKey = interaction.options.getString("api_key");
        const baseUrl = interaction.options.getString("base_url");
        const updates: Record<string, unknown> = { model };
        if (apiKey) updates.api_key = apiKey;
        if (baseUrl) updates.base_url = baseUrl;
        await deps.setGuildConfig(interaction.guild.id, updates);
        const mask =
          apiKey && apiKey.length > 4
            ? `sk-***${apiKey.slice(-4)}`
            : apiKey
              ? "***"
              : deps.loc(locale, "Unchanged", "未修改");
        await interaction.editReply(
          deps.loc(
            locale,
            `? **Server Config Updated!**\n?? Model: \`${model}\`\n?? Key: \`${mask}\`\n?? URL: \`${baseUrl ?? "Default/Unchanged"}\``,
            `? **服务器级配置成功！**\n?? 模型: \`${model}\`\n?? Key: \`${mask}\`\n?? 接口: \`${baseUrl ?? "使用默认/未修改"}\``
          )
        );
        break;
      }
      case "whois": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const keyword = interaction.options.getString("keyword", true);
        const results = deps.userIndex.search(keyword);
        const message = results.length
          ? deps.loc(locale, "?? Search Results:\n", "?? 查询结果：\n") +
            results
              .slice(0, 20)
              .map(([id, name]) => `\`${id}\` → **${name}**`)
              .join("\n")
          : deps.loc(locale, "? Not found.", "? 未找到。");
        await interaction.editReply({ content: message });
        break;
      }
      case "retrieve_history": {
        if (!deps.isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: deps.loc(locale, "? Permission denied", "? 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply();
        const limit = interaction.options.getInteger("limit", true);
        const startStr = interaction.options.getString("start_time");
        let beforeTime: Date | undefined;
        if (startStr) {
          const match = startStr.match(
            /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/
          );
          if (!match) {
            await interaction.editReply(
              deps.loc(
                locale,
                "? Format: 2023-12-01 15:30",
                "? 格式: 2023-12-01 15:30"
              )
            );
            return;
          }
          const [, y, mo, d, h, mi] = match;
          beforeTime = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+08:00`);
        }
        if (!channel.isTextBased()) {
          await interaction.editReply(
            deps.loc(locale, "? No read permission.", "? 无读取权限。")
          );
          return;
        }
        let messages: Message[];
        try {
          messages = await collectChannelHistory(channel, limit, beforeTime);
        } catch {
          await interaction.editReply(
            deps.loc(locale, "? No read permission.", "? 无读取权限。")
          );
          return;
        }
        messages = messages.filter(
          (message) => !message.author.bot || message.author.id === deps.getBotId()
        );
        if (!messages.length) {
          await interaction.editReply(
            deps.loc(locale, "? No messages retrieved.", "? 未抓取到任何消息。")
          );
          return;
        }
        const batches = Math.ceil(messages.length / 100);
        await interaction.editReply(
          deps.loc(
            locale,
            `? Retrieved ${messages.length} msgs, extracting in ${batches} batches...`,
            `? 已抓取 ${messages.length} 条，分 ${batches} 批提取...`
          )
        );
        let success = 0;
        for (let index = 0; index < messages.length; index += 100) {
          const slice = messages.slice(index, index + 100);
          const formatted: string[] = [];
          let lastId = "0";
          let lastTs = 0;
          for (const message of slice) {
            const nick =
              message.author.id === deps.getBotId()
                ? "[Stelle]"
                : await deps.userIndex.getOrCreateNickname(message);
            const { lines, authorId, ts } = await deps.formatMessage(
              message,
              nick,
              lastId,
              lastTs
            );
            lastId = authorId;
            lastTs = ts;
            formatted.push(...lines);
          }
          const ok = await deps.discordController.importHistoryBatch(
            channelId,
            formatted,
            `RETRIEVE-B${index / 100 + 1}`
          );
          if (ok) success += 1;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        await interaction.editReply(
          success
            ? deps.loc(
                locale,
                `? Trace complete! Success ${success}/${batches} batches.`,
                `? 追溯完毕！成功 ${success}/${batches} 批。`
              )
            : deps.loc(
                locale,
                "? Extraction entirely failed.",
                "? 提取全部失败。"
              )
        );
        break;
      }
      default:
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const content = deps.loc(
      interaction.locale,
      `? Internal Error: \`${message}\``,
      `? 内部错误: \`${message}\``
    );
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  }
}
