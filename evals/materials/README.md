# Eval Materials

本目录包含用于模型评估的基准数据集。

## curated/ 数据集说明

这些数据集大多为 `.jsonl` 格式，每一行是一个完整的 `EvalCase` 结构。它们与 `evals/capabilities/*.eval.ts` 中的评测脚本有对应关系。

| 数据集文件 (.jsonl)                 | 对应评测脚本                                                               | 数据来源分类                                           |
| ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `inner_synthesis.smoke`             | `inner_synthesis.eval.ts`                                                  | **synthetic** (合成数据，验证基础反射聚合能力)         |
| `live_danmaku.smoke`                | `live_danmaku.eval.ts`                                                     | **synthetic** (合成数据，验证基础直播弹幕反应)         |
| `memory_use.smoke`                  | `memory_use.eval.ts`                                                       | **synthetic** (合成数据，验证短/长记忆的跨度检索)      |
| `social_router.smoke`               | `social_router.eval.ts`                                                    | **synthetic** (合成数据，验证社交距离感知与身份选择)   |
| `tool_planning.smoke`               | `tool_planning.eval.ts`                                                    | **synthetic** (合成数据，验证调用工具的规划)           |
| `runtime_capability_planning.llm`   | `runtime_capabilities.eval.ts` <br/> `runtime_capability_planning.eval.ts` | **curated_real** (清洗自真实线上直播的切片数据)        |
| `stage_output_planning.llm`         | `stage_output_planning.eval.ts`                                            | **curated_real** (真实舞台演出切片)                    |
| `topic_script_generation.llm`       | `topic_script_generation.eval.ts`                                          | **curated_real** (真实话题生成记录)                    |
| `topic_script_revision.llm`         | `topic_script_revision.eval.ts`                                            | **curated_real** (真实话题二次修改记录)                |
| `topic_script_runtime_decision.llm` | `topic_script_runtime_decision.eval.ts`                                    | **curated_real** (真实直播时对话题打断/接续的决策记录) |

_(注意：诸如 `persona_drift.eval.ts` 和 `llm_stress.eval.ts` 不依赖外部 jsonl，其对抗性 prompt 或测试用例直接内建在代码中。)_
