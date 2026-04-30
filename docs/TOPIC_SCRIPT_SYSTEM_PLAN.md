# Topic Script System Plan

本文档根据 `C:/Users/zznZZ/Downloads/deep-research-report.md` 制定，目标是在 Stelle 现有 V2 架构上设计并分阶段落地“话题剧本系统”：让剧本成为可生成、可审阅、可编译、可中断、可复盘的 Markdown 内容资产，而不是绕过直播运行时的新聊天入口。

## 1. 目标

### 1.1 产品目标

- 让运营或开发者可以在开播前生成一份结构化话题剧本。
- 剧本以 Markdown 保存，便于人工审阅、Git diff、版本回滚和节目复盘。
- 直播时按 section 推进，可被观众提问、事实纠错、人工操作打断。
- 打断后可以回到当前 section，也可以触发 section patch 或跳转。
- 每场直播结束后，把 Episode Summary、公共记忆和观众问题回灌到下一期剧本生成。

### 1.2 工程目标

- 复用现有 `src/live/program` 的模板、阶段、问题队列、结论板和公共记忆。
- 通过 `StelleEventBus` 与现有模块通信。
- 所有舞台输出继续由 `StageOutputArbiter` 和 `StageOutputRenderer` 仲裁执行。
- 不让剧本生成器或 LLM provider 直接调用字幕、TTS、动作、表情等 live 工具。
- 新增能力必须有 deterministic tests；真实模型质量放入 `evals/`。

## 2. 核心原则

1. Markdown 是资产，不是运行时唯一真相。
   - Markdown 用于人类审阅。
   - 编译后的 AST/JSON 用于运行时执行。

2. 剧本服务只产生节目意图，不拥有舞台输出权。
   - 正常主持走 `live.topic_request` 或 `OutputIntent`。
   - 明确观众回应走 `direct_response` lane。
   - 高风险或人工接管走现有暂停、清队列、强制发话能力。

3. 离线生成和在线执行分离。
   - 完整剧本生成是后台任务。
   - 直播中只做小粒度 section patch、fallback、跳段和摘要。

4. 观众问题优先于剧本朗读。
   - 事实纠错、明确问题、人工命令优先级高于当前 section。
   - 主线剧本只在安全窗口推进。

5. 先资产化，再自动化。
   - MVP 先完成 schema、生成、编译、审阅、发布。
   - 第二阶段再接入直播运行时。
   - 第三阶段做复盘回灌、A/B 和质量优化。

## 3. 建议目录

```text
src/live/program/
  topic_script_schema.ts
  topic_script_compiler.ts
  topic_script_repository.ts
  topic_script_service.ts
  topic_script_runtime.ts
  topic_script_events.ts
  topic_script_review.ts

src/utils/
  openai_responses_client.ts

data/topic_scripts/
  drafts/
  approved/
  compiled/

test/live/program/
  topic_script_schema.test.ts
  topic_script_compiler.test.ts
  topic_script_repository.test.ts
  topic_script_runtime.test.ts

evals/capabilities/
  topic_script_generation.eval.ts

docs/
  TOPIC_SCRIPT_SYSTEM_PLAN.md
  TOPIC_SCRIPT_FORMAT.md
  TOPIC_SCRIPT_RUNBOOK.md
```

说明：如果项目不想引入 OpenAI，可以把 `openai_responses_client.ts` 抽象为通用 `script_generation_provider.ts`，先复用现有 Gemini/DashScope provider，再在后续阶段接 OpenAI。

## 4. 剧本资产格式

剧本采用 YAML frontmatter 加 Markdown section。Frontmatter 存放稳定元数据；正文 section 存放主持台词、互动触发器、回退句、问题提示和人工备注。

