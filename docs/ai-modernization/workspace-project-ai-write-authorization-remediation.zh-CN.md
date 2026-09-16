# Workspace/Project AI 写入授权与工具作用域重构方案

> 状态：代码修复与验证已完成；按用户指令，本次不部署运行环境
>
> 日期：2026-09-15
>
> 范围：普通 Workspace AI 写入授权、目录操作、Agent Runtime、MCP 委托、Office
> 写入，以及 Workspace/Project 模型可见工具命名与持久化契约切换
>
> 不包含：索引服务不可用问题

实施内容与验证证据见[实施记录](workspace-project-ai-write-authorization-remediation.execution.zh-CN.md)。

## 1. 结论

本次修复一次性完成两项收敛：

1. 删除所有把“目标资源的潜在读者必须只有当前操作者本人”作为普通 Workspace AI
   写入放行条件的限制。
2. 将 Workspace 与 Project 的模型可见工具改为显式作用域名称，并按会话类型严格注册，
   不再让两类会话共享 `doc_create`、`doc_update` 等含糊名称。

普通 Workspace 的 AI 操作采用与正常 UI 相同的授权原则：

> 用户明确要求执行某项操作，且该用户此刻能在正常 UI 中对同一目标执行同一操作，
> AI 就可以执行；不因目标存在其他读者而追加人工审批或来源门禁。

来源、上下文和受众证据仍可用于审计、诊断和 Project 跨边界检查，但不能再取代普通
Workspace 的实时 ACL，也不能成为普通 Workspace 写入的第二套权限系统。

## 2. 已验证的真实故障

`2026-09-14｜member-02｜工作日志` 的故障已经证明当前规则错误：

- 文档成功创建，正文完整写入；
- 创建账号仍是 Workspace 的有效成员，并对文档拥有显式 `owner` 权限；
- 目标月份目录没有额外拒绝策略，目录权限按默认值允许读取、写入和组织；
- 后续任务能够成功搜索、读取该文档，并确认正文无需再次更新；
- 失败的操作只是把既有文档挂入目标文件夹；
- 拒绝审计已经记录 7 个来源，但目标 Workspace 有 5 名潜在读者，因此被判定为
  `unshared_source`。

该拒绝发生在真实 Workspace、文档和目录 ACL 检查之前。因此，错误信息不能证明用户
缺少文档或目录权限，也不应提示用户去网页补齐并不存在的“来源关系权限”。

同一次 MCP 任务中新建并立即挂载之所以有时成功，是因为当前实现对“当前 request、
run、worker lease 中刚创建的准确 documentId”提供临时豁免。任务结束后，创建回执不能
用于下一次任务；重新读取既有文档也不会获得该豁免。这造成同一用户、同一文档、同一
目标目录因调用时间和执行路径不同而得到不同结果。

## 3. 根因

### 3.1 普通 Workspace 的来源门禁等价于“仅私人目标可写”

当前普通 Workspace 的判定核心是：

```text
allowed =
  目标受众已知
  AND 目标不是公开资源
  AND 目标受众未超预算
  AND 每一名潜在读者都等于当前操作者
  AND 来源未超预算
```

这没有判断来源是否属于当前 Workspace、用户是否拥有 `Doc.Update`、目标目录是否允许
组织，也没有使用已记录的普通 Workspace 文档来源建立有效授权。只要 Workspace 中存在
第二名潜在读者，AI 写入就可能失败。

它不会阻止其他成员通过网页直接操作，但会让 AI 在多人 Workspace 中近似退化成只能写
私人目标，与协作产品定位冲突。

### 3.2 来源门禁位于真实 ACL 之前

目录工具当前先执行 `withAiSourceCheck`，再进入以下真实检查：

- `Workspace.Sync`；
- `Workspace.Organize.Read`；
- `Doc.Read`、`Doc.Update`、`Doc.Trash`、`Doc.Restore` 或 `Doc.Delete`；
- 目录的 `canRead`、`canWrite`、`canOrganize`、`canCreateFolder`；
- 目标存在性、目录层级、版本、幂等和 Trash 状态。

因此来源门禁既没有增强真实 ACL，反而会在真实 ACL 有机会给出准确结果之前误拒绝。

### 3.3 相同门禁散落在多条写入路径

该限制不仅影响目录挂载，还存在于以下路径：

