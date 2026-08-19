# LocalMind Qwen3.6 / GPT / DeepSeek 对比评测

日期：2026-08-18（America/Los_Angeles）

## 结论

Qwen3.6 已作为 LocalMind 的本地可选模型接入，模型 ID 为
`qwen3.6-35b-a3b`，GPT-5.6 Sol 仍为默认模型。两轮完整委派评测中，
Qwen3.6 都达到 6/8 集成分，与 GPT 的功能完成度相同；结构化回答质量
平均 7.5/10，低于 GPT 的 9/10，但核心文档任务明显更快。

当前不建议直接把全局默认从 GPT 切到 Qwen3.6。建议先把 Qwen3.6 用于
本地、隐私敏感和高频文档任务，同时修复搜索基础设施和重复工具调用。
DeepSeek 当前上游不稳定：第一轮 Atlas 请求失败，第二轮在首个请求阶段
出现网络级 `fetch failed`，因此本次不能给出可靠的当前质量分。

## 接入状态

- LocalMind profile：`qwen-lan`
- Endpoint：`http://192.168.20.207:8000/v1`
- Model：`qwen3.6-35b-a3b`
- Protocol：OpenAI Chat Completions
- vLLM：单并发、262,144-token 上限、FP8、language-only
- Tool parser：`qwen3_xml`
- 默认模板：`enable_thinking=false`
- LocalMind 默认模型：仍为 `gpt-5.6-sol`
- Qwen3.6：已加入可选模型列表和 workspace BYOK 路由

Qwen3.6 vLLM 当前是 transient systemd 服务，不会开机自启。LocalMind 的
配置和数据库路由已持久化，但 GPU 服务器重启后需要手动重新启动模型。

## 评测范围

两轮均使用相同输入和独立 marker，实际路由通过
`ai_usage_events.model` 核验。核心套件覆盖当前委派层的全部计划类型和
控制流程：

- `answer`：严格结构化中文回答；
- `tool_agent`：创建文档、搜索/读取文档；
- `document_update`：完整替换并读取快照验证；
- `get_localmind_task`：即时查询和长轮询；
- `control_localmind_task`：取消和幂等回放；
- `delegate_to_localmind`：提交和幂等回放。

Run IDs：`20260819054248`、`20260819054718`。

## 总体结果

| 模型                | 有效完整轮次 |       Atlas 质量 | 集成完成度 | 当前结论                         |
| ------------------- | -----------: | ---------------: | ---------: | -------------------------------- |
| GPT-5.6 Sol         |          2/2 |       9/10、9/10 |   6/8、6/8 | 最稳定、事实覆盖最好             |
| Qwen3.6 35B-A3B FP8 |          2/2 |       7/10、8/10 |   6/8、6/8 | 本地任务可用，速度最佳           |
| DeepSeek V4 Pro     |          1/2 | 0/10（上游失败） |        6/8 | 当前服务不稳定，第二轮未启动套件 |

集成分由创建、搜索/读取、更新/验证、取消四项组成，每项 2 分。三个模型
都因公共 embedding/search 上游返回 HTTP 502 而丢失搜索/读取的 2 分；
这不是 Qwen3.6 独有问题。

## 任务完成度

| 任务           | GPT | Qwen3.6 | DeepSeek            | 说明                                             |
| -------------- | --- | ------- | ------------------- | ------------------------------------------------ |
| 严格结构化回答 | 2/2 | 2/2     | 0/1，第二轮网络失败 | Qwen 格式正确但证据覆盖少于 GPT                  |
| 文档创建       | 2/2 | 2/2     | 1/1                 | Qwen 重复调用 `doc_create`，幂等层只创建一个文档 |
| 文档搜索/读取  | 0/2 | 0/2     | 0/1                 | embedding 502，且 folder list 不包含新建文档     |
| 精确文档替换   | 2/2 | 2/2     | 1/1                 | 三者都选中 `document_update`                     |
| 更新后精确验证 | 2/2 | 2/2     | 1/1                 | marker 均完全匹配                                |
| 取消任务       | 2/2 | 2/2     | 1/1                 | 均达到 `cancelled`                               |
| 幂等回放       | 2/2 | 2/2     | 1/1                 | delegate/control ID 均稳定                       |

DeepSeek 的 1/1 表示第一轮中对应任务执行成功，不代表两轮稳定性。

## 平均延迟

单位为秒，端到端包含 LocalMind 规划、队列执行和终态轮询。GPT/Qwen 为
两轮均值；DeepSeek 为唯一进入完整套件的第一轮。

| 任务       | GPT-5.6 | Qwen3.6 |     DeepSeek |
| ---------- | ------: | ------: | -----------: |
| Atlas 回答 |   9.044 |   6.923 | 13.563，失败 |
| 创建文档   |  13.865 |   4.527 |       16.001 |
| 搜索/读取  |  57.895 |  13.888 |       44.169 |
| 更新文档   |   4.577 |   2.887 |        5.054 |
| 验证更新   |   2.541 |   0.742 |        3.105 |
| 取消任务   |   4.789 |   2.681 |        4.438 |

