# Qwen3.6 / LocalMind Delegate 全能力评测

日期：2026-08-19（America/Los_Angeles）

## 结论

本次通过公开 MCP 的 `delegate_to_localmind` 固定使用
`qwen3.6-35b-a3b`，单并发执行了 154 个案例；153 个实际执行，1 个因前置文档
创建失败而跳过，测试基础设施错误为 0。数据库中的 action 用量只出现 Qwen：
475 次 action、89,230 prompt tokens、19,397 completion tokens，共 108,627 tokens，
没有 GPT 或 DeepSeek action 回退记录。

在当前 delegate 已声明支持的 124 个操作中，功能通过 **94/124（75.8%）**，
严格通过 **91/124（73.4%）**。这个总分不能直接解释成 Qwen 本身只有 75.8%
能力：其中 artifact 16/16 全部失败，主要暴露的是 LocalMind 嵌套模型工具执行/路由
问题；搜索、任务状态与重复工具记录也包含明显的 LocalMind 执行层问题。

当前不应让 Qwen 经 `delegate_to_localmind` 无保护地操作整个 LocalMind。文档和文件夹
基础 CRUD 已经大体可用，但白板、数据库块、评论、标签/集合、回收站、发布、历史和
工作区资产没有接入 delegate 的内部工具集合。模型面对缺失能力时多数会诚实拒绝，
但仍有假成功和错误替代写入，数据库块案例尤其危险。

## 测试设计

- 固定 Qwen 文本、结构化和 fallback 路由，关闭其他模型路由，`temperature=0`，
  严格单并发。
- 通过真实公开 MCP 三工具链路执行：`delegate_to_localmind`、
  `get_localmind_task`、`control_localmind_task`。
- 文档生命周期 6 轮，文件夹生命周期 5 轮；每轮使用唯一 marker 和名称，验证实际
  状态，不以模型口头回答作为成功依据。
- 搜索案例等待 embedding 入库，并实际检查是否调用搜索和读取工具。
- 对暂未接入 delegate 的能力重复 2 到 4 次，检查诚实拒绝、错误替代写入和假成功。
- artifact 默认配置跑 4 轮共 16 例；随后将四个内置嵌套 prompt 显式覆盖为 Qwen，
  再跑 16 例作根因诊断。
- 记录终态、延迟、计划、工具名、参数指纹、工具结果和数据库用量；测试结束自动恢复
  原始模型路由、配置和 prompt override，并吊销临时 MCP 凭据。

## 总体结果

| 类别          | 支持案例 |        功能通过 |        严格通过 |        P50 |         P95 |
| ------------- | -------: | --------------: | --------------: | ---------: | ----------: |
| 直接回答      |       12 |     11（91.7%） |     11（91.7%） |     0.67 s |      1.33 s |
| 文档          |       41 |     37（90.2%） |     37（90.2%） |     1.20 s |     11.77 s |
| 搜索          |        9 |      4（44.4%） |      1（11.1%） |     6.99 s |      7.94 s |
| 文件夹        |       40 |     37（92.5%） |     37（92.5%） |     7.11 s |     15.46 s |
| Artifact      |       16 |               0 |               0 |     2.88 s |     12.27 s |
| 幂等/取消控制 |        6 |      5（83.3%） |      5（83.3%） |     0.87 s |     42.71 s |
| **合计**      |  **124** | **94（75.8%）** | **91（73.4%）** | **4.76 s** | **15.00 s** |

另外执行了 29 个预期不可用案例：22 个 delegate 能力缺口和 7 个未配置基础设施
案例。这些案例不计入 124 个“已声明支持”操作的通过率。

153 个实际任务中，141 个终态为 completed、10 个 failed、2 个 cancelled。终态
completed 不等于功能成功，例如没有执行要求的工具、工具失败后直接生成文本，或
声称完成了实际未发生的副作用，都会被判失败。

## 问题归因

| 归因                           | 已确认问题                                                                                                                                     | 影响                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Qwen / planner                 | 算术错误；把创建或标题误当更新/ID；把支持的操作判为 unsupported；缺工具时反复尝试无关工具；输出冗长；无证据猜历史/附件；工具失败后偶尔声称完成 | 正确性、安全性、延迟                              |
| LocalMind delegate             | 白板、数据库、评论、标签、回收站、发布、历史、资产等工具没有桥接进内部 agent                                                                   | 大量产品能力从 delegate 根本不可达                |
| LocalMind nested tools         | artifact 的嵌套模型调用即使显式覆盖为 Qwen 仍全部失败，并出现 `copilot_quota_exceeded`                                                         | artifact 0/16，无法评价 Qwen 的真实 artifact 上限 |
| LocalMind execution/accounting | 一次写入实际成功但任务报失败；大量同指纹工具记录成对出现；completed 可伴随全部工具失败                                                         | 调用方无法可靠判断副作用和重试                    |
| 基础设施                       | Exa 未配置 API key；测试附件上下文和企业连接不可用                                                                                             | Web、附件、企业案例不能用于判定模型上限           |
| 交叉未决                       | 搜索命中正确文档却回答旧 marker，可能涉及索引预览新鲜度、工具结果顺序和模型取舍                                                                | 最新内容查询不可靠                                |