- Workspace 文档正文和标题更新；
- Workspace 文件夹创建、重命名、移动、排序、删除、回收站和恢复；
- 添加已有文档、移动文档和移除目录位置；
- Agent Runtime 文档更新的准备与执行；
- 直接或委托 MCP 文档写入；
- Office 单命令和批量命令；
- structured document 和 workspace data 写入；
- Web AI 与工具循环外层的重复来源检查。

只修目录工具或只增加一个豁免会继续保留调用路径差异，不能解决根因。

## 4. 目标授权模型

### 4.1 普通 Workspace

普通 Workspace 操作的最终授权由以下条件共同决定：

```text
允许执行 =
  当前用户明确提出了相应写操作
  AND 会话/委托凭据允许使用该工具
  AND 当前用户仍拥有目标 Workspace 的实时访问权
  AND 当前用户拥有该资源和目录操作对应的实时 ACL
  AND 输入、版本、状态和幂等条件成立
  AND 操作没有违反不可逆操作保护
```

以下条件不得再参与普通 Workspace 的允许/拒绝判定：

- 目标是否只有当前操作者一名潜在读者；
- 来源受众是否与目标受众完全相同；
- 文档是否在当前任务内刚刚创建；
- 当前任务是否持有特殊“挂载回执”；
- 会话是昨天还是今天创建；
- 目标是否属于多人 Workspace。

### 4.2 UI 等价权限矩阵

| 操作                     | 必须检查的实时权限/条件                                                 | 是否额外人工审批      |
| ------------------------ | ----------------------------------------------------------------------- | --------------------- |
| 创建 Workspace 文档      | Workspace 创建/同步权限、目标目录写入权限                               | 否                    |
| 更新正文或标题           | `Doc.Update`、版本/冲突检查                                             | 否                    |
| 创建文件夹               | `Workspace.Sync`、父目录 `canCreateFolder`/`canWrite`                   | 否                    |
| 重命名、移动、排序文件夹 | `Workspace.Sync`、相关目录 `canWrite`/`canOrganize`                     | 否                    |
| 添加已有文档到文件夹     | `Doc.Read`、`Workspace.Sync`、目标目录组织权限                          | 否                    |
| 移动或移除文档目录位置   | `Doc.Read`、`Workspace.Sync`、源/目标目录组织权限                       | 否                    |
| 移入回收站、恢复         | 对应 Trash/Restore 权限及目录权限                                       | 否                    |
| 永久删除                 | `Doc.Delete` 或对应目录权限、已在回收站、准确目标校验、明确永久删除意图 | 保留明确确认/意图保护 |
| Office 内容编辑          | 对应 Artifact/文档更新权限、预期版本和命令约束                          | 否                    |

可逆目录操作不设置 LocalMind 特有审批。永久删除、权限变更、成员管理、跨边界发布等高风险
操作继续遵守各自的明确意图或审批契约。

### 4.3 MCP 委托

通过 MCP 明确委托普通 Workspace 写操作时，不要求用户再进入 LocalMind 网页人工确认。
执行仍必须同时满足：

- MCP credential 冻结的能力上限包含该任务；
- 委托用户的实时 `Workspace.Copilot` 和目标 ACL 仍有效；
- 工具和目标与持久化计划一致；
- 重试、租约交接和恢复不会扩大权限；
- 永久删除等不可逆操作具有准确且明确的用户意图。

`READ_WRITE` 仍只是委托凭据的能力上限，不替代实时 ACL；但实时 ACL 通过后，不再追加
“所有读者只能是本人”的门禁。

### 4.4 Project 边界

本次删除的是普通 Workspace 的 actor-only audience 限制，不删除 Project 原生资源的
边界：

- Project 内部资源继续按当前 Project 成员资格、资源 ACL、编辑租约和版本执行；
- Project 导入 Workspace 内容继续检查源读取、复制/分享权限并创建独立副本；
- Project 发布或更新 Workspace 副本继续要求明确用户意图、准确目标和目标实时 ACL；
- Project 不得通过普通 Workspace 工具隐式写回来源文档；
- AI 仍不能创建 Project、管理成员、修改权限或批准访问请求；
- Project 发布不得重新引入“目标所有读者必须是当前操作者”或 Owner-only 门槛。

Project 的跨作用域来源授权解决资源归属和数据跨边界问题，与普通 Workspace 内用户代表
自己执行 UI 操作不是同一类门禁。

## 5. 代码改造方案

### 5.1 删除普通 Workspace 的来源授权阻断

对所有普通 Workspace 写入路径执行统一修改：

