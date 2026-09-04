# LocalMind 原生 Office AI 编辑闭环执行方案

创建日期：2026-09-04

状态：已完成（2026-09-04）

本文是 LocalMind Native Office AI 编辑闭环的实施方案。执行时应同时遵守：

- `docs/office-native/README.md`
- `docs/ai-modernization/README.md`
- `docs/ai-modernization/tracks/agent-runtime.md`
- `docs/ai-modernization/validation.md`
- `docs/localmind-docker-development-constraints.md`

## 1. Goal

在不接入第三方 Office 编辑器运行时的前提下，将 LocalMind 现有原生 Docs、
Sheets、Slides 和 PDF 编辑引擎接入内置 AI，使用户可以在当前 Office 文件中用
自然语言发起可预览、可审批、可取消、可审计、可恢复的局部或批量修改。

完成后的主链路必须是：

```text
当前 Office 页面和稳定选择区
  -> BYOK 模型理解用户意图
  -> office_read 读取有界语义状态
  -> 严格 Office command 或 command batch
  -> 服务端预览和持久化审批证据
  -> Agent Runtime 等待审批
  -> worker 重新检查 ACL、取消、revision 和预览漂移
  -> LocalMind 原生 Office 引擎执行
  -> 一个新的不可变 OfficeRevision
  -> 编辑器刷新到新 revision 并显示执行结果
```

模型只负责理解意图、选择工具、生成内容和填写结构化参数。模型不得直接重写
OOXML/PDF package，不得返回完整文件覆盖当前 revision，也不得绕过命令 schema、
权限、审批或版本冲突检查。

## 2. 已有基础

以下能力已经存在，实施时应复用而不是重建：

- `OfficeArtifact` 和不可变、线性链接的 `OfficeRevision`；
- DOCX、XLSX、PPTX 和 PDF 原生语义状态及 package writer；
- `localmind-office-command/v1` 严格命令 schema；
- 用户工具栏使用的 Office preview/execute 服务；
- AI 使用的 `office_read` 和 `office_command_request` 工具；
- 命令、预览和状态指纹；
- `waiting_approval` Agent Runtime workflow；
- 审批后 ACL、取消、命令证据、预览漂移和 revision 重检；
- 成功执行后 `origin=ai` 的 Office revision 和 side-effect evidence；
- 用户生成模型的 BYOK-only 路由和 `COPILOT_BYOK_NOT_CONFIGURED` 错误。

## 3. 完成结果

本方案已形成完整用户闭环：

1. 四种 Office 页面都复用现有 AI Chat，并自动附加当前 Artifact、Revision、
   资源类型和提交瞬间的稳定选择区。
2. AI Chat 显示当前文件、资源类型、Revision 和 selection chip；用户可以只清除
   选择区，不能替换受服务端校验的 Artifact 身份。
3. 单命令保留 `office_command_request` 兼容路径；多步骤修改通过
   `office_command_batch_request` 和 `localmind-office-command-batch/v1` 在一次
   preview、一次审批和一个 Revision 中原子执行。
4. Office task UI 区分 read、waiting approval、queued、running、rejected、
   cancelled、conflicted、failed 和 completed，并提供 Approve、Reject、Cancel。
5. Agent Runtime 完成后，页面只接受当前 Artifact 的不可变 Revision 证据，无
   整页跳转地重新加载 state/package，并恢复仍有效的稳定选择区；目标已删除时
   清除选择区并显示原因。
6. 自动化测试覆盖 Docs、Sheets、Slides、PDF 的读取、单命令或 batch、package
   reopen、审批/取消/冲突/漂移/权限失败和零副作用语义；实机浏览器闭环另外证明
   Sheets 单命令、拒绝、两命令原子 batch、side-effect ledger、自动刷新和 A1
   选择恢复。

## 4. 强制架构边界

### 4.1 BYOK

- Office AI 属于用户生成请求，必须使用当前 workspace 的有效 BYOK profile。
- 未配置、失效或不支持当前模型时，在模型调用前返回
  `COPILOT_BYOK_NOT_CONFIGURED` 或对应的可操作错误。
- 不允许回退到 quota-backed/global chat provider。
- embedding 和 rerank 继续遵守现有实例级基础设施例外，不参与 Office 写操作的
  模型选择。

### 4.2 状态与文件所有权