Qwen3.6 在所有成功的核心任务上都比 GPT 快；创建约快 3.1 倍，验证更新
约快 3.4 倍。搜索延迟优势部分来自它更早放弃失败的 embedding 路径，
不能解释为更强的搜索效果。

## 输出质量

GPT 两轮均完整覆盖关键证据，严格遵守三行表格和三个行动项，Atlas 得分
稳定为 9/10。

Qwen3.6 两轮都生成了可用 Markdown 表格和行动项，但会省略部分数字证据，
例如 980/1000 TPS 或 2 人未完成导入；第一轮还使用了不需要的“结论：”
前缀。因此质量分为 7/10 和 8/10。它没有出现 Qwen3.8 曾有的一行化
Markdown 或规划失败，兼容性明显改善。

Qwen3.6 两轮都对同一参数重复发出工具调用，包括 `doc_create`、folder list、
semantic search 和 `doc_read`。写操作由 LocalMind 幂等保护，没有产生重复
文档，但读调用和失败重试会浪费延迟。该问题应在模型提示或工具循环层去重。

DeepSeek 第一轮 Atlas 在 provider 请求阶段失败，第二轮发生网络级失败；
虽然第一轮后续文档任务成功，当前可用性不足以支撑默认路由。

## Token 诊断

| 模型        | 平均完整轮次请求数 | 平均总 tokens |
| ----------- | -----------------: | ------------: |
| GPT-5.6 Sol |               16.5 |        35,333 |
| Qwen3.6     |                 12 |         4,525 |
| DeepSeek    |         12（单轮） |         6,511 |

不同提供方的 tokenizer、reasoning 计费和失败请求统计方式不同，不能把该表
直接作为成本对比。它仍说明 Qwen3.6 在本套件中没有出现异常长推理输出。

## 底层工具能力

| 工具类别                | 当前实现/环境              | 本次证据                                        |
| ----------------------- | -------------------------- | ----------------------------------------------- |
| `docCreate`             | 可用                       | 三模型动态通过                                  |
| `docRead`               | 可用                       | 动态调用成功；目标发现被搜索基础设施阻塞        |
| `docUpdate` / 精确替换  | 可用                       | 三模型动态通过                                  |
| `docUpdateMeta`         | 已实现                     | 本轮未单独做模型动态比较                        |
| `docSemanticSearch`     | 工具已实现，上游异常       | 三模型均收到 embedding HTTP 502                 |
| `docKeywordSearch`      | 当前不注册                 | `AFFINE_INDEXER_ENABLED=false`                  |
| `workspaceOrganization` | 已实现                     | list 动态执行；写操作有后端测试覆盖             |
| `codeArtifact`          | 已实现                     | prompt 路由单元测试通过，本轮未做三模型产物评分 |
| `docCompose`            | 已实现                     | prompt 路由单元测试通过，本轮未做三模型产物评分 |
| `sectionEdit`           | 已实现                     | 静态实现存在，本轮未做三模型产物评分            |
| `conversationSummary`   | 已实现                     | 委派没有持久会话上下文，不适合本套件直接比较    |
| `blobRead`              | 依赖会话附件               | 测试工作区未提供附件上下文                      |
| `webSearch`             | 当前不可用                 | 未配置 Exa Key                                  |
| `enterprise`            | CLI 已启用，无 ACTIVE 连接 | 当前连接均为 disabled 或 reauth-required        |

“已实现但未动态比较”不能视为模型效果通过。要对这些类别做公平三模型评分，
需要先准备固定附件、会话、Web Key、企业账号和可回滚的文件夹/文档 fixture。

## 验证

- 两轮真实 LocalMind Docker 端到端套件完成；
- Qwen3.6 原生 OpenAI tool-call 探针返回标准 `tool_calls`；
- LocalMind 与 Qwen `/health` 均返回 HTTP 200；
- `host-services.spec.ts`：57 tests passed；
- 数据库型 AVA 测试未运行：本机测试进程没有 `DATABASE_URL`，且
  `127.0.0.1:6379` 未暴露。运行中的 Docker E2E 使用实际 Postgres/Redis。

## 建议

1. 保持 GPT-5.6 Sol 为默认，Qwen3.6 作为本地/隐私任务的首选可选模型。
2. 修复 embedding 502，并让新建文档进入可搜索/可列举索引；这是当前唯一
   阻止所有成功模型达到 8/8 的共同问题。
3. 对 Qwen 工具循环增加相同 tool name + arguments 的成功调用去重。
4. 连续采集至少 20 轮 Atlas 和文档套件，再决定是否把 Qwen3.6 升为默认。
5. 为附件、Web、企业连接和高级产物工具建立固定 fixture 后，再补充完整的
   三模型质量评分。