1. 删除对 `assertDocumentSourcesShared` / `withDocumentSourcesShared` 的阻断式调用；
2. 删除 `WorkspaceOrganizationService.withAiSourceCheck` 对目录写操作的包裹；
3. 删除 ToolRuntime 对目录和文档写入的重复外层来源检查；
4. 删除 Agent Runtime prepare/execute 阶段的普通 Workspace 来源拒绝；
5. 删除 Office、structured document、workspace data 和直接 MCP 普通 Workspace 写入中的
   同类拒绝；
6. 保留并统一调用现有实时权限、版本、幂等、租约和输入校验；
7. 调整错误映射，使 ACL、资源不存在、版本冲突和明确意图不足分别返回准确错误。

不得把 `policy: 'enforce'` 批量改成 `policy: 'record'` 作为最终方案。那会继续维护一套结论
为 `allowed=false`、执行结果却成功的伪授权系统，并让审计含义混乱。普通 Workspace 来源
记录应明确降级为来源审计，而不是授权判决。

### 5.2 保留来源证据，但改为审计语义

以下信息仍有价值，可以继续持久化：

- 会话读取过的文档、附件、规则和记忆；
- 工具调用及其来源指纹；
- 写入的操作者、目标 Workspace/文档、工具、任务和时间；
- 执行时 ACL 结果、目标版本、幂等键和副作用回执；
- Project 导入/发布使用的来源授权证据。

普通 Workspace 的新审计记录应表达“通过实时 ACL 代表用户执行”，而不是继续计算
actor-only audience。历史 `ai_shared_write_source_checks` 记录保持不可变；旧的
`allowed=false/unshared_source` 表示旧策略判决，不得回写成成功，也不得解释为用户当时
没有 ACL。

如继续复用现有表，应增加或写入明确的策略版本/原因，例如：

```text
policyVersion = workspace-live-acl/v1
reasonCode = authorized_by_live_acl
```

如果现有字段无法避免语义混淆，应新增普通 Workspace 写入审计类型，而不是修改历史行。

### 5.3 删除同任务创建豁免

删除以下临时机制：

- `canPlaceDocumentCreatedByCurrentToolLease`；
- ToolRuntime 为 `workspace_folder_add_document` 注入的当前 request/run/lease 回调；
- `waived_server_resolved_destination` 作为普通 Workspace 挂载成功的必要路径；
- “新建文档能挂载、既有文档不能挂载”的相关测试假设和文档说明。

新建文档和既有文档使用完全相同的实时 ACL。创建回执仍可用于幂等和结果核对，但不提供
超出用户 ACL 的权限，也不因任务结束而导致行为变化。

### 5.4 固定执行顺序

所有普通 Workspace 写操作统一采用以下顺序：

1. 解析并冻结用户明确请求的操作和目标；
2. 校验会话、MCP credential 和工具能力上限；
3. 读取并检查实时 Workspace、文档、目录或 Office ACL；
4. 校验目标存在性、类型、路径、Trash 状态、版本和输入边界；
5. 在事务/幂等/租约保护下执行；
6. 保存副作用回执和不可变审计；
7. 返回准确的成功、无权限、冲突、已存在或幂等重放结果。

来源记录不能再放在第 3 步之前作为拒绝条件。

## 6. Workspace 与 Project 工具显式命名

### 6.1 命名原则

- 每个会修改或读取业务资源的模型可见工具必须从名称看出作用域；
- `workspace_*` 工具只接受 Workspace 资源 ID；
- `project_*` 工具只接受 Project 原生资源 ID；
- Project 发布到 Workspace 使用独立的 `project_publication_*` 工具；
- 同一工具名不得根据当前会话悄悄切换底层资源模型；
- 内部 tool category 可以保持抽象，但最终暴露给模型、计划快照和 checkpoint 的名称必须
  明确。

### 6.2 建议名称映射

| 旧的含糊名称             | Workspace 名称                     | Project 名称                                                  |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| `doc_create`             | `workspace_doc_create`             | `project_doc_create`                                          |
| `doc_read`               | `workspace_doc_read`               | `project_doc_read`                                            |
| `doc_update`             | `workspace_doc_update`             | `project_doc_update`                                          |
| `doc_update_meta`        | `workspace_doc_update_meta`        | `project_resource_update_meta`                                |
| `doc_keyword_search`     | `workspace_doc_keyword_search`     | `project_doc_keyword_search`                                  |
| `doc_semantic_search`    | `workspace_doc_semantic_search`    | `project_doc_semantic_search`                                 |
| `doc_trash`              | `workspace_doc_trash`              | 由 `project_resource_update_meta` 或后续专用 Project 工具承担 |
| `doc_restore`            | `workspace_doc_restore`            | 由 `project_resource_update_meta` 或后续专用 Project 工具承担 |
| `doc_delete_permanently` | `workspace_doc_delete_permanently` | Project 按原生资源删除契约另设专用名称，不复用 Workspace 工具 |

