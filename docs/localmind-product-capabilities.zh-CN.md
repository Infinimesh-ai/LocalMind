# LocalMind 产品能力与 AFFiNE 差异总结

> 整理基线：2026-08-31
>
> 主线：`main`
>
> 本地模型专项分支：`codex/local-model-runtime`

## 1. 产品定位

LocalMind 基于 AFFiNE 的 local-first 文档、白板、同步、协作、桌面端和自托管
能力，进一步建设可执行、可持久化、可审批、可审计的 AI 办公运行时。

LocalMind 的目标不是给 AFFiNE 更换品牌或增加一个聊天入口，而是让 AI 能够在
明确权限和证据边界内读取知识、执行办公任务、记录运行过程，并支持管理员持续
运维和审计。

可以用下面的公式概括：

```text
LocalMind
  = AFFiNE local-first 工作区基础
  + 可执行、可审计的 AI Agent Runtime
  + 权限感知的长期上下文与记忆
  + 企业集成与 MCP 委托
  + 本地模型专项适配
```

## 2. 继承自 AFFiNE 的基础能力

LocalMind 保留并继续复用 AFFiNE 的主要产品基础：

- 页面文档、富文本编辑和 BlockSuite 编辑器；
- 白板和自由画布；
- 数据库、标签、集合和文档组织；
- local-first 数据、同步和多人协作；
- Web、Electron、Android 和 iOS 应用入口；
- 自托管服务端、工作区、成员和权限体系；
- AI Chat、文档上下文、Embedding 和模型 Provider 基础。

因此，页面、白板、数据库和跨端工作区属于 LocalMind 与 AFFiNE 共享的基础，
不应单独描述成 LocalMind 新增能力。LocalMind 的核心增量集中在 AI 运行、上下文、
授权、审计、集成和本地模型工程。

## 3. `main` 分支：LocalMind 产品主线

### 3.1 从 AI Chat 升级为持久化 Agent Runtime

- 将 AI 工作持久化为 Agent Run、Step 和 Timeline，而不是只保留一次请求或聊天结果；
- 持久化队列状态、Worker Lease、执行尝试、终态结果和取消请求；
- 支持排队、运行、完成、失败、取消、人工重试和过期租约恢复；
- Worker 通过租约和状态快照防止陈旧执行器覆盖新状态；
- 执行结果、Timeline 和 Side-effect Ledger 保留不可变证据；
- Admin 可以查看运行步骤、状态变化、失败原因、执行结果和已注册工作流 Adapter。

这使 LocalMind 的 AI 从“回答问题”扩展为“可以恢复、可以追踪、可以运维的办公任务”。

### 3.2 可执行的文档与工作区 AI

LocalMind AI 已经能够在权限范围内执行以下工作：

- 读取、新建、更新和改名文档；
- 关键词搜索和语义搜索；
- 完整文档组合、章节编辑和对话总结；
- 生成代码或 HTML 等产物；
- 网页搜索和网页内容抓取；
- 列出、新建、改名、移动和删除工作区文件夹；
- 将文档加入文件夹，或在文件夹之间移动文档；
- 从任务附件中读取有界文本或模型支持的媒体内容。

文档新建、更新和目录操作复用正常的工作区权限检查。重复请求通过稳定任务 ID、
稳定文档 ID、参数指纹和幂等回放机制避免产生重复写入。

当前尚未通过委托 Agent 执行白板、数据库/表格、任意二进制资产写入、评论、
协作和历史记录等能力；这些任务会明确返回 `unsupported_task`。

### 3.3 AI Context、Rule 与 Automatic Memory

LocalMind 增加了完整的个人 AI 上下文管理能力：

- **Rule**：长期约束回答格式、风格、边界和工作方式；
- **Automatic Memory**：从对话中保存稳定偏好、事实和决定；
- **Context Project**：把一组文档组织为明确的项目上下文边界；
- **Project Summary**：保存当前用户在特定项目中的稳定背景；
- **Rolling Summary**：压缩长对话的早期内容，保留当前会话上下文。