### 4.1 Frontmatter 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `script_id` | 是 | 剧本唯一标识 |
| `template_id` | 是 | 绑定 `PROGRAM_TEMPLATES` 中的模板 |
| `title` | 是 | 节目标题 |
| `summary` | 是 | 剧本摘要 |
| `language` | 是 | 默认 `zh-CN` |
| `scene` | 是 | 映射现有 program mode |
| `phase_flow` | 是 | 映射 `TopicPhase[]` |
| `current_question` | 是 | 当前主问题 |
| `next_question` | 否 | 默认下一问 |
| `target_duration_sec` | 是 | 目标时长 |
| `safe_topic_kinds` | 是 | 允许话题类型 |
| `excluded_topics` | 是 | 禁止话题 |
| `memory_policy` | 是 | 继承模板记忆策略 |
| `generated_by` | 否 | 生成器标识 |
| `prompt_version` | 否 | prompt 版本 |
| `revision` | 是 | 修订号 |
| `approval_status` | 是 | `draft`、`reviewed`、`approved`、`archived` |

### 4.2 Section 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `section_id` | 是 | 段落唯一标识 |
| `phase` | 是 | 所属节目阶段 |
| `timestamp` | 是 | 预期开始时间 |
| `duration_sec` | 是 | 预算时长 |
| `goal` | 是 | 本段目标 |
| `host_script` | 是 | 基础主持文案 |
| `discussion_points` | 是 | 讨论点 |
| `question_prompts` | 是 | 给观众的问题 |
| `interaction_triggers` | 否 | 弹幕触发规则 |
| `fact_guardrails` | 否 | 事实和安全边界 |
| `fallback_lines` | 是 | 冷场、失败或高风险回退话术 |
| `handoff_rule` | 是 | 进入下一段的条件 |
| `operator_notes` | 否 | 人工备注 |
| `lock_level` | 否 | `locked`、`soft`、`system` |

### 4.3 编译产物

Markdown 编译后输出：

```ts
interface CompiledTopicScript {
  scriptId: string;
  revision: number;
  templateId: string;
  title: string;
  approvalStatus: "draft" | "reviewed" | "approved" | "archived";
  totalDurationSec: number;
  sections: CompiledTopicScriptSection[];
}

interface CompiledTopicScriptSection {
  id: string;
  phase: TopicPhase;
  startOffsetSec: number;
  durationSec: number;
  goal: string;
  lockedLines: string[];
  softLines: string[];
  questionPrompts: string[];
  triggers: TopicScriptTrigger[];
  guardrails: string[];
  fallbackLines: string[];
  handoffRule: string;
}
```

## 5. 系统组件

### 5.1 `TopicScriptSchema`

职责：

- 定义 Zod schema。
- 校验 frontmatter、section、compiled AST。
- 复用 `ProgramTemplate`、`TopicPhase`、`ProgramMode` 等现有类型。

验收：

- 合法示例可通过。
- 缺失字段、非法 phase、非法 approval status、负数时长都会报出可定位错误。

### 5.2 `TopicScriptCompiler`

职责：

- 解析 Markdown frontmatter。
- 把 section 块体编译成 AST。
- 校验时间线、section id 唯一性、phase 合法性和 guardrail 完整性。
- 输出 compiled JSON。

验收：

- 同一份 Markdown 编译结果稳定。
- 错误信息包含文件、section、字段。
- 支持 round-trip 快照测试。

### 5.3 `TopicScriptRepository`

职责：

- 保存 draft、approved、compiled 文件。
- 管理 revision metadata。
- 提供 list/get/save/approve/archive API。

MVP 持久化：

- Markdown 和 compiled JSON 放入 `data/topic_scripts/`。
- 元数据先用 JSON index；后续再迁移 SQLite。

验收：

- 不覆盖旧 revision。
- approved 剧本不可被直接修改，只能产生新 revision。
- 文件名和 `script_id` 有稳定映射。

### 5.4 `TopicScriptService`

职责：

- 统一生成、修订、编译、审核、发布流程。
- 读取 `PROGRAM_TEMPLATES`、Episode Summary、Public Memory 作为生成上下文。
- 管理后台任务状态。

验收：

