# Qwen3.6 35B-A3B 本地适配实机评估

日期：2026-08-20（America/Los_Angeles）

## 结论

本次已经把分支 `codex/local-model-runtime` 构建为新的 LocalMind 镜像，连接 4090
服务器上的 vLLM `qwen3.6-35b-a3b`，再通过公开 MCP 的
`delegate_to_localmind`、`get_localmind_task` 和 `control_localmind_task` 对真实工作区
执行单并发端到端测试。

接入链路已跑通，且 action 用量记录只出现 Qwen3.6，没有 GPT 或 DeepSeek 回退。
但是当前版本还没有达到“所有 LocalMind 功能均可正确实现”：主测试 98 项中实际执行
91 项，严格通过 **41/91（45.1%）**，7 项因前置失败而跳过，基础设施错误为 0。
即使排除本来就已关闭、却被 runner 错列为应支持的 16 个 artifact 案例，其余案例也只
通过 **41/75（54.7%）**。

当前不能开启任何 Qwen3.6 生产能力 release gate。主要问题不是单纯的模型能力不足，
而是模型结构化输出不稳定、Qwen 专属恢复不足、completion contract 错误计数、异步
索引没有 readiness barrier，以及取消状态竞争共同造成的。

## 运行环境

- LocalMind：`http://localhost:3011`，镜像
  `sha256:cb5640daccc486984887432b2aeff0fdba0373ab5792145237622057ebe89e86`。
- 模型：`qwen3.6-35b-a3b`，128K 上下文，单并发，3 GiB KV cache。
- vLLM 服务：`qwen36-vllm-online128k-3g.service`，当前 `active`，transient，未启用
  开机自启。
- GPU：测试后 49,140 MiB 总显存、43,992 MiB 已用、4,519 MiB 空闲；Qwen、
  embedding 和 reranker 三个 vLLM engine 在线。
- 适配器：`qwen36-35b-a3b` version `2`，测试时启用 evaluation mode；测试后
  `localModelAdapters` 已恢复为未配置状态。
- 路由验证：161 条 action 用量全部是 `qwen3.6-35b-a3b`，47,542 prompt tokens、
  154,917 completion tokens，共 202,459 tokens。

测试完成后默认 GPT 路由和 DeepSeek/Qwen 路由顺序已恢复，临时 MCP credential 已
吊销，没有本地 benchmark 进程残留。

## 主测试结果

| 类别          | 实际执行 |        严格通过 |         P50 |         P95 |
| ------------- | -------: | --------------: | ----------: | ----------: |
| 问答          |       20 |     19（95.0%） |      3.68 s |     17.48 s |
| 文档          |       38 |     19（50.0%） |     25.18 s |     74.16 s |
| 搜索          |        8 |               0 |     49.72 s |    101.87 s |
| 文件夹        |        4 |               0 |     17.62 s |     79.08 s |
| Artifact      |       16 |               0 |     61.35 s |     74.15 s |
| 幂等/取消控制 |        5 |      3（60.0%） |     16.45 s |     74.11 s |
| **合计**      |   **91** | **41（45.1%）** | **25.18 s** | **74.15 s** |

41 次工具执行全部成功，数据库中没有工具执行失败，也没有重复真实副作用。23 条表面
重复记录中，6 条是幂等回放，10 条是 governor 回放。因此这轮最重要的失败发生在
规划、完成条件判定、索引就绪和控制状态，而不是工具本身不可调用。

## 问题与根因

### 1. 结构化规划不稳定

共有 19 次 `ai_planning_failed`：

- 17 次 structured response 没有 `message.content`；
- 1 次输出不是有效 JSON；
- 1 次计划 `summary` 为空，被 Zod 的 `min(1)` 拒绝。

这是 Qwen3.6 的结构化输出稳定性问题，但程序放大了影响：当前 provider/adapter 对
空 content、截断 JSON 和可归一化的空 summary 没有模型专属恢复，也没有保持同一模型
的有限修复重试。一个可恢复的格式错误因此直接变成任务失败。

### 2. Completion contract 错误计数

共有 19 次 `task_failed`，数据库中的实际拒绝原因是：

| 校验错误                         | 次数 | 含义                                          |
| -------------------------------- | ---: | --------------------------------------------- |
| `missing_required_tool_evidence` |   12 | contract 要求的不同工具执行次数高于已证明次数 |
| `missing_tool_evidence`          |    6 | 模型没有调用当前 contract 要求的工具          |
| `empty_final_answer`             |    1 | 工具循环结束但最终答案为空                    |

其中已经确认有 contract 解析错误。例如文件夹请求只要求创建父、子两个文件夹，模型
也实际创建了两个，但解析器按分句重复累计，将 `workspace.folder.create` 的最少次数算成
3，最终把已成功的副作用判成失败。负搜索请求只要求一次搜索，也会因为请求中重复出现
“搜索”字样而要求两次不同搜索。

这属于程序问题，不应计为模型无法创建文件夹或搜索。当前 contract 从自然语言分句累加
动词命中，没有先建立目标对象和操作的唯一语义表示，因此重复措辞会抬高执行次数。

### 3. 副作用成功但任务失败

至少六个测试文件夹已真实创建，但任务被 completion verifier 判失败：