- 编辑 source of truth 是 LocalMind Office semantic state。
- OOXML/PDF 是交换、保存和兼容性表示。
- BlockSuite Page 不能作为 Office AI 编辑的中间文档模型。
- 不引入 GenOffice、ONLYOFFICE、LibreOffice Online 或 SparkClaw 作为第二编辑器
  服务或第二 source of truth。
- 允许复用许可证和部署模型合适的解析、渲染、字体、公式、图表或 codec 库。

### 4.3 工具与命令

- 模型必须先通过 `office_read` 获得当前 revision 和稳定对象 ID。
- 模型不得猜测 paragraph、run、sheet、slide、shape、page 或 annotation ID。
- `current_selection` 等临时值只能由前端解析为稳定目标，不能进入持久命令。
- AI 和工具栏必须复用同一 command schema 和 Office domain service。
- 所有 AI 写操作默认需要显式审批。
- 预览、执行和保存不得接受客户端或模型提供的 hash 作为权威证据。

### 4.4 PDF

- PDF 保持固定版式资源。
- AI 可以操作批注、表单、页面、签名外观和涂黑等已支持对象。
- “重写正文”“调整段落排版”等请求必须明确拒绝，或者通过显式“转换为 Docs”
  工作流处理，不能伪装成原 PDF 的普通编辑。

## 5. 目标设计

### 5.1 Office AI Context

新增一个前后端共享、严格验证的 `OfficeAiContext` 合约，至少包含：

```ts
type OfficeAiContext = {
  version: 'localmind-office-ai-context/v1';
  workspaceId: string;
  artifactId: string;
  artifactKind: 'document' | 'workbook' | 'presentation' | 'pdf';
  revisionId: string;
  selection?: OfficeDocumentSelection | OfficeWorkbookSelection | OfficePresentationSelection | OfficePdfSelection;
};
```

选择区按资源类型解析：

| 资源   | 稳定选择区                                      |
| ------ | ----------------------------------------------- |
| Docs   | section、paragraph/block、run 或稳定文本 range  |
| Sheets | sheet id、cell/range、table 或 chart id         |
| Slides | slide id、shape id、placeholder 或 notes target |
| PDF    | page、annotation、form field 或页面矩形区域     |

该合约通过结构化请求字段传递。可以另外生成供模型理解的有界描述，但不能只把
身份和权限边界放进自由文本 prompt。

### 5.2 Office AI 入口

复用 LocalMind 现有 AI Chat 面板和设计系统，不为 Office 创建第二套聊天系统。
Office 页面需要提供：

- 打开现有 AI 面板的入口；
- 当前文件、资源类型和 revision 的上下文 chip；
- 存在选择区时的 selection chip；
- 用户可清除选择区上下文，但不能把当前文件身份替换为另一个未授权 artifact；
- BYOK 缺失、读取失败、选择区失效和 revision 冲突的明确错误状态。

默认行为：

- 从 Office 页面打开 AI 时自动附加当前 artifact；
- 用户选中文字、单元格、形状或 PDF 区域后发起请求时自动附加稳定选择区；
- 没有选择区时，模型先读取轻量 index，再按需要读取更窄的状态；
- 不把整个大型 Office semantic state 无界塞进 prompt。

### 5.3 AI Tool Planner

Office prompt/tool policy 必须明确要求：

1. 写操作前调用 `office_read`；
2. 使用读取结果中的 `revisionId` 和稳定 ID；
3. 不支持的能力直接说明限制，不生成近似或虚假命令；
4. 单一修改使用 `office_command_request`；
5. 多步骤、需要共同成功的修改使用后续的 batch 工具；
6. 工具提交后向用户说明需要审批，不宣称修改已经完成；
7. 只有收到执行成功和新 revision 证据后才能宣称完成。

工具结果渲染必须区分：

- read completed；
- preview ready / waiting approval；
- approved / queued / running；
- completed with revision；
- rejected、cancelled、conflicted 或 failed。

### 5.4 原子批量命令

在保留 `localmind-office-command/v1` 兼容性的基础上，增加严格的
`localmind-office-command-batch/v1`：

```ts
type OfficeCommandBatch = {
  version: 'localmind-office-command-batch/v1';
  batchId: string;
  idempotencyKey: string;
  source: 'ai' | 'user' | 'system';
  artifactId: string;
  expectedRevisionId: string;
  commands: OfficeCommandOperation[];
};
```

批量命令约束：