Automatic Memory 支持 `ADD`、`UPDATE`、`DELETE` 和 `NOOP` 决策，并记录事实键、
置信度、重要性、有效期、敏感性、版本替代、Embedding 和使用历史。用户可以查看、
编辑、停用、删除、撤销和回滚相关内容。

Rule 支持独立应用模式、条件、优先级、不可变修订、命中历史和回滚。Workspace
Policy 与用户私人 Rule/Memory 分层处理，私人内容不会被提升为系统级指令。

### 3.4 权限感知的知识检索

- 在搜索和排序前检查 `Doc.Read`，无权文档不会因为相关度高而进入 AI 上下文；
- 工作区、项目、文档和用户作用域分别隔离；
- 多项目或含糊的多文档范围默认 fail closed，不会扩大到整个工作区；
- 检索结合关键词、Embedding、时间、置信度、重要性、Rerank 和 MMR 多样性；
- 每个 Owner/Scope 的活跃 Automatic Memory 有明确容量上限和 LRU 淘汰；
- Planning Trace 只记录策略、候选 ID、分数、预算和指纹，不保存私人上下文正文。

### 3.5 文档快照与更新提醒

每个 AI 对话保存开始读取时的文档快照，使历史回答不会因为源文档后来变化而被
静默改写。文档保存新版本后，AI Chat 会提示用户新建对话并重新选择文档。

提示可以针对当前版本关闭；文档再次保存后会重新出现。切换到旧对话不会刷新其
原始快照。这一机制兼顾了历史回答可复现性和新内容可发现性。

### 3.6 DB-backed AI Registry 与模型路由

LocalMind 将以下 AI 配置建设为数据库支持的 Registry/State：

- Prompt Registry；
- Model Registry；
- Provider Registry；
- Task Route Policy；
- Provider Health State 与 Probe Attempt。

这些 Registry 支持工作区优先级、全局回退、版本发布、幂等复用、来源链、指纹、
发布事件和 Admin 诊断。运行时会真实读取这些记录，而不是只在界面展示诊断字段。

Provider Health 可以执行本地合同检查，也可以通过部署开关运行真实最小文本探测。
健康状态会参与 Provider 路由，`down` 的 Provider 可以被排除，恢复后重新进入路由。

### 3.7 精确 BYOK 模型绑定与本地 Provider

- 服务端和 Electron 本地 BYOK Key 可以绑定一个明确模型 ID；
- 一个 Key 只对其绑定模型贡献运行时能力；
- OpenAI-compatible Key 测试会实际请求指定模型，而不只检查 `/models`；
- 模型改变后必须重新测试才能保存；
- 使用记录保留真实准备路由和请求模型，便于后续审计；
- `openaiCompatible` Provider 已支持 vLLM，并可标记 `privacy: "local"`。

这为本地大模型接入提供了通用 Provider、模型注册、路由和健康检查底座。

### 3.8 审批式 Repair Execution

LocalMind 提供面向 AI 配置与运维修复的受控执行流程：

- Repair Preview 和 Preflight；
- 权限检查与审批状态；
- BullMQ 队列和 Worker Lease；
- 自动重试、人工取消、人工重试和陈旧租约恢复；
- Side-effect Ledger 和完整 Audit Event；
- 对 Prompt、Model、Provider 和 Task Route Registry 的受限发布。

已批准的修复不会直接在 GraphQL Resolver 中执行，而是进入持久化队列。Worker 在
写入前重新检查租约、请求快照和 Executor Payload，防止并发漂移或绕过审批。

### 3.9 持久化 Support Bundle

LocalMind 的 AI 运维支持包包含：