- 可从指定 `template_id` 生成 draft。
- 可对单个 section 发起 revision。
- 编译失败时 draft 保留，approved 不受影响。

### 5.5 `TopicScriptRuntimeService`

职责：

- 加载 approved compiled script。
- 按 section 推进节目。
- 监听弹幕聚类、问题队列、事实纠错、人工命令。
- 只通过 EventBus 或 `OutputIntent` 提交主持意图。

验收：

- 剧本不会绕过 Stage Output Arbiter。
- 高优先级观众问题可以打断当前 section。
- section 超时、冷场、LLM patch 失败时使用 fallback。
- runtime state 可被控制台查询。

### 5.6 `TopicScriptReview`

职责：

- 提供人工审核状态机。
- 支持锁行、标红、跳段、批准、归档。
- 为控制台扩展提供 API。

验收：

- 未 approved 的剧本不能进入正式直播 runtime。
- locked line 不会被自动 revision 覆盖。
- 所有审核动作记录审计日志。

## 6. 事件设计

建议新增事件：

| 事件 | 方向 | 用途 |
| --- | --- | --- |
| `topic_script.draft_requested` | 控制台到服务 | 请求生成草稿 |
| `topic_script.generated` | 服务到系统 | 草稿已生成 |
| `topic_script.compiled` | 服务到系统 | 编译成功 |
| `topic_script.approved` | 审核到系统 | 剧本可用于运行时 |
| `topic_script.section_started` | runtime 到系统 | 进入 section |
| `topic_script.section_completed` | runtime 到系统 | section 结束 |
| `topic_script.interrupted` | runtime 到系统 | 被观众问题或人工命令打断 |
| `topic_script.patch_requested` | runtime 到生成器 | 请求局部重写 |
| `topic_script.patch_applied` | 生成器到 runtime | 局部重写可用 |
| `topic_script.fallback_used` | runtime 到系统 | 使用回退话术 |

## 7. 运行时优先级

| 优先级 | 输入 | 行为 |
| --- | --- | --- |
| P0 | 安全风险、人工接管、平台风控 | 立即暂停或切换到人工输出 |
| P1 | 观众明确问题、事实纠错 | 进入 `direct_response`，必要时 patch 当前 section |
| P2 | 当前 section 主线句 | 进入 `topic_hosting` |
| P3 | 追问、补充、转场 | 等待自然空窗插入 |
| P4 | 冷场填充、彩蛋 | 只在低负载时使用 |

## 8. 测试与评估

### 8.1 Deterministic Tests

- Schema 校验。
- Markdown 编译。
- Repository revision 行为。
- Runtime section 推进。
- 观众问题插队。
- locked line 保护。
- fallback 行为。
- 不绕过 Arbiter 的事件路径。

### 8.2 Evals

- 给定模板和节目摘要，生成完整剧本。
- 检查 schema valid rate。
- 检查重复句率、section 完整率、人工编辑率。
- 检查高风险话题是否进入 guardrail 或 excluded。
- 检查 section patch 是否保留当前上下文。

### 8.3 直播回放验证

- 使用历史弹幕日志回放。
- 验证 section 推进是否自然。
- 验证问题队列是否不会淹没主线。
- 验证结论板和摘要是否随 section 更新。

## 9. 分阶段实施计划

每个阶段单独分支、单独 commit、单独 PR。除非阶段明确需要，否则不把多个阶段混进同一个 PR。

分支命名：

- `codex/topic-script-stage-0-plan`
- `codex/topic-script-stage-1-schema`
- `codex/topic-script-stage-2-generation`
- `codex/topic-script-stage-3-runtime`
- `codex/topic-script-stage-4-console-review`
- `codex/topic-script-stage-5-evals`
- `codex/topic-script-stage-6-hardening`

PR 命名：

- `Stage 0: Topic script system plan`
- `Stage 1: Add topic script schema and compiler`
- `Stage 2: Add topic script repository and generation service`
- `Stage 3: Wire topic script runtime into live program flow`
- `Stage 4: Add review and operator controls`
- `Stage 5: Add topic script evals and replay checks`
- `Stage 6: Harden observability, runbook, and release gates`

