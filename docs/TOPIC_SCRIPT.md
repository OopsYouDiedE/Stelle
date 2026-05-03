# 话题剧本系统 (Topic Script System)

Topic Script 引擎是 Stelle 用于执行确定的播报、访谈和多阶段活动的控制机制。它结合了 Markdown 和 YAML，通过严格的阶段 (Section) 和应急方案 (Fallback) 来确保节目下限。

---

## 1. 剧本规范 (Topic Script Format)

话题剧本是一个含有 YAML frontmatter 的 Markdown 文件。

- **Frontmatter** 描述节目级别的全局元数据。
- **正文** 使用一级标题分隔不同的 Section，每个 Section 下用列表字段来精确定义该节点的执行目标与台词。

### Frontmatter 元数据

必填字段包括：

- `script_id` 与 `template_id` (关联的基础模板)
- `title` 与 `summary`
- `language` 与 `scene` (例如: reflection / talk_show)
- `phase_flow`: (例如: `[opening, sampling, summarizing, closing]`)
- `current_question`
- `target_duration_sec`: (目标持续时长)
- `safe_topic_kinds` 与 `excluded_topics`: (话题安全护栏)
- `memory_policy`: 结束后应如何生成记忆
- `revision` 与 `approval_status`: (`draft`, `reviewed`, `approved`, `archived`)

### Section 节点结构

每个阶段必须清晰定义：

- `section_id` 和 `phase`
- `timestamp` 和 `duration_sec`
- `goal`: (阶段执行的核心目的)
- `host_script`: (破冰开场的核心台词框架)
- `discussion_points`: (如果观众有反馈，引导的论点)
- `question_prompts`: (需要抛给观众的问题)
- `fallback_lines`: **(必须存在，如果 LLM 宕机或无弹幕，必须兜底播报的固定台词)**
- `handoff_rule`: (阶段推进的判断规则，如“收到至少 3 条观点或超时”)

可选字段：

- `interaction_triggers`: 特殊交互行为规则。
- `fact_guardrails`: 当前节点的特有事实护栏。
- `operator_notes`: 给运营人员看的笔记。
- `lock_level`: `locked`、`soft` 或 `system`，用于控制跳过权限，默认是 `soft`。

---

## 2. 线上运行手册 (Production Runbook)

### 2.1 开播前检查 (Preflight)

开启有剧本要求的直播前，必须使用 Preflight 命令验证剧本完备性：

```bash
npm run live:preflight
```

如果要强制确保没有通过审批的剧本就不准开播，需要在启动前注入：
`STELLE_TOPIC_SCRIPT_REQUIRED=true`
如果有任何 Section 缺失了 fallback_lines，或者找不到已批准的 compiled artifact，启动将被阻断。

### 2.2 运营中控指令 (Operator Controls)

运营人员可通过 Live Control Endpoint 发送 `topic_script.*` 动作干预演出：

| Action                          | 作用                                               |
| ------------------------------- | -------------------------------------------------- |
| `topic_script.snapshot`         | 抓取当前引擎快照。                                 |
| `topic_script.approve`          | 批准并锁定一份 Draft 的 revision。                 |
| `topic_script.load_latest`      | 重新挂载最新通过审批的剧本。                       |
| `topic_script.pause` / `resume` | 挂起/恢复脚本流。                                  |
| `topic_script.skip_section`     | 强制跳过当前节点。                                 |
| `topic_script.force_fallback`   | 强制系统丢弃思考，直接念当前节点的 fallback 救场。 |

_(注意：已经 Approved 的修订版是不可变的 (Immutable)。如需修改，请创建新的 draft，走编译审批后再覆盖。)_

### 2.3 异常与故障接管 (Failure Handling)

- **找不到获批剧本**：如果不强制依赖（`REQUIRED=false`），系统回退到自由漫谈模式。
- **找不到编译产物**：说明改了 Markdown 但没有构建，需要重新走 approve。
- **LLM 临时生成失败**：`TopicScriptService` 拥有兜底逻辑，它会返回一个安全的 template draft，绝不允许阻塞直播进程。
- **Live 途中发生服务商大面积宕机**：
  不要尝试在后台换 key 或 online patching。
  使用控制端触发 `topic_script.force_fallback`，结合操作员的直接接管 (manual output) 继续推进已获批的剧本骨架。

---

## 3. 可观测性追踪 (Observability)

当 Topic Script 介入时，相关的内部核心事件流会附带追踪 ID：

- Intent Payload 会夹带 `script_id`、`revision`、`section_id`。

**内核触发的生命周期事件**：

- `topic_script.section_started`
- `topic_script.section_completed`
- `topic_script.interrupted` (观众打断脚本流)
- `topic_script.fallback_used` (触发兜底)

**追踪链路**：
`topic_script_runtime` -> `StageOutputArbiter` -> `stage.output.started / completed`