- 持久化请求、Manifest 和归档 Artifact；
- 工作区、操作者、来源证据和 Fingerprint；
- 短期下载授权与一次性 Token Fingerprint；
- API 代理下载和对象存储签名 URL；
- 定时保留期清理、对象删除、失败重试和升级记录；
- Transfer Event、Forwarding Queue、Worker Lease、Dead Letter 和人工 Replay；
- 完整的创建、读取、下载、清理和转发审计历史。

支持包内容有界并经过脱敏，避免把 Token、API Key、完整私密 Prompt 或无必要的
文档正文带入运维归档。

### 3.10 Workspace MCP AI 委托

LocalMind 对外提供工作区绑定的 MCP AI 接口：

| 工具                          | 作用                           |
| ----------------------------- | ------------------------------ |
| `upload_localmind_attachment` | 上传与任务绑定的不可变附件     |
| `delegate_to_localmind`       | 提交完整自然语言任务           |
| `get_localmind_task`          | 查询持久化任务状态、结果和产物 |
| `control_localmind_task`      | 仅取消尚未完成的任务           |

主要安全边界包括：

- 创建任务时冻结 MCP Credential 的能力上限；
- 规划、执行、查询和取消时重新检查用户实时 ACL；
- 查询和控制仅允许创建任务的 Credential Family；
- Credential 轮换可以延续任务访问，吊销会阻止后续执行；
- 附件绑定工作区、用户和 Credential Family，并校验大小与 SHA-256；
- 同一个任务的重复委托、文档创建和取消保持幂等；
- 可选终态通知使用 HMAC 签名、持久化 Outbox、Worker Lease 和有限重试。

调用方只提交完整任务，不直接调用底层 `doc_create`、`doc_update` 等工具，从而避免
绕过 LocalMind 的 Planner、Agent Runtime、权限和审计边界。

### 3.11 企业微信、飞书和钉钉集成

LocalMind 已实现企业协作 CLI 的第一阶段能力：

- 企业微信、飞书和钉钉的用户级独立连接与凭据目录；
- LocalMind 设置页内的扫码、OAuth 或设备授权流程；
- 云端 BullMQ 授权 Worker；
- 工具 Schema 发现、只读风险识别和工具白名单；
- 最多 32 个已启用只读工具进入一次模型上下文；
- 命令、参数、Profile、超时和输出大小限制；
- 参数指纹、结果指纹、资源引用和执行状态审计；
- 内置 AI 与 MCP 委托 Agent 共用同一 `ToolRuntime` 企业工具类别。

企业平台目前作为 LocalMind AI 的出站数据源和操作目标，不作为聊天机器人入口。
写操作尚未开放给模型；下一阶段需要实现绑定用户、连接、工具、参数指纹和有效期的
独立确认票据。

### 3.12 SparkClaw 与 ISCP 集成

- Workspace Settings 可以管理出站 SparkClaw MCP 连接；
- 一次性 Access Ticket 不持久化，MCP Session 使用 AES-GCM 加密保存；
- 支持工具目录、显式 Allowlist、连接测试、禁用、删除和审计；
- 固定服务端 Endpoint 与协议，防止数据库漂移把请求重定向到任意地址；
- ISCP Controller 支持 SparkClaw 配对和主动通知链路；
- 入站 LocalMind MCP 与出站 SparkClaw MCP 保持独立的凭据和权限模型。

### 3.13 Admin AI 运维界面

Admin 可以查看和操作：

- Agent Run、Step、Timeline 和 Execution Result；
- Repair Execution、审批、重试和取消；
- Prompt/Model/Provider/Task Route Registry 版本；
- Provider Health State、Probe Attempt 和 Dead Letter Retry；
- Support Bundle、下载授权、清理、转发和 Replay；
- Registry Publish/Reused Event 与来源链证据。

这让 LocalMind 的 AI 状态从后台日志提升为可扫描、可筛选、可操作的运维界面。

### 3.14 产品、性能与自托管优化

相对于继承的 AFFiNE 基础，`main` 还包含以下 LocalMind 优化：