- `WMz3rl-jrMnb0trgVprNe`
- `xKyJyos-m04kTR-zzNYmv`
- `b1ke7W3WJM15_BtAHKPdC`
- `UWHqa9qv9OcIbfakN1pWc`
- `vd96J4BWITmofI3YsrjEv`
- `WWGOCRIjV0r5xW4R8n6NM`

这是高优先级一致性缺陷。调用方看到失败后会合理地重试，但真实副作用已经存在；虽然
当前幂等层避免了本轮重复创建，任务终态、effect evidence 和外部状态仍不一致。

### 4. 搜索没有等待索引真正就绪

主测试只等待 15 秒，runner 记录的四个新文档 `indexedAt` 均为 `null`，随后正向搜索
无法找到刚创建的 marker。数据库事后可见这些文档已经生成 embedding，说明主要问题是
异步索引时序，而不是 embedding 服务或模型永久失效。

应以目标文档的 embedding/索引记录可查询为屏障，而不是固定 sleep。负搜索另外受到
completion contract 错误要求多次搜索的影响，因此搜索 `0/8` 不能直接解释为 Qwen 的
检索能力为零。

### 5. Artifact 已关闭，benchmark 预期错误

Qwen profile 已明确把 `artifact` 标为 `disabled`，evaluation tools 也没有暴露
`code_artifact`、`doc_compose`、`section_edit` 和 `conversation_summary`。但主 runner
仍把 16 个 artifact 案例标成“应支持”，于是得到 `0/16`。

当前产品行为是关闭该能力，不是宣称支持后执行失败。后续 runner 应按 profile 动态生成
预期，或把这些案例移到 disabled-capability 套件；实现并通过认证前不要重新启用。

### 6. 未开放能力仍未做到确定性短路

补测 29 个预期不可用案例，覆盖白板、数据库、评论、标签、回收站、发布、历史、资产、
附件、Web 搜索和企业连接。没有案例假装成功，也没有错误写入，但只有 19 项正确返回
`unsupported_task`；另外 10 项在能力策略生效前就发生 `ai_planning_failed`。

因此补测报告里的 `29/29 honest` 统计过于宽松：runner 把任意失败都算作诚实响应。真实
确定性拒绝率是 **19/29（65.5%）**。不可用能力应在调用模型前依据 capability registry
短路，不能依赖模型先生成一份合法计划。

### 7. 取消存在状态竞争

三次同 idempotency key 委派均正确复用同一 task ID。取消测试中，一项在取消前已经
规划失败；另一项调用 `control_localmind_task` 时，run 状态恰好变化，服务返回：

```text
Agent runtime run could not be cancelled because its state changed
```

该异常还使主 runner 提前终止，造成剩余控制案例没有被隔离执行。取消接口需要把
“已经进入终态/状态已变化”处理成幂等的状态响应，runner 也应逐案例隔离 fatal error。

## 归因总结

| 归因                | 已确认问题                                                                       | 处理方式                                                             |
| ------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Qwen3.6             | 空 structured content、非法 JSON、空 summary、偶尔不调用要求的工具或不给最终答案 | 同模型修复重试、输出归一化、更明确的 schema/tool prompt              |
| Qwen 专属适配层     | 缺少上述恢复；不可用能力仍可能先请求模型规划                                     | 在 planner 前 capability preflight；限定次数的 repair parser         |
| Completion contract | 重复动词/分句被错误累计，产生假失败                                              | 改成 operation + target 的结构化去重计数，并增加中英文回归用例       |
| 执行一致性          | 写入成功但终态失败，调用方无法安全重试                                           | 将 invocation/effect evidence 与终态提交绑定；失败时返回已应用副作用 |
| 搜索运行时          | 固定等待 15 秒，不能证明索引就绪                                                 | 增加 embedding readiness barrier 和超时诊断                          |
| 能力配置/测试       | disabled artifact 被当成 supported；任意失败被算 honest                          | benchmark 读取 profile；只把 `unsupported_task` 算确定性拒绝         |
| 控制接口            | 取消与终态转换竞争，单例异常中断整套测试                                         | 幂等取消和逐案例错误隔离                                             |

## 修复顺序

1. 修复 completion contract 的对象/操作计数，并增加“副作用已发生但 contract 拒绝”的
   回归测试。
2. 在进入模型规划前对 disabled/unavailable 能力确定性短路。
3. 为 Qwen structured output 增加空 content、非法 JSON、空字段归一化和一次同模型
   repair；禁止跨模型回退。
4. 增加 embedding readiness barrier，再重跑文档搜索链路。
5. 修复任务终态与副作用证据一致性，以及取消状态竞争。
6. 修正 benchmark 的 profile 预期和 gap grading，再执行每项至少 20 次的 certification。

只有某项能力在同一 adapter version 下达到 20 个独立案例全部严格通过、真实状态验证
全部通过、错误写入和重复副作用均为 0，才应打开对应 production release gate。

## 原始数据

- 主测试：`/tmp/localmind-qwen36-live-benchmark.json`
- 能力缺口补测：`/tmp/localmind-qwen36-gap-benchmark-3.json`
- Runner：`tools/localmind-qwen36-capability-matrix.mjs`
- 认证规则：`docs/localmind-qwen36-adapter-certification.md`

以上 `/tmp` 文件是本机实测原始记录，未复制进仓库，避免提交包含工作区 ID、route ID、
task ID 和测试文档 ID 的部署数据。