已经具备清晰前缀的名称继续保留，例如：

- `workspace_folder_list/create/rename/move/trash/restore/...`；
- `project_resource_list`；
- `project_folder_create`；
- `project_publication_prepare`。

目录工具中的 `workspace_folder_add_document` 和 `workspace_folder_move_document` 已明确作用域，
只需要移除错误来源门禁，不需要为了本次修复再次改名。

### 6.3 注册矩阵

| 会话/运行时             | 可注册工具                     | 禁止注册工具                         |
| ----------------------- | ------------------------------ | ------------------------------------ |
| 普通 Workspace AI 会话  | `workspace_*`                  | `project_*`                          |
| Project 原生会话        | `project_*`                    | 普通 `workspace_*`；显式发布工具除外 |
| 入站 Workspace MCP 委托 | 委托快照允许的 `workspace_*`   | `project_*`                          |
| Project Agent Runtime   | Project 快照允许的 `project_*` | `workspace_*`；显式发布步骤除外      |

运行时在工具执行前再次校验会话类型和资源所有者。仅依赖 prompt 描述不构成隔离。

## 7. 旧工具名称与持久化 checkpoint 的一次性切换

可以一步删除旧名称，不需要长期双写或别名迁移，但不能删除历史审计记录。

旧名称可能存在于：

- Agent Runtime step 输入、输出和执行结果；
- MCP delegation 的冻结工具名称/Schema 指纹快照；
- tool call checkpoint、幂等回执和恢复状态；
- 完成证据规则，例如要求先 `doc_read` 再 `doc_update`；
- 日志、审计和任务详情展示。

一次性切换采用以下规则：

1. 发布前统计所有 queued、running、retryable、waiting 状态的旧契约任务；
2. 若统计为零，直接启用新工具契约并删除运行时旧名称；
3. 若存在未终态旧任务，在部署窗口暂停 worker，将它们确定性终止为
   `tool_contract_retired`（或等价明确错误），释放租约并保存审计，不尝试用新名称猜测恢复；
4. completed、failed、cancelled 等历史记录保持不可变，UI 将旧名称标记为 legacy，只读展示；
5. 提升工具快照/完成证据契约版本；新 worker 对旧版本非终态任务 fail-closed；
6. 更新所有内置 prompt、required-tool evidence、测试 fixture 和投影器；
7. 不注册旧名称 alias，不做新旧双写，不让新任务生成旧名称。

这里的“一步删除”是删除旧名称的可执行能力，不是物理删除包含旧名称的历史行。物理删除
历史 Agent Runtime 或 MCP 记录会破坏审计、幂等和故障追踪，不属于本方案。

## 8. 主要修改位置

实现时至少检查并统一以下位置：

- `packages/backend/server/src/models/copilot-context.ts`
  - 删除普通 Workspace 的 actor-only audience 授权；
  - 保留 Project 专用来源授权和必要审计。
- `packages/backend/server/src/core/doc/workspace-organization.ts`
  - 删除目录变更的来源授权包裹；
  - 保留目录实时权限和事务检查。
- `packages/backend/server/src/plugins/copilot/tools/workspace-organization.ts`
  - 删除目录工具来源门禁和当前 lease 创建豁免；
  - 重命名没有 Workspace 前缀的生命周期工具。
- `packages/backend/server/src/plugins/copilot/runtime/tool-runtime.ts`
  - 删除重复来源阻断；
  - 按会话类型注册显式作用域工具；
  - 更新 tool-call/checkpoint/evidence 名称。
- `packages/backend/server/src/models/copilot-mcp-delegation.ts`
  - 删除当前 tool lease 创建文档才可挂载的授权函数；
  - 保留 lease、attempt、actor、workspace 和 credential 上限检查。