- LocalMind 品牌、应用名称、Deep Link、桌面更新源和跨端标识；
- Web 冷启动文档加载优化；
- 非关键编辑器依赖延迟加载，减少初始加载成本；
- 自托管 AI 请求防阻塞和响应压缩；
- 文件夹链接去重和安全移除，避免错误删除真实文档；
- Realtime 自动重连、转录任务和对象存储链路加固；
- 移动端设置布局和跨端兼容性修复；
- 固定 `dev-base`、`test`、`local` 三类 Docker 镜像角色，减少重复构建和磁盘消耗。

### 3.15 PDF 与 Office 内容转换

工作区 `Import` 已支持把常见办公文件转换为普通可编辑 LocalMind 页面：

- 带文本层的 PDF `.pdf` 转换为标题、段落和分页分隔；管理员显式启用 OCR 后，
  没有文本层的扫描页经 LocalMind 后端转发到允许的 OCR 服务，并把识别 Markdown
  与原生文本页合并为可编辑页面；
- Word `.docx` 正文转换为页面内容；
- Excel `.xlsx` 工作表转换为可编辑表格；
- PowerPoint `.pptx` 幻灯片标题、正文和表格转换为页面内容。

转换后的页面可继续编辑，并通过浏览器打印链路导出为 PDF。此能力不会覆盖用户
选择的源文件，也不等同于 PDF 或 Office 原格式在线编辑；固定页面排版、复杂 Word
布局、Excel 图表/宏/公式行为以及 PowerPoint 主题/动画/媒体可能无法保留。扫描版
PDF OCR 默认关闭、一次最多处理 100 个扫描页，并需要人工复核识别结果；Office
原格式在线编辑仍属于后续能力。

## 4. `codex/local-model-runtime`：本地模型专项分支

`codex/local-model-runtime` 完整包含当前 `main`，并额外增加本地模型 Adapter、
模型路由锁、能力认证和 Qwen3.6 运行时加固。该分支的重点不是“把 OpenAI-compatible
地址接入 LocalMind”，而是让一个具体本地模型在 Agent 工作流中可控、可验真、可认证。

### 4.1 Qwen3.6 35B-A3B 精确适配

- 专属 Adapter ID：`qwen36-35b-a3b`；
- 精确匹配 `qwen3.6-35b-a3b` 和 `qwen3.6-35b-a3b-fp8`；
- 声明 131,072 token 上下文窗口；
- 其他模型通过 `passthrough` Adapter 保持通用 Provider 行为；
- 当前 Qwen3.6 Adapter Version 为 `9`。

模型名称只有精确匹配时才会命中专项逻辑，避免把未经验证的其他 Qwen 或兼容模型
误当成 Qwen3.6 认证版本。

### 4.2 Model Route Lock

Qwen3.6 规划阶段只选择一次 Provider 和 Model，并将以下信息持久化：

- Provider、Provider Profile 和来源；
- 请求模型、响应模型和锁定模型；
- Route Fingerprint；
- Adapter ID、Version 和运行模式。

后续 Answer Repair、文档渲染、工具执行和嵌套模型调用都复用同一路由锁。委托规划
禁止模型回退，防止表面上宣称“本地执行”，实际在中途切换到云端 GPT 或其他模型。

### 4.3 Qwen 专属能力矩阵

当前 Adapter 分别管理以下能力状态：

| 能力                   | 当前状态      | 说明                             |
| ---------------------- | ------------- | -------------------------------- |
| 普通问答               | `testing`     | 基础问答可用，仍等待完整认证     |
| 文档读取               | `testing`     | 已接入真实 `doc_read`            |
| 文档创建               | `testing`     | 有幂等保护和写后验证             |
| 文档更新               | `testing`     | 要求完成证据和状态验证           |
| 文档标题更新           | `testing`     | 要求 ID 解析和更新后读取         |
| 文档搜索               | `testing`     | 继续解决索引就绪和输出稳定性     |
| 工作区文件夹           | `testing`     | 覆盖目录及文档放置操作           |
| `text/plain` 附件      | `testing`     | 已接入，生产认证仍未完成         |
| Artifact               | `disabled`    | 当前嵌套 Artifact 执行未达到要求 |
| Web/企业连接           | `unavailable` | 实测环境缺少对应 Executor 或连接 |
| 白板/数据库/评论等能力 | `unavailable` | 尚未桥接到当前委托工具运行时     |