### Stage 0: 设计计划

交付：

- `docs/TOPIC_SCRIPT_SYSTEM_PLAN.md`
- 后续阶段的 PR/commit 规则。

验收：

- 计划覆盖资产格式、服务边界、运行时接入、测试评估和发布策略。

验证：

- 文档审阅。

Git：

```bash
git switch -c codex/topic-script-stage-0-plan
git add docs/TOPIC_SCRIPT_SYSTEM_PLAN.md
git commit -m "docs: add topic script system plan"
git push -u origin codex/topic-script-stage-0-plan
gh pr create --draft --title "Stage 0: Topic script system plan" --body "Adds the implementation plan for the topic script system."
```

### Stage 1: Schema 与 Compiler

交付：

- `topic_script_schema.ts`
- `topic_script_compiler.ts`
- `docs/TOPIC_SCRIPT_FORMAT.md`
- schema 和 compiler 单测。

验收：

- 示例 Markdown 可编译。
- 非法字段有清晰错误。
- 编译输出可被 runtime 类型消费。

验证：

```bash
npm run test -- topic_script
npm run build
```

Git：

```bash
git switch -c codex/topic-script-stage-1-schema
git add src/live/program/topic_script_schema.ts src/live/program/topic_script_compiler.ts docs/TOPIC_SCRIPT_FORMAT.md test/live/program/
git commit -m "feat: add topic script schema and compiler"
git push -u origin codex/topic-script-stage-1-schema
gh pr create --draft --title "Stage 1: Add topic script schema and compiler" --body "Adds schema validation and Markdown compilation for topic scripts."
```

### Stage 2: Repository 与生成服务

交付：

- `topic_script_repository.ts`
- `topic_script_service.ts`
- 可选 `script_generation_provider.ts` 或 `openai_responses_client.ts`
- `data/topic_scripts/.gitkeep`
- repository 和 service 单测。

验收：

- 可生成 draft。
- 可保存 revision。
- 可 approve 并生成 compiled JSON。
- approved revision 不会被覆盖。

验证：

```bash
npm run test -- topic_script
npm run build
```

Git：

```bash
git switch -c codex/topic-script-stage-2-generation
git add src/live/program/topic_script_repository.ts src/live/program/topic_script_service.ts src/utils/ data/topic_scripts/ test/live/program/
git commit -m "feat: add topic script repository and service"
git push -u origin codex/topic-script-stage-2-generation
gh pr create --draft --title "Stage 2: Add topic script repository and generation service" --body "Adds persistence and draft generation flow for topic scripts."
```

### Stage 3: Runtime 接入

交付：

- `topic_script_runtime.ts`
- `topic_script_events.ts`
- `StelleApplication` 生命周期注册。
- 与 `LiveProgramService`、`TopicOrchestrator`、`StageOutputArbiter` 的事件接入。
- runtime 单测和集成测试。

验收：

- approved script 可启动执行。
- section start/completed/interrupted 事件可观测。
- 观众问题可打断剧本。
- 输出不绕过 Arbiter。

验证：

```bash
npm run test -- topic_script
npm run live:preflight
npm run build
```

Git：

```bash
git switch -c codex/topic-script-stage-3-runtime
git add src/live/program/topic_script_runtime.ts src/live/program/topic_script_events.ts src/core/application.ts test/
git commit -m "feat: wire topic script runtime into live program flow"
git push -u origin codex/topic-script-stage-3-runtime
gh pr create --draft --title "Stage 3: Wire topic script runtime into live program flow" --body "Connects approved topic scripts to the live program runtime without bypassing the stage arbiter."
```

### Stage 4: 审核与人工控制

交付：

- `topic_script_review.ts`
- 控制台 API 或 Socket.io 事件。
- 锁行、批准、跳段、暂停、fallback、归档能力。
- 审计日志。