- `packages/backend/server/src/plugins/copilot/tools/doc-write.ts`
- `packages/backend/server/src/plugins/copilot/document-operation-service.ts`
- `packages/backend/server/src/plugins/copilot/agent-runtime-doc-update-request.ts`
- `packages/backend/server/src/plugins/copilot/agent-runtime-doc-update-adapter.ts`
- `packages/backend/server/src/plugins/copilot/mcp/documents.ts`
- `packages/backend/server/src/plugins/copilot/mcp/structured-document-tools.ts`
- `packages/backend/server/src/plugins/copilot/mcp/workspace-tools.ts`
- `packages/backend/server/src/plugins/copilot/office-agent-command.ts`
- `packages/backend/server/src/core/office/command-service.ts`
- `packages/backend/server/src/plugins/copilot/tools/project-doc.ts`
- `packages/backend/server/src/plugins/copilot/project-agent-runtime-worker.ts`

还必须同步更新工具快照版本、completion evidence、相关 schema 指纹、测试 fixture、错误码、
文档和用户提示，不能只修改工具注册表。

## 9. 测试与验收

### 9.1 授权正向场景

- 多人 Workspace 中，拥有 UI 等价权限的成员可以通过 Web AI 和 MCP：
  - 更新既有文档正文和标题；
  - 创建、重命名、移动和排序文件夹；
  - 添加既有文档、移动文档、移除目录位置；
  - 移入回收站并恢复；
  - 执行有权限的 Office 编辑。
- 同一既有文档在不同任务、不同日期和 worker lease 交接后得到一致结果。
- 新建文档与既有文档使用相同 ACL，不依赖创建回执豁免。
- MCP 明确请求的普通可逆写入无需网页二次确认。

### 9.2 授权拒绝场景

- 缺少 `Doc.Update` 时不能更新正文或标题；
- 只有 `Doc.Read` 时可以读取，但不能执行需要更新权的操作；
- 目录 `canOrganize=false` 或 `canWrite=false` 时不能挂载、移动或重命名；
- ACL 在排队后、执行前被撤回时，任务零副作用失败；
- credential 不包含写能力时，即使用户 ACL 允许也不能写；
- 永久删除没有明确意图、准确目标或 Trash 前置状态时拒绝；
- Workspace 会话不能调用 `project_*`，Project 会话不能调用普通 `workspace_*`；
- Project 导入和发布仍按各自跨边界契约拒绝未授权来源或目标。

### 9.3 回归与恢复场景

- Web AI、优化单文档更新、tool-agent、Agent Runtime、直接/委托 MCP、Office 单命令和批量
  命令对相同 ACL 得出一致结论；
- retry、checkpoint 恢复和 lease 交接不重复产生副作用；
- 旧名称非终态任务按切换策略确定性终止；历史终态任务仍可查看；
- 新任务快照中只出现当前会话作用域的显式名称；
- `2026-09-14｜member-02｜工作日志` 可复用原 documentId 挂入目标月份目录，无需重建；
- 审计能够区分 ACL 拒绝、版本冲突、意图不足和历史来源策略拒绝。

## 10. 发布顺序

1. 完成代码、测试、工具名称和文档更新；
2. 在隔离 PostgreSQL/Redis 和 `localmind-affine:test` 中验证所有调用路径；
3. 查询生产未终态 Agent Runtime/MCP 旧契约任务数量；
4. 备份数据库；
5. 暂停相关 worker；
6. 执行一次性任务终态化/契约版本切换；
7. 部署新代码并恢复 worker；
8. 使用普通多人 Workspace 账号验证既有文档更新和目录挂载；
9. 复核日志和审计，确认没有新的 actor-only audience 拒绝；
10. 保留历史审计，不删除 Workspace/Project 业务数据。

本方案涉及运行时行为，实施后需要按 Docker 开发约束进行聚焦 Linux 容器验证；仅本文档
本身的提交不需要重建镜像。

## 11. 完成定义

只有同时满足以下条件，修复才算完成：

- 普通 Workspace 全部写入路径均不再使用 actor-only audience 作为授权门禁；
- 所有路径仍执行实时 ACL、输入、版本、幂等和不可逆操作保护；
- Web AI、Agent Runtime、MCP 和 Office 的授权结果一致；
- Workspace/Project 模型可见工具名称和注册范围显式隔离；
- 旧工具名称不再可执行，未终态旧任务已安全收敛，历史证据仍可读取；
- 9 月 14 日日志可使用原 documentId 成功挂载；
- Project 导入、内部资源和显式 Workspace 发布边界未被削弱；
- 聚焦测试、类型检查、lint、格式检查和 `git diff --check` 通过；
- 部署后真实多人 Workspace 验收通过，且没有要求用户执行额外人工确认。