测试模式只开放可评估工具；生产模式只开放同时满足 `enabled` 和 Release Gate 的能力。
当前没有任何 Qwen3.6 工具能力通过生产门禁。

### 4.4 Qwen 专属 Planner 与输出修复

- 在调用模型前识别明确不支持的任务并确定性返回 `unsupported_task`；
- 对文档和文件夹任务建立可解析的 Operation/Target 需求；
- 阻止模型用错误工具替代未支持操作；
- 处理空 Structured Content、非法 JSON、空字段和严格格式偏差；
- 对短答案、精确行数、文档标题和指定 Marker 提供确定性格式修复；
- Repair 继续使用同一 Qwen 模型和 Route Lock，不跨模型兜底。

### 4.5 Completion Contract 与副作用验真

Qwen3.6 的完成状态不以最终文本为准，而以确定性 Completion Contract 为准：

- 每项请求映射为必须出现的工具、操作数量和 Effect Evidence；
- 重复表述先按操作和目标处理，避免重复词语抬高执行次数；
- 相同工具和参数的重复证据只计算一次；
- 文档和文件夹写入必须有真实 Effect Evidence；
- 最终答案为空、缺少工具证据或缺少副作用证据时不能标记完成；
- 任务不能仅凭“已经创建”“已经更新”等模型文字声明完成。

这层约束用于解决本地模型常见的“工具已经调用但终态错误”或“没有执行却文字声称
完成”等一致性问题。

### 4.6 Tool Governor

- 对已成功的相同工具和参数调用进行去重；
- 限制单个调用指纹和单个工具的重复失败次数；
- 限制一次任务的总工具执行次数；
- 文档更新前要求先读取目标文档；
- 规范根目录 `parent_folder_id` 等 Qwen 常见参数格式；
- 区分真实副作用、幂等回放和 Governor Replay；
- 持久化调用 ID、参数指纹和有界执行证据。

因此，即使模型重复发出 `doc_create` 或文件夹操作，也不会自动造成重复真实写入。

### 4.7 附件的 Fail-closed 边界

Qwen3.6 生产附件能力目前只考虑完整提取的 `text/plain`：

- MIME 必须精确匹配 `text/plain`；
- 必须存在完整 `extracted_text`；
- 截断文本会被拒绝；
- 图片、音频、PDF、其他二进制内容和 Provider-native Bytes 暂不作为已认证能力；
- Planner 和 Worker 会独立检查相同边界。

这避免了模型从未实际读取附件，却把任务报告为成功。

### 4.8 分能力生产认证

Qwen3.6 Adapter 带有独立 Certification Runner。每个待发布能力至少执行 20 个
独立案例，并要求：

- 所有案例严格通过；
- 文档或文件夹写入后独立读取真实状态验证；
- False Success 为 0；
- Duplicate Real Side Effect 为 0；
- Cross-model Fallback 为 0；
- 所有 Action Usage 都指向锁定的 Qwen3.6 模型；
- Adapter Version 与认证版本完全一致；
- 路由、配置和测试 Credential 能完整恢复；
- 认证结果生成 SHA-256 Fingerprint，且不会自动修改生产 Gate。

这套门禁意味着 LocalMind 不会因为模型端点健康或少量 Demo 成功，就直接宣称全部
Agent 能力可用于生产。

### 4.9 实机验证现状

Qwen3.6 35B-A3B 已经完成真实 vLLM、真实 LocalMind、真实工作区和公开 MCP 的
端到端接入。实机记录证明：