- 只允许操作一个 artifact 和一个预期 parent revision；
- 命令数和序列化字节数必须有界；
- 在内存中的同一 semantic state 上按顺序执行；
- 任一命令失败则整个 batch 不产生 package、revision 或部分副作用；
- 整个 batch 只产生一次 preview、一次审批和一个 OfficeRevision；
- operation summary 保留每个子命令的有界摘要和整体 fingerprint；
- 重放相同 idempotency key 只能复用完全相同的结果；
- batch 不得变成执行任意 JavaScript、宏或模型生成代码的通道。

新增 `office_command_batch_request`，其 Agent Runtime 语义与现有单命令一致。
单命令内部可以复用 batch executor，但不能破坏现有 API 和已持久化证据。

### 5.5 预览与审批

预览界面应展示语义变化，不展示无意义的完整 ZIP/XML 差异：

- Docs：文本、格式、段落、结构和页面设置变化；
- Sheets：单元格 before/after、公式、范围格式、行列和对象变化；
- Slides：幻灯片、shape、文本、几何、主题和备注变化；
- PDF：页面、批注、表单、签名外观和涂黑变化。

审批卡至少展示：文件名、当前 revision、操作摘要、影响对象数、模型提出修改的
原因，以及 Approve、Reject、Cancel。审批不能只存在于前端内存。

批准后 worker 必须重新检查：

- workspace 和 actor；
- delegated user 当前 ACL；
- BYOK 不是执行 Office command 的授权来源；
- cancellation request；
- command/batch blob identity 和 fingerprint；
- artifact 当前 revision；
- 重新 preview 的 package/state fingerprint；
- idempotency 和已有 side-effect evidence。

### 5.6 完成后的编辑器同步

Agent Runtime 完成后，Office 页面应通过现有 realtime 或有界轮询获得新 revision：

- 只接受同一 artifact 的更新；
- 读取并验证新的 state/package URL；
- 刷新编辑器，不整页跳转；
- 尽可能按稳定 ID 恢复选择区；
- 稳定目标已删除时清除选择并说明原因；
- 显示“AI 创建 revision N”及可查看历史/比较入口；
- 不把 optimistic UI 当成已经持久化的成功结果。

## 6. 分阶段实施

### Phase 0：基线与合约

状态：已完成。

交付：

- 补齐当前 Office AI 链路的聚焦基线测试；
- 定义并导出 `OfficeAiContext` schema；
- 定义四种资源的 selection schema；
- 记录单命令与 batch 的兼容策略和大小限制；
- 更新 GraphQL/API schema 设计，但不手工修改生成文件。

完成标准：合约能拒绝未知字段、跨 artifact 选择区、错误资源类型和空目标。

### Phase 1：单命令用户闭环

状态：已完成。

交付：

- Office 页面接入现有 AI Chat；
- 自动附加 artifact、revision 和 selection context；
- Office AI prompt 启用 `office` 工具类别；
- BYOK 缺失时在模型调用前失败；
- 渲染 `office_read` 和 `office_command_request` tool call；
- 在现有 Agent Runtime 审批 UI 中显示 Office preview；
- 完成后刷新到新 revision。

完成标准：在 DOCX 中可以用自然语言把已选择文字设置为指定字号、颜色、斜体、
下划线和标题样式；批准前没有 revision，批准后恰好产生一个 `origin=ai`
revision。

### Phase 2：原子批量命令

状态：已完成。

交付：

- `localmind-office-command-batch/v1` shared schema；
- preview、execute、fingerprint、persistence 和 Agent Runtime adapter；
- `office_command_batch_request` AI tool；
- batch 语义 diff 和审批 UI；
- 原子失败、幂等重放、取消、漂移和 stale revision 测试。

完成标准：一个包含多处格式与内容变化的请求只产生一次审批和一个 revision，
任一子命令失败时零副作用。

### Phase 3：四种资源覆盖

状态：已完成。

按以下顺序补齐上下文、预览和完成刷新：

1. Docs；
2. Sheets；
3. Slides；
4. PDF。

每个资源至少证明一个读取、一个单命令写入和一个批量写入。PDF 批量写入只覆盖
其固定版式允许的命令。

### Phase 4：可靠性与产品完成度

状态：本方案要求的审批、取消、冲突、刷新、审计和 package reopen 范围已完成；
更高保真度、协作和大文件性能继续作为 Native Office 后续兼容性工作。

