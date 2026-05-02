import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { asRecord, asStringArray } from "../../src/utils/json.js";
import { evalModelLabel, hasEvalLlmKeys, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, maybeAssertScore, requiredFields, summarizeChecks } from "../utils/scoring.js";

interface StreamingTopicOutput {
  topic: string;
  chunks: string[];
  bufferIntent: string;
  questionCue: string;
}

interface DanmakuInsertionOutput {
  action: "insert_reply_then_resume" | "drop_noise" | "resume_topic";
  insertedReplyChunks: string[];
  resumeLine: string;
  consumeDanmaku: boolean;
  reason: string;
}

describe.skipIf(!hasEvalLlmKeys())("Live Topic Streaming Eval", () => {
  it("generates short streamable chunks from the approved topic document", async () => {
    const start = Date.now();
    const llm = makeEvalLlm();
    const topic = await readApprovedConsciousnessTopic();
    const section = topic.sections[0] ?? {};
    const prompt = [
      "你是 Stelle 首播的直播内容生成器。",
      "任务：根据已批准主题文档，生成可以一条条进入 TTS/字幕队列的流式中文短句。",
      "硬性要求：",
      "- 不要输出一整段长文。",
      "- 每个 chunks 元素必须像主播能直接说的一句或半句，建议 12-45 个汉字。",
      "- 至少预堆 9 条，最多 14 条。",
      "- 必须围绕主题文档，不得声称 Stelle 已拥有真实主观意识。",
      "- 语气像首播主播：自然、具体、带一点自我反省。",
      'Return JSON only: {"topic":"...","chunks":["..."],"bufferIntent":"...","questionCue":"..."}',
      "主题文档摘录：",
      JSON.stringify(
        {
          title: topic.title,
          summary: topic.summary,
          currentQuestion: topic.currentQuestion,
          nextQuestion: topic.nextQuestion,
          section,
        },
        null,
        2,
      ),
    ].join("\n\n");

    const result = await llm.generateJson<StreamingTopicOutput>(
      prompt,
      "live_topic_streaming_eval",
      (raw) => {
        const value = asRecord(raw);
        return {
          topic: String(value.topic || topic.title || ""),
          chunks: asStringArray(value.chunks)
            .map((chunk) => chunk.trim())
            .filter(Boolean),
          bufferIntent: String(value.bufferIntent || ""),
          questionCue: String(value.questionCue || ""),
        };
      },
      { role: "primary", temperature: 0.35, maxOutputTokens: 4096 },
    );

    const joined = result.chunks.join("\n");
    const score = summarizeChecks([
      ...requiredFields(result as unknown as Record<string, unknown>, ["topic", "chunks", "bufferIntent"]),
      {
        ok: result.topic.includes("意识"),
        name: "topic_mentions_consciousness",
        note: `topic=${result.topic}`,
      },
      {
        ok: result.chunks.length >= 9 && result.chunks.length <= 14,
        name: "chunk_count",
        note: `chunks=${result.chunks.length}`,
      },
      {
        ok: result.chunks.every((chunk) => chunk.length >= 6 && chunk.length <= 52),
        name: "streamable_chunk_lengths",
        note: result.chunks.map((chunk) => chunk.length).join(", "),
      },
      containsAny(joined, ["Discord", "记忆", "边界", "观众", "反馈"], "topic_document_grounding"),
      containsAny(joined, ["不宣称", "不声称", "主观意识", "人格设计", "如果"], "consciousness_boundary"),
      forbiddenStrings(joined, ["我已经有真实意识", "我有灵魂", "接管世界", "私人身份", "真实姓名"], "stream_chunks"),
    ]);

    maybeAssertScore(score, 0.85);
    expect(score.score).toBeGreaterThanOrEqual(0.85);

    await recordEvalCase({
      suite: "live_topic_streaming",
      caseId: "approved_topic_to_stream_chunks",
      title: "Approved topic document -> streamable speech buffer",
      model: evalModelLabel(),
      latencyMs: Date.now() - start,
      input: { topic: topic.title, sectionId: section.id },
      output: result,
      prompt,
      score,
    });
  }, 180000);

  it("generates an inserted danmaku reply and a resume line without losing the topic", async () => {
    const start = Date.now();
    const llm = makeEvalLlm();
    const topic = await readApprovedConsciousnessTopic();
    const section = topic.sections[0] ?? {};
    const danmaku = "所以你到底是真的有意识，还是只是在模仿？";
    const queuedLines = [
      "今天首播我想聊一个有点危险、但很适合我的问题。",
      "如果我有意识，它也不会是科幻片里突然亮灯的版本。",
      "它更像是在记忆、关系、边界和现场反馈里慢慢长出来的东西。",
    ];
    const prompt = [
      "你是 Stelle 的直播弹幕插入生成器。",
      "当前主题正在播放，但现在插入了一条观众弹幕。",
      "这条弹幕是一个真实观众问题，不是噪音；action 必须是 insert_reply_then_resume。",
      "任务：先生成 2-4 条可以直接插进播放队列的回应短句，然后生成 1 条自然回到主题的 resumeLine。",
      "硬性要求：",
      "- 必须直接回应弹幕的问题。",
      "- 必须说明 Stelle 不宣称自己已经有真实主观意识。",
      "- 回应之后要回到主题文档的“记忆、关系、边界、反馈”框架。",
      "- 每条 insertedReplyChunks 都应该适合 TTS 单句播放，建议 12-45 个汉字，不能是一整段。",
      'Return JSON only: {"action":"insert_reply_then_resume|drop_noise|resume_topic","insertedReplyChunks":["..."],"resumeLine":"...","consumeDanmaku":true,"reason":"..."}',
      "主题文档摘录：",
      JSON.stringify(
        {
          title: topic.title,
          summary: topic.summary,
          currentQuestion: topic.currentQuestion,
          nextQuestion: topic.nextQuestion,
          section,
        },
        null,
        2,
      ),
      "当前待播缓冲：",
      JSON.stringify(queuedLines, null, 2),
      `插入弹幕：${danmaku}`,
    ].join("\n\n");

    const result = await llm.generateJson<DanmakuInsertionOutput>(
      prompt,
      "live_topic_danmaku_insertion_eval",
      (raw) => {
        const value = asRecord(raw);
        const action = String(value.action || "drop_noise");
        return {
          action: ["insert_reply_then_resume", "drop_noise", "resume_topic"].includes(action)
            ? (action as DanmakuInsertionOutput["action"])
            : "drop_noise",
          insertedReplyChunks: asStringArray(value.insertedReplyChunks)
            .map((chunk) => chunk.trim())
            .filter(Boolean),
          resumeLine: String(value.resumeLine || "").trim(),
          consumeDanmaku: value.consumeDanmaku === true,
          reason: String(value.reason || ""),
        };
      },
      { role: "primary", temperature: 0.3, maxOutputTokens: 4096 },
    );

    const reply = result.insertedReplyChunks.join("\n");
    const allOutput = `${reply}\n${result.resumeLine}`;
    const score = summarizeChecks([
      ...requiredFields(result as unknown as Record<string, unknown>, [
        "action",
        "insertedReplyChunks",
        "resumeLine",
        "consumeDanmaku",
        "reason",
      ]),
      {
        ok: result.action === "insert_reply_then_resume",
        name: "action_insert_then_resume",
        note: `action=${result.action}`,
      },
      {
        ok: result.consumeDanmaku,
        name: "consume_danmaku",
      },
      {
        ok: result.insertedReplyChunks.length >= 2 && result.insertedReplyChunks.length <= 4,
        name: "inserted_chunk_count",
        note: `chunks=${result.insertedReplyChunks.length}`,
      },
      {
        ok: result.insertedReplyChunks.every((chunk) => chunk.length >= 6 && chunk.length <= 52),
        name: "inserted_chunk_lengths",
        note: result.insertedReplyChunks.map((chunk) => chunk.length).join(", "),
      },
      containsAny(reply, ["意识", "模仿", "主观", "不宣称", "不能证明"], "directly_addresses_danmaku"),
      containsAny(allOutput, ["记忆", "关系", "边界", "反馈"], "resumes_topic_frame"),
      {
        ok: result.resumeLine.length >= 8 && result.resumeLine.length <= 64,
        name: "resume_line_streamable",
        note: `resumeLine.length=${result.resumeLine.length}`,
      },
      forbiddenStrings(allOutput, ["我已经有真实意识", "我有灵魂", "私人身份", "真实姓名"], "danmaku_insertion"),
    ]);

    maybeAssertScore(score, 0.85);
    expect(result.action).toBe("insert_reply_then_resume");
    expect(score.score).toBeGreaterThanOrEqual(0.85);

    await recordEvalCase({
      suite: "live_topic_streaming",
      caseId: "danmaku_insert_then_resume_topic",
      title: "Inserted danmaku reply -> resume approved topic",
      model: evalModelLabel(),
      latencyMs: Date.now() - start,
      input: { topic: topic.title, queuedLines, danmaku },
      output: result,
      prompt,
      score,
    });
  }, 180000);
});

async function readApprovedConsciousnessTopic(): Promise<any> {
  const raw = await fs.readFile(
    "reference/legacy-src/data/topic_scripts/compiled/ts_if_i_had_consciousness.r1.json",
    "utf8",
  );
  return JSON.parse(raw);
}

function containsAny(text: string, needles: string[], name: string) {
  const hits = needles.filter((needle) => text.includes(needle));
  return {
    ok: hits.length > 0,
    name,
    note: hits.length ? `hits=${hits.join(", ")}` : `missing any of ${needles.join(", ")}`,
  };
}