- Qwen3.6 路由可以贯穿规划、队列、工具调用和任务查询；
- 一轮评测中的 161 条 Action Usage 均为 Qwen3.6，没有 GPT 或 DeepSeek 回退；
- 已执行的 41 次工具调用全部成功，未产生重复真实副作用；
- 文档创建、更新、取消和幂等链路已有动态成功证据。

同时，扩大后的全能力评测也发现结构化规划、完成条件、索引就绪和取消竞争等问题。
因此当前 Qwen3.6 能力仍处于 `testing`、`disabled` 或 `unavailable`，生产 Release
Gate 尚未开启。宣传材料应使用“完成专项适配和实机验证，正在逐能力生产认证”，
不应使用“所有 LocalMind 功能已经由 Qwen3.6 完整支持”。

## 5. 下一版本候选功能

> 本节为产品与工程路线，尚不是已经交付的功能。

### 5.1 Office 原格式在线编辑

下一版本计划评估把 Word `.docx`、Excel `.xlsx` 和 PowerPoint `.pptx` 建设为
工作区中的一等文件：用户首次上传或创建后，可以直接在 LocalMind Web 中编辑并
自动保存源格式文件，不再重复执行“下载、修改、重新上传”。

目标能力包括：

- 接入可自托管的 Office Web 编辑器，首选评估 ONLYOFFICE，并通过 Provider
  抽象保留后续接入 Collabora Online 的能力；
- 为 Office 文件建立稳定文件 ID、不可变修订、当前版本指针和版本恢复能力，
  每次保存生成新的 Blob 修订，不原地覆盖历史内容；
- 复用工作区读取与写入权限，使用短期编辑会话和服务端保存回调，并记录打开、
  保存、冲突和恢复等审计事件；
- 在 `All docs`、附件块和独立全宽编辑页面中提供编辑、只读、保存状态、版本历史、
  下载以及“转换为 LocalMind 页面”等操作；
- 同一编辑会话支持协作编辑，外部版本变化通过条件更新和冲突提示处理，不采用
  最后写入静默覆盖；
- 在线编辑优先支持已同步或自托管工作区；纯浏览器本地工作区继续使用现有
  “转换为 LocalMind 页面”能力，桌面端本地源文件回写另行设计。

首期不包含旧版二进制 `.doc`、`.xls`、`.ppt`、Office 宏执行、完整离线编辑或
浏览器静默覆盖任意本地磁盘文件。正式实施前还需要完成编辑器许可、部署拓扑、
数据驻留、回调安全、CSP、并发保存和版本保留策略评审。

### 5.2 Qwen 3.8 Flash 专项适配

下一阶段计划将现有模型 Adapter 架构扩展到 **Qwen 3.8 Flash**，目标包括：

- 建立独立的模型 ID 匹配、Adapter Version 和 Capability Profile；
- 针对其 Structured Output、Tool Call 和 Thinking 行为调整 Planner；
- 建立独立 Completion Contract、格式修复和 Tool Governor 参数；
- 重点验证低延迟问答、摘要、翻译、结构化抽取、知识检索和高频文档任务；
- 对复杂写操作继续使用权限检查、幂等、副作用证据和逐能力 Release Gate；
- 不直接继承 Qwen3.6 的认证结果，每个 Adapter Version 独立认证。

Qwen 3.8 Flash 的产品目标不是简单替换默认模型，而是作为更低延迟的本地执行层，
优先承接隐私敏感、高频、可验证的办公任务。

### 5.3 ModelScope 与 vLLM 一键部署

计划提供统一的本地模型编排入口：

```text
yarn localmind:model preflight
yarn localmind:model discover
yarn localmind:model download
yarn localmind:model serve
yarn localmind:model configure
yarn localmind:model up
yarn localmind:model status
yarn localmind:model stop
```

目标能力包括：