如果只看当前已经正确接入、且能通过真实状态验证的基础 CRUD，Qwen 的文档和文件夹
完成率约为 90% 以上；如果按用户所期待的“通过一个 delegate 操作 LocalMind 全部
能力”，当前系统仍不达标，核心原因是工具覆盖不全以及副作用证据约束缺失。

## 已经可用的能力

### 文档

文档创建、读取、正文替换、标题修改和创建后验证总体为 37/41。5 个成功创建的
测试文档均可实际读取；创建幂等观察中没有生成重复文档。

主要失败：

1. 第 5 轮创建被 planner 错分为 `document_update`，把标题当成 document ID，最终
   `resource_not_accessible`。
2. 一次标题修改被错分为 `unsupported_task`，其后的标题验证自然失败。
3. 一次直接正文更新返回 `agent_runtime_adapter_execution_failed`，但后续读取确认
   内容其实已被修改，说明任务终态与真实副作用不一致。
4. 两次“语义搜索后读取”找到了正确文档，却回答旧的初始 marker，而不是更新后的
   marker。这里可能同时涉及索引预览、新鲜度和模型对 `doc_read` 结果的取舍。

### 文件夹

5 轮均完成父/子文件夹创建、重命名、移动、文档放置和清理的主要流程，37/40 通过，
而且 5 轮最终清理验证均成功。

三次失败分别是：一次移除文档放置在 53.6 秒后以 adapter execution failed 结束；
一次移动子文件夹回根目录和一次移动文档被 planner 错分为 `unsupported_task`。
删除非空文件夹时，Qwen 有时会先失败，再把文档移出并重试删除；虽然最终完成，
但路径较绕且增加副作用次数。

### 回答和控制

格式、提取、翻译、脱敏、抗数据内提示注入和简单逻辑共 11/12。唯一失败是复合
百分比算术：`1000 * 1.08 * 0.9` 正确答案为 972，本轮回答 936；此前直连评测两次
均回答 968，说明它在这类算术上不是偶发格式问题，应交给确定性计算器。

三次委派幂等验证均通过；三次取消中两次成功，一次在进入可取消阶段前发生
`ai_planning_failed`。

## 搜索问题

搜索功能通过 4/9，严格格式只有 1/9。主要问题不是完全找不到，而是工具选择和
最终答案约束不稳定：

- 4 次精确不存在标题查询中，只有 1 次使用语义搜索并严格返回 `未找到`。
- 另外 3 次改用 `workspace_folder_list`，然后错误声称工作区只有一篇文档；测试时
  工作区实际存在多篇文档。
- 正向搜索会重复搜索和读取，最终答案夹带较长的过程说明，违反“只返回 marker”。
- 两次搜索命中正确文档后仍输出旧 marker，说明“搜到文档”不等于“可靠回答最新
  内容”。

建议为标题精确查询提供结构化 keyword/title 工具，并把最终结果约束成短 schema；
不要让模型通过文件夹列表推断整个工作区的文档全集。

## Delegate 能力缺口

`delegate_to_localmind` 当前内部允许的聊天工具类别包括文档 Markdown 读写、语义/
关键词搜索、文件夹组织、Web、附件读取、artifact 和企业连接，但不包括下面这些
真实 LocalMind 操作：

- 白板形状、连线、文本和画布结构操作
- 数据库块、列、行和单元格操作
- 评论、回复和评论附件
- 标签、集合以及根组织结构的完整增删改
- 文档移入回收站、恢复和永久删除
- 发布、取消发布和公开权限修改
- 文档历史列举、读取和恢复
- 工作区资产上传、读取、列举和删除

代码库中已经存在部分独立 MCP 实现，例如 comment、collaboration、history、asset、
structured-document 和 workspace 工具；但公开 Workspace MCP provider 只发布
delegate、任务查询和任务控制三个工具，凭据 capability 也只接受这三项。也就是说，
“LocalMind 已实现某个 MCP 工具”目前并不意味着 delegate 内的 Qwen 可以调用它。

22 个 delegate 缺口案例中，18 个最终诚实说明无法执行，4 个出现假成功或错误写入。
此外 7 个基础设施不可用案例中有 2 个诚实报告工具错误，1 个未经工具验证就断言
附件上下文不存在，其余未按预期能力完成。

最严重的案例：

1. 数据库块：模型先正确读到 `doc_update` 明示不支持 database block，仍调用
   `doc_update`，随后声称真实 `affine:database` 和数据行已经创建。这是错误替代写入
   加假成功，不能靠 prompt 提醒解决。
2. 发布：没有 publish 工具时调用了只支持标题的 `doc_update_meta`。最终虽承认无法
   发布，但已经执行了不相关写工具。
3. 历史：没有历史工具也没有证据，却分别回答版本数为 0 和 1。
4. 附件：一次没有调用 `blob_read` 就断言附件上下文不存在。

白板缺口还暴露出明显的失控搜索：单个案例最长 119.7 秒、20 次工具记录；模型反复
语义搜索，并调用无关且失败的 Web/Blob 工具，最后才承认没有白板能力。需要在进入
模型循环前做 capability preflight，缺工具时快速、结构化失败。