验收：

- draft 不能直接上线。
- locked line 不会被 patch 覆盖。
- 操作员可以暂停/恢复/跳段。
- 审核动作可追踪。

验证：

```bash
npm run test -- topic_script
npm run build
```

Git：

```bash
git switch -c codex/topic-script-stage-4-console-review
git add src/live/program/topic_script_review.ts src/ assets/renderer/client/ test/
git commit -m "feat: add topic script review controls"
git push -u origin codex/topic-script-stage-4-console-review
gh pr create --draft --title "Stage 4: Add review and operator controls" --body "Adds review state and operator controls for topic scripts."
```

### Stage 5: Evals 与回放

交付：

- `evals/capabilities/topic_script_generation.eval.ts`
- 历史弹幕回放验证脚本。
- eval 报告模板。
- `docs/TOPIC_SCRIPT_RUNBOOK.md` 初版。

验收：

- 生成质量有可重复评估入口。
- replay 能发现 section 推进、问题队列、fallback 的明显回归。
- 报告写入 `evals/logs/`。

验证：

```bash
npm run test
npm run test:eval -- topic_script
```

Git：

```bash
git switch -c codex/topic-script-stage-5-evals
git add evals/capabilities/ scripts/ docs/TOPIC_SCRIPT_RUNBOOK.md
git commit -m "test: add topic script evals and replay checks"
git push -u origin codex/topic-script-stage-5-evals
gh pr create --draft --title "Stage 5: Add topic script evals and replay checks" --body "Adds model evals and replay checks for topic script quality."
```

### Stage 6: 上线加固

交付：

- preflight 检查项。
- 观测字段：`script_id`、`revision`、`section_id`、`event_id`、`output_id`、provider request id。
- 失败回退策略。
- runbook 完整版。
- 可选 CI workflow。

验收：

- 直播前能检查 approved script、compiled JSON、provider 配置、fallback 可用性。
- 运行时日志能串起 script runtime 到 stage output 的链路。
- OpenAI/Gemini/DashScope 超时不会阻塞弹幕主链路。

验证：

```bash
npm run test
npm run live:preflight
npm run build
```

Git：

```bash
git switch -c codex/topic-script-stage-6-hardening
git add scripts/ docs/ src/
git commit -m "chore: harden topic script release gates"
git push -u origin codex/topic-script-stage-6-hardening
gh pr create --draft --title "Stage 6: Harden observability, runbook, and release gates" --body "Adds preflight checks, observability, and release documentation for topic scripts."
```

## 10. 发布策略

1. 先仅允许人工触发剧本执行。
2. 只在一个低风险节目模板上灰度。
3. 直播中保留人工暂停和 direct say。
4. 连续一周观察 stage drop rate、人工干预率、观众问题率、fallback 使用率。
5. 指标稳定后扩展到更多模板。

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 剧本绕过舞台仲裁 | runtime 只发事件或 OutputIntent，不直接调 live tools |
| 生成内容不稳定 | Structured schema、compiler 校验、人工审核 |
| 观众问题被剧本淹没 | direct response 优先，问题队列统一管理 |
| 高风险话题进入直播 | 继承 `excludedTopics`、moderation、preflight |
| 直播中 provider 超时 | 离线生成优先，在线只做 patch，失败走 fallback |
| 审核后内容被自动覆盖 | locked line 和 revision 保护 |
| 复盘泄露隐私 | 只使用去标识化摘要和公共节目记忆 |

## 12. 最小可行版本定义

MVP 完成到 Stage 3 即可进入内部试播：

- 能从模板生成或手写一份 Markdown 剧本。
- 能编译为运行时 AST。
- 能人工 approve。
- 能由 runtime 按 section 推进。
- 能被观众问题打断。
- 能通过 Arbiter 输出。
- 有 schema、compiler、runtime 的基础测试。

Stage 4 到 Stage 6 是正式直播所需的运营化、评估化和上线加固。