- 使用 ModelScope SDK 查找已有缓存，缺失时下载固定 Revision；
- 扫描本机已有模型并验证快照完整性；
- 生成模型 Manifest，记录来源、Revision、路径和配置 Fingerprint；
- 管理 vLLM 启动、健康检查、日志、锁和受控停止；
- 配置 LocalMind OpenAI-compatible Provider；
- 从 LocalMind 容器检查模型 Endpoint 可达性；
- 执行最小文本、Structured Output 和 Tool Call 探测；
- 支持 `--dry-run`、`--yes`、`--json` 和超时控制；
- 失败时保留模型缓存和 LocalMind 数据，不删除 Docker Volume。

当前仓库已经完成这一方案的需求分析和设计，但一键脚本尚未实现。

### 5.4 本地模型任务路由

后续可根据认证结果按任务选择模型：

- Qwen 3.8 Flash：低延迟问答、摘要、翻译、抽取和高频办公任务；
- Qwen3.6 35B-A3B：长上下文、本地知识读取和通过认证的文档任务；
- 更强云端或本地模型：复杂推理和高难度规划；
- 独立 Embedding/Rerank 模型：工作区索引和检索排序。

聊天模型不会自动覆盖 Embedding 和 Rerank 路由。模型只有通过相应能力探测和认证后，
才能进入对应任务的默认或候选路由。

### 5.5 后续扩展方向

- Qwen 3.8 Flash 以及更多 Qwen/国产开源模型 Adapter；
- Spark GX10、RTX 4090 等不同硬件的受验证运行 Profile；
- 本地 Embedding、Reranker 和多模型端口管理；
- 多 GPU、Tensor Parallel 和模型并存；
- 模型升级、蓝绿端口切换和健康回退；
- Admin 本地模型状态、显存、延迟和一键探测界面；
- 质量、延迟、Token、显存、长上下文和副作用安全的统一模型评测。

## 6. 相对 AFFiNE 的核心差异

| 维度       | AFFiNE 基础              | LocalMind 增量                                       |
| ---------- | ------------------------ | ---------------------------------------------------- |
| 产品定位   | local-first 知识工作区   | 可执行、可审计的 AI 办公工作区                       |
| AI 状态    | 对话和普通 AI 调用       | Run/Step/Timeline/Lease/Result 持久化运行时          |
| AI 行为    | 内容辅助和聊天           | 队列任务、文档执行、取消、恢复和副作用证据           |
| 长期上下文 | 文档与会话上下文         | Rule、Automatic Memory、Project、滚动摘要和作用域    |
| 配置管理   | Provider/Prompt 基础配置 | DB-backed Registry、版本发布、健康状态和审计         |
| 运维修复   | 常规配置与日志           | Preview、Preflight、审批、Worker 和 Side-effect      |
| 外部 Agent | MCP 基础能力             | 工作区绑定的 AI 委托、任务查询、取消和签名通知       |
| 企业集成   | 通用工作区协作           | 企业微信、飞书、钉钉、SparkClaw 和 ISCP              |
| 运维证据   | 常规日志和诊断           | Support Bundle、归档、签名下载、转发和 Replay        |
| 本地模型   | 通用 Provider/BYOK       | vLLM 路由、精确模型绑定和模型专项 Adapter            |
| Qwen3.6    | 无 LocalMind 专属语义    | Route Lock、Completion Contract、Governor 和认证门禁 |
| 管理界面   | 通用 Admin               | AI Runtime、Registry、Health、Repair 和 Bundle 运维  |

## 7. 可直接用于宣传材料的文案

### 7.1 一句话版本

> LocalMind 在 AFFiNE 的 local-first 工作区基础上，将 AI 升级为可执行、可追踪、
> 可审批、可审计的办公运行时，并通过 Qwen3.6 35B-A3B 专项适配，为本地化、
> 隐私敏感和高频知识工作提供可靠的模型执行底座。

### 7.2 标准介绍

LocalMind 继承 AFFiNE 的文档、白板、协作、同步和自托管能力，同时增加持久化
Agent Runtime、长期 Rule 与 Automatic Memory、数据库化 AI Registry、审批式
Repair Execution、MCP AI 委托、企业协作平台连接和完整运维审计。