交付：

- revision 冲突后的重新读取和重新规划，不自动套用过期命令；
- approval reject、cancel、worker retry 和 lease handoff UI；
- Office command timeline、side-effect evidence 和审计可见性；
- 大文档 selector/index 读取策略；
- 可访问性、暗色主题、桌面与移动端关键视口检查；
- DOCX/XLSX/PPTX package reopen 和 opaque-part preservation fixtures。

## 7. 测试矩阵

### Backend

- 无 BYOK 时不进入模型或 Office tool loop；
- `office_read` 拒绝无权限和跨 workspace artifact；
- 模型伪造稳定 ID 时 preview 失败；
- preview 后 revision 变化时执行失败；
- preview fingerprint 漂移时执行失败；
- 未审批、拒绝或取消时零副作用；
- 相同 idempotency key 的完全相同请求复用结果；
- 相同 key 不同内容产生冲突；
- worker lease handoff 不重复创建 revision；
- batch 中间失败时无 package/state blob 被 revision 引用；
- 成功操作写入正确的 origin、summary 和 side-effect evidence。

### Frontend

- 四种 Office 页面附加正确 artifact context；
- selection 改变后发送的是提交瞬间的稳定快照；
- 切换 artifact 不复用前一个文件的选择区；
- BYOK、loading、empty、error、approval、running、success 和 conflict 状态；
- approve/reject/cancel 防重复提交；
- 完成后刷新 revision 并恢复或清除选择区；
- tool result 不把“等待审批”显示为“修改完成”。

### End-to-End

- DOCX：设置字号、颜色、斜体、红色下划线和 Heading 2；
- XLSX：写入公式、格式化范围并添加图表；
- PPTX：修改标题、添加形状并调整主题颜色；
- PDF：添加批注、旋转页面并应用允许的涂黑操作；
- 每个文件下载后重新打开，验证结构、内容和 revision 证据；
- 未修改的 OOXML package parts 保持预期的 preservation 行为。

## 8. Definition of Done

状态：以下 14 项已于 2026-09-04 全部满足。

只有同时满足以下条件，Goal 才可以标记 complete：

1. Docs、Sheets、Slides、PDF 页面均可打开现有 LocalMind AI Chat。
2. AI 请求自动携带当前 artifact、revision 和稳定 selection context。
3. 没有有效 BYOK 时返回明确错误，且不会使用全局或 quota-backed 模型。
4. 模型通过 `office_read` 和严格 command 工具工作，不能直接覆盖文件。
5. 单命令和原子 batch 都经过 preview、持久审批和 worker 重检。
6. 批准前零 Office revision，成功后恰好产生一个 `origin=ai` revision。
7. reject、cancel、stale revision、preview drift 和权限失败均为零副作用。
8. 编辑器能显示审批状态，并在完成后刷新到新 revision。
9. PDF 固定版式边界在工具、提示词和 UI 中一致。
10. 不引入任何第三方 Office 编辑器服务或第二 source of truth。
11. GraphQL/Prisma 变化包含迁移、生成文件、授权失败和兼容验证。
12. 聚焦 lint、format、typecheck、测试和要求的 Docker 验证全部通过。
13. `git diff --check` 通过，且没有覆盖用户已有的无关修改。
14. source-of-truth、current state 和 next goals 与最终实现保持一致。

## 9. Goal 模式执行提示词

以下内容可以直接作为 Goal objective：

```text
按照 docs/office-native/ai-editing-execution-plan.zh-CN.md 完成 LocalMind 原生
Office AI 编辑闭环。必须复用现有 OfficeArtifact、OfficeRevision、
localmind-office-command/v1、office_read、office_command_request、Agent Runtime、
BYOK-only provider routing 和原生 Docs/Sheets/Slides/PDF 引擎。先完成当前文件、
revision 和稳定选择区到 AI Chat 的结构化上下文接线及单命令端到端闭环，再实现
localmind-office-command-batch/v1 原子批量命令，最后补齐四种资源、审批、取消、
冲突、完成刷新和验证。不得接入或嵌入 GenOffice、ONLYOFFICE、SparkClaw 或其他
Office 编辑器运行时；不得让模型直接重写 OOXML/PDF；不得绕过 ACL、审批、
preview、fingerprint、idempotency 或不可变 revision。只有该方案 Definition of
Done 的全部条件满足后才能停止并把 Goal 标记 complete。
```