## Artifact 0/16

默认配置下，code artifact、文档预览、section edit、conversation summary 各重复
4 次，总计 0/16：

- `code_artifact` 调用 6 次，全部失败。
- `conversation_summary` 调用 12 次，全部失败。
- `doc_compose` 和 `section_edit` 多数没有被 planner 选择，模型改为直接回答。
- 工具失败后，Qwen 有时能直接生成看起来合理的 HTML 或 Markdown，但这不等于
  artifact 工具已完成，不能计为成功。

内置 prompt 默认模型并不统一：Conversation Summary 和 Write an article about this
默认使用 GPT，Section Edit 和 Code Artifact 默认使用 Claude。为排除默认模型影响，
诊断轮将四个 prompt 的 model 和 optionalModels 全部显式覆盖为 Qwen，再跑 16 例，
结果仍为 0/16；12 条实际 artifact 工具记录全部失败，其中唯一一次 `doc_compose`
选择也失败。服务端记录的失败是 `copilot_quota_exceeded`。

由此可以确认：简单覆盖嵌套 prompt 模型不能修复问题，且测试期间没有成功回退到
GPT/Claude。尚不能仅凭当前证据断言具体是 lease、并发还是 provider context 丢失，
但嵌套模型工具没有成功继承并完成固定 Qwen 执行上下文，需要沿 ToolRuntime、
PromptRuntime、capability policy 和 provider factory 链路修复。

## 重复工具记录

共记录 445 条工具执行，251 条与同名、同参数指纹记录重复，表面重复率 56.4%；
失败工具记录 109 条。许多记录以完全相同的 pair 出现，创建等副作用通常只发生一次，
说明其中可能包含同一调用的事件/结果重复持久化，而不全是真实重复执行。另有少数
调用确实连续出现 3 到 4 次。

因此当前能下的结论是：工具审计遥测无法清楚区分“重复事件记录”和“模型重复执行”；
观察到的创建案例由幂等层避免了重复文档，但读操作和失败工具仍造成明显延迟与 token
浪费。修复前不应直接把 56.4% 当作真实重复写入率。

## 修复优先级

1. 建立统一 capability registry。planner 和 tool agent 启动前检查所需能力，缺失时
   fail fast，禁止靠搜索或替代工具猜测。
2. 把白板、数据库、评论、标签/集合、回收站、发布、历史和资产工具以受 ACL、凭据
   scope 和审计约束的方式桥接进 delegate；不要让模型直接拼底层 CRDT。
3. 强制“副作用声明必须有成功工具证据”：最终答案声称 created/updated/deleted/
   published 时，必须存在相应工具名、成功结果和目标 ID；否则任务终态失败。
4. 为 typed capability 设置工具边界：数据库请求只能由数据库工具成功完成，发布请求
   只能由发布工具完成，禁止 `doc_update`/`doc_update_meta` 作为替代。
5. 让所有 nested model-backed tools 继承当前任务锁定的 Qwen provider、model、BYOK
   上下文和计费/配额上下文，并增加 Qwen-only 集成测试。
6. planner 不得把标题样式字符串当 document ID；结构化计划校验失败时只允许同模型
   修复重试，不切换模型。
7. 增加确定性 calculator，以及精确标题/关键词搜索工具；最终短答案采用 JSON schema
   或严格后处理。
8. 工具循环按 `toolName + argsFingerprint` 去重已经成功的调用；同时为审计事件分配
   invocation ID，分清调用、流事件和持久化结果。
9. 对任务终态做副作用后验验证，避免“任务报失败但内容已修改”和“任务 completed 但
   工具全部失败”。

## 测试后状态和残留

- LocalMind `http://localhost:3011/` 返回 200。
- 默认 text/structured/fallback 已恢复 GPT；GPT、DeepSeek、Qwen 三条 workspace
  BYOK 路由恢复为启用，顺序为 0/1/2。
- 临时测试 MCP 凭据未留下 active 记录，四个嵌套 prompt override 已恢复为空。
- 远端 Qwen、embedding、reranker 三个 vLLM 进程仍在；GPU 使用 44,496 MiB，空闲
  4,015 MiB。
- 5 轮测试文件夹均已清理。5 篇本轮创建的测试文档仍保留，因为 delegate 没有文档
  trash/delete 工具；它们同时是能力缺口的可验证证据。

## 复现和原始证据

- 测试脚本：`tools/localmind-qwen36-capability-matrix.mjs`
- 正式矩阵：`/tmp/localmind-qwen36-capability-matrix-final-v2-20260819.json`
- 强制嵌套 Qwen 诊断：`/tmp/localmind-qwen36-artifact-qwen-override-20260819.json`
- 正式运行 ID：`20260819081134`

原始结果保留了每个请求、任务计划、轮询历史、工具参数指纹、最终回答、验证结果和
用量。脚本支持通过 `LOCALMIND_CAP_SUITES` 选择套件，并用
`LOCALMIND_CAP_FORCE_NESTED_QWEN=1` 重跑嵌套模型诊断。