在 `local-model-runtime` 分支中，LocalMind 进一步针对 Qwen3.6 35B-A3B 建设了
模型路由锁、能力矩阵、结构化输出修复、Completion Contract、工具调用 Governor、
副作用验真和逐能力生产认证。它不是简单接入一个本地模型 API，而是让本地模型在真实
办公 Agent 工作流中做到边界明确、结果可验证、失败可追踪。

下一阶段，LocalMind 计划专项适配 Qwen 3.8 Flash，并建设 ModelScope、vLLM 与
LocalMind 的一键部署和多模型任务路由，让更多隐私敏感、高频和低延迟办公任务能够在
本地完成。

### 7.3 宣传要点

- **不是只有 AI Chat**：任务可以排队、执行、取消、恢复和审计；
- **不是只有向量搜索**：Rule、Memory、Project 和权限共同决定上下文；
- **不是只有模型配置**：Prompt、Model、Provider、Route 和 Health 都有持久版本；
- **不是直接暴露底层 API**：外部 Agent 通过 LocalMind Planner 和 Runtime 委托任务；
- **不是把 vLLM 接上就结束**：Qwen3.6 拥有专属 Adapter、完成契约和认证门禁；
- **不是用 Demo 代替生产证明**：每项能力都要求真实状态验证和零重复副作用；
- **下一步面向 Qwen 3.8 Flash**：继续推进低延迟本地 Agent 和一键模型部署。

## 8. 状态边界

为了保持宣传内容准确，应明确区分以下状态：

### 已在 `main` 实现

- Agent Runtime、Repair Execution、Support Bundle 和 DB-backed Registry；
- Rule、Automatic Memory、Context Project 和权限感知检索；
- MCP 委托、附件、任务查询、取消和签名终态通知；
- 企业微信、飞书和钉钉只读集成；
- SparkClaw/ISCP 集成；
- BYOK 精确模型绑定和通用 vLLM Provider 基础；
- Admin AI 运维界面及多项产品、性能和自托管优化。

### 已在 `codex/local-model-runtime` 实现

- Qwen3.6 35B-A3B 专属 Adapter；
- Route Lock、Capability Profile 和 Production Gate；
- Qwen 专属 Planner、输出修复、Completion Contract 和 Verifier；
- Tool Governor、调用去重和副作用证据；
- Qwen3.6 Certification Runner 和实机端到端评测。

### 尚未完成

- Office `.docx`、`.xlsx`、`.pptx` 原格式在线编辑、自动保存与版本历史；
- Qwen3.6 Adapter v9 的全部生产能力认证和 Release Gate 开放；
- Qwen 3.8 Flash 专属 Adapter；
- ModelScope/vLLM/LocalMind 一键部署脚本；
- 本地模型 Admin 生命周期管理；
- 企业平台写操作确认票据；
- 白板、数据库、评论、协作和历史等委托 Agent Executor。

## 9. 参考资料

- [LocalMind AI Modernization](./ai-modernization/README.md)
- [LocalMind Branch Differences](./ai-modernization/branch-differences.md)
- [Current State](./ai-modernization/current-state.md)
- [Next Goals](./ai-modernization/next-goals.md)
- [LocalMind 用户使用指南](./localmind-user-guide.zh-CN.md)
- [LocalMind MCP 中文指南](./localmind-mcp.zh-CN.md)
- [LocalMind 企业协作 CLI 接入](./localmind-enterprise-cli-integration.md)
- [Qwen3.6 / GPT / DeepSeek 对比评测](./localmind-qwen36-benchmark-2026-08-18.md)
- [Qwen3.6 大样本完成度评测](./localmind-qwen36-completion-benchmark-2026-08-19.md)
- [本地模型一键启动方案记录](./localmind-modelscope-vllm-bootstrap.zh-CN.md)
