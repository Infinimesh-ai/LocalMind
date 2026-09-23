# Project 与 Workspace Office 资源界面复用修复方案

## 1. 文档状态

- 日期：2026-09-18
- 状态：P0-P5 已完成
- 适用范围：Web、桌面端和移动 Web 中的 DOCX、XLSX、PPTX、PDF 打开、编辑与展示
- 上位契约：
  - [Native Office](../office-native/README.md)
  - [Project Native Resources](tracks/project-native-resources.md)
  - [Project Workbench Redesign](tracks/project-workbench-redesign.md)

本文记录 Project 与 Workspace Office 文件界面不一致问题的修复边界、共享架构、
实施顺序和验收标准。本文不改变 Project 原生资源归属，也不扩大 Native Office
的格式保真范围。

## 2. 问题说明

Workspace 打开 Office 文件时具有完整的资源界面，包括文件类型、标题、版本、
打印、下载、DOCX 导出 PDF、版本历史、评论协作和 AI 侧栏。Project 虽然已经复用
相同的四种编辑器，但外层页面由 Project 单独装配，因此存在以下问题：

1. 相同文件类型在 Workspace 与 Project 中显示不同的工具栏和状态。
2. Project 原先未暴露打印和 DOCX 导出 PDF 等已有能力。
3. 文件类型与语义状态匹配逻辑在两个入口重复，容易出现一端支持、一端遗漏。
4. Workspace 的历史版本、AI 结果刷新和评论协作没有形成可复用资源层。
5. Project 代码直接从 Workspace 路由目录导入编辑器，所有权边界不清晰。
6. 缺少 Project Office 前端页面级测试，界面能力漂移不能及时发现。

根因不是缺少 DOCX、XLSX、PPTX 或 PDF 编辑器，而是此前只复用了编辑器引擎，
没有复用完整的 Office 资源界面和会话状态。

## 3. 当前能力基线

### 3.1 已存在的公共能力

| 类型 | 已有原生能力                                                                 |
| ---- | ---------------------------------------------------------------------------- |
| DOCX | 文本和段落格式、表格、图片、形状、公式、图表、页眉页脚、修订、打印、导出 PDF |
| XLSX | 单元格和公式、格式、合并、行列、数据验证、工作表、表格和图表                 |
| PPTX | 文字、图片、形状、幻灯片增删复制排序、备注和主题                             |
| PDF  | PDF.js 渲染、搜索、下载、打印、批注、表单、页面操作、签名和脱敏              |

四种编辑器已经接受 `OfficeResourceOwner`，能够根据 Workspace 或 Project owner
调用不同的读取、预览和执行接口。Project 后端也已经提供 artifact、revision、
compare、command、package、state、part 和 DOCX PDF 导出接口。

### 3.2 当前数据边界

- Workspace Office 记录以 `workspaceId` 为 owner。
- Project Office 记录以 `projectId` 为 owner，并关联 Project 资源树。
- Project 编辑使用 Project edit lease，不借用 Workspace 文档锁。
- Project 普通保存只创建 Project revision，不发布或更新 Workspace 副本。
- 发布到 Workspace 是独立、显式且可审计的操作。
- Office 评论使用 Workspace/Project owner 联合输入；Workspace 走 Workspace ACL，Project
  走实时 membership 与 artifact 归属检查，评论数据不依赖隐藏 Workspace。

## 4. 修复目标

### 4.1 必须达到

1. Workspace 与 Project 使用同一个 Office 文件类型分发层。
2. 两端使用同一个 Office 资源头部和公共操作定义。
3. DOCX、XLSX、PPTX、PDF 使用完全相同的编辑器实现。
4. 加载、未找到、格式不匹配、只读、历史版本、冲突和保存失败具有一致语义。
5. Project 继续使用独立存储、权限、版本历史和编辑租约。
6. Workspace 专属和 Project 专属操作通过 capability 或 slot 注入，不复制资源页面。
7. 简体中文环境中新增或迁移的可见文字全部使用 i18n。

### 4.2 不在本修复中改变

- 不把 Project 文件迁移或隐藏存储到 Workspace。
- 不自动同步 Project 与 Workspace 的独立副本。
- 不接入 Microsoft Office Online 或其他远程编辑器。
- 不承诺宏、ActiveX、任意 OLE、全部 Excel 函数、完整 PowerPoint 动画或 Word 像素级分页。
- 不把 Office/PDF 转换为普通 BlockSuite 页面作为编辑真相来源。
- `.doc`、`.xls`、`.ppt` 等旧格式不因此成为原生可编辑格式。

## 5. 目标架构

```text
Workspace Office route ─┐
                        ├─ OfficeResourceSurface
Project resource route ─┘       │
                                ├─ OfficeResourceHeader
                                ├─ OfficeResourceSession
                                ├─ OfficeEditorSurface
                                │    ├─ DocumentEditor
                                │    ├─ SpreadsheetEditor
                                │    ├─ PresentationEditor
                                │    └─ PdfEditor
                                ├─ OfficeRevisionHistory
                                └─ owner capabilities / slots

WorkspaceOwnerAdapter           ProjectOwnerAdapter
  workspaceId                     projectId
  Workspace ACL                   Project membership
  Workspace realtime              Project realtime
  Workspace comments              Project edit lease
  Workspace AI sidebar            Project AI context
                                  publish/source actions
```

共享层只负责资源展示与编辑会话。owner adapter 负责查询、权限、实时更新和副作用，
避免共享组件反向依赖 Workspace 或 Project 页面。

## 6. 共享层接口

### 6.1 Owner

继续使用现有 `OfficeResourceOwner` 联合类型：

```ts
type OfficeResourceOwner =
  | {
      kind: 'workspace';
      workspaceId: string;
    }
  | {
      kind: 'project';
      projectId: string;
      editLease?: ProjectEditLeaseProof;
    };
```

共享组件不得从路由、当前 Workspace service 或查询参数推断 owner。调用方必须显式传入。

### 6.2 Resource descriptor

资源页面应消费统一描述，而不是从文件扩展名猜测能力：

```ts
type OfficeResourceDescriptor = {
  artifactId: string;
  title: string;
  sourceFileName: string;
  kind: 'document' | 'workbook' | 'presentation' | 'pdf';
  revisionCounter: number;
  currentRevision: OfficeRevision;
};
```

### 6.3 Capabilities

owner adapter 返回明确能力，界面据此显示和禁用操作：

```ts
type OfficeSurfaceCapabilities = {
  canEdit: boolean;
  canDownload: boolean;
  canPrint: boolean;
  canExportPdf: boolean;
  canViewHistory: boolean;
  canComment: boolean;
  canUseAI: boolean;
  canPublish?: boolean;
  readOnlyReason?: string;
};
```

客户端能力只控制展示。所有写入、下载、导出、评论和发布仍由服务端重新检查权限。

### 6.4 Owner adapter

后续阶段把 Workspace 与 Project 的查询差异收敛为适配器：

```ts
interface OfficeResourceAdapter {
  owner: OfficeResourceOwner;
  loadArtifact(): Promise<OfficeResourceDescriptor>;
  loadState(revision: OfficeRevision): Promise<NativeOfficeState>;
  listRevisions(limit: number): Promise<OfficeRevision[]>;
  compareRevisions(beforeId: string, afterId: string): Promise<OfficeDiff>;
  download(revision: OfficeRevision): Promise<void>;
  exportPdf?(revision: OfficeRevision): Promise<void>;
  refresh(): Promise<void>;
}
```

不得在适配器中弱化 Project membership、Workspace ACL 或编辑租约检查。

## 7. 统一界面规范

### 7.1 公共头部

两端统一显示：

- 文件类型图标；
- 文件标题；
- 当前版本号；
- 历史版本状态和返回最新版；
- DOCX 导出 PDF；
- 打印；
- 版本历史；
- 下载原始 Office 文件。

Workspace 可注入 AI 和评论入口。Project 可注入保存、租约、发布、来源刷新、全屏和关闭。
窄屏时公共操作区域允许横向滚动，打印时隐藏应用工具栏。

### 7.2 编辑区域

`OfficeEditorSurface` 必须同时检查 artifact kind 和 semantic state：

| artifact kind  | 合法 semantic state              |
| -------------- | -------------------------------- |
| `document`     | `localmind-office-docx-state/v1` |
| `workbook`     | `localmind-office-xlsx-state/v1` |
| `presentation` | `localmind-office-pptx-state/v1` |
| `pdf`          | `localmind-office-pdf-state/v1`  |

类型不匹配时显示可操作的错误状态，不允许把错误 state 交给其他编辑器尝试渲染。

### 7.3 状态模型

共享资源会话应覆盖：

```text
loading
  -> ready
  -> not_found
  -> forbidden
  -> unsupported_state
  -> load_failed

ready
  -> saving
  -> saved
  -> unsaved
  -> read_only
  -> historical
  -> conflict
```

Project 没有有效 edit lease 时进入只读状态。浏览历史版本时两端均不可写。
检测到远端新版本时不得覆盖本地草稿，应先展示冲突并允许返回最新版本。

## 8. 实施阶段

### P0：真实样本与基线

状态：已完成。

1. 在隔离验证环境为 Workspace 和 Project 分别导入 DOCX、XLSX、PPTX、PDF。
2. 保存文件 ID、artifact ID、revision ID 和 owner 证据。
3. 记录桌面宽屏、窄屏、浅色和深色截图。
4. 禁止使用业务文档正文作为公开测试 fixture。

隔离数据库已经为同一测试用户创建独立 Workspace 和 Project，并分别导入四种格式。
`packages/backend/server/scripts/office-surface-validation-seed.ts` 可重复生成基线，不会
清空数据库，也不会读取业务文档正文。初始 owner 证据如下：

| 格式 | Workspace artifact                     | Project artifact                       | 初始 revision sequence |
| ---- | -------------------------------------- | -------------------------------------- | ---------------------- |
| DOCX | `10547f06-2c31-4ea4-825a-7c393514f5c3` | `d00ca789-66bc-4777-ae77-ed6df96ec71a` | 2 / 2                  |
| XLSX | `37c1cc3f-dec4-45f1-a246-27d6d7b5f6fd` | `266a4c1d-c1a7-40d2-a9e9-d6e0b63ddd5c` | 2 / 2                  |
| PPTX | `dab648b6-dd01-41bc-a1ee-1e013c02a749` | `ce21db20-dcab-42b8-89e9-76e6453422d6` | 2 / 2                  |
| PDF  | `2fc22eaf-1fbf-4a96-a609-634c714b3d44` | `2a418fe8-27ce-4a85-b3c8-391544c3bcb0` | 2 / 2                  |

Workspace ID 为 `24ce2a49-5f64-4bfa-99ac-fb1b152d61db`，Project ID 为
`67627f07-c4a5-4ba0-be54-afb53c87ef3b`。浏览器保存验证又为 Workspace 四种格式和
Project PDF 各创建了 sequence 3，证明普通 Project 保存没有写入 Workspace owner。

### P1：公共入口层

状态：已完成。

新增：

- `packages/frontend/core/src/components/office/editor-surface.tsx`
- `packages/frontend/core/src/components/office/resource-header.tsx`
- `packages/frontend/core/src/components/office/index.ts`

Workspace 与 Project 已接入相同的类型分发和资源头部。Project 已补充打印与 DOCX
导出 PDF 入口。原 Workspace 头部的硬编码英文 tooltip 已改为现有 i18n 文案。

### P2：共享资源会话

状态：已完成。

1. 提取 artifact、latest revision、selected revision、state、selection 和 error 状态。
2. 使用 Workspace/Project adapter 注入查询、比较、刷新和下载行为。
3. 统一保存后 revision 更新、选区保留和冲突处理。
4. Project AI 完成后按持久化 revision 证据刷新，并与 Workspace 使用同一校验逻辑。

`OfficeResourceSession` 现统一负责加载、刷新、草稿注册、未保存确认、历史版本选择、
冲突保护、AI revision 证据刷新和轮询。Workspace/Project 查询、下载和导出由显式
owner adapter 注入。

### P3：统一版本历史

状态：已完成。

1. 提取 owner-neutral `OfficeRevisionHistory`。
2. Workspace 和 Project 使用相同的列表、时间、来源、操作摘要和 diff 展示。
3. Project 保留自己的 GraphQL operation，但通过 adapter 映射统一结果。
4. 历史版本必须只读，返回最新版前检查未保存草稿。

两端现使用同一个 `OfficeRevisionHistory`，并显示统一的来源、操作摘要和结构化差异。
浏览器验收已确认 DOCX v1→v2 的 1 项修改及前后文本证据。

### P4：评论与协作 owner 化

状态：已完成。

1. 将 Office comment 作用域从仅 `workspaceId` 扩展为 Workspace/Project owner 联合类型。
2. 增加数据库迁移、外键/归属约束和 GraphQL 联合输入。
3. Workspace 评论继续使用 Workspace ACL。
4. Project 评论使用有效 Project membership，不引入隐藏 Workspace。
5. 评论实时更新不得扩大文档读取权限。

新增 `OfficeComment`/`OfficeCommentReply` owner 约束、迁移、领域模型、GraphQL owner
输入和 `office.comment.changed` 实时事件。迁移保留旧评论/回复 ID、正文、解析状态、
时间戳和删除标记，并在迁移后删除旧根记录，保持单一事实来源。服务端测试覆盖
Workspace ACL、Project membership、artifact 归属、撤权、实时订阅和数据库约束。

### P5：代码所有权整理

状态：已完成。

1. 将 `DocumentEditor`、`SpreadsheetEditor`、`PresentationEditor`、`PdfEditor` 从
   Workspace 路由目录迁到共享 Office 组件目录。
2. 路由文件只负责 owner adapter、Workbench slot 和 Project 专属 slot。
3. 移动实现时保持公开导出兼容，逐步更新测试引用，避免一次性破坏所有消费者。

四种编辑器、评论面板、草稿、共享类型、样式和测试均位于
`packages/frontend/core/src/components/office/`。Workspace 原路径仅保留兼容导出，
Project 不再从 Workspace 路由目录导入实现。

### P6：普通页面与附件

Office 共享层稳定后，再分别处理：

- BlockSuite Page/Edgeless 的公共编辑宿主；
- 图片、音频、视频和文本附件的公共预览宿主；
- Workspace/Project 专属属性、发布和来源操作。

BlockSuite 页面和 Native Office 不合并为同一种内容模型，只统一资源打开框架和状态语义。

## 9. 验收矩阵

| 场景                           | Workspace             | Project           |
| ------------------------------ | --------------------- | ----------------- |
| DOCX 打开、编辑、保存、重开    | 必须通过              | 必须通过          |
| DOCX 打印、下载、导出 PDF      | 必须通过              | 必须通过          |
| XLSX 单元格、公式、格式保存    | 必须通过              | 必须通过          |
| PPTX 文本和幻灯片结构保存      | 必须通过              | 必须通过          |
| PDF 渲染、搜索、批注和页面操作 | 必须通过              | 必须通过          |
| 查看历史版本并返回最新版       | 必须通过              | 必须通过          |
| semantic state 与 kind 不匹配  | 明确错误              | 明确错误          |
| 第二个标签页并发编辑           | 按 Workspace 现有规则 | 必须因 lease 只读 |
| AI 修改后刷新并保留有效选区    | 必须通过              | 必须通过          |
| 无权限下载、编辑或评论         | 服务端拒绝            | 服务端拒绝        |
| owner 持久化证据               | 仅 `workspaceId`      | 仅 `projectId`    |

## 10. 测试要求

### 10.1 前端聚焦测试

- 公共头部必需操作、可选 capability 和本地化标签；
- 四种 artifact kind 到对应编辑器的分发；
- kind/state 不匹配拒绝；
- Workspace 与 Project owner 下的四种编辑器写入；
- 历史版本只读、返回最新版和未保存草稿确认；
- Project lease 缺失、过期和交接；
- AI revision 证据错误、过旧和目标 artifact 不匹配。

### 10.2 服务端与数据测试

- Project artifact/revision 归属检查；
- Workspace ACL 与 Project membership 拒绝路径；
- DOCX PDF 导出授权；
- revision compare owner 隔离；
- P4 实施后的评论 owner 隔离和迁移升级。

### 10.3 浏览器验收

每种格式至少完成一次：

```text
打开 -> 修改 -> 保存 -> 关闭 -> 重新打开 -> 查看历史 -> 下载
```

还需检查：

- 1280px 以上宽屏；
- 768px 左右窄屏；
- 浅色和深色主题；
- 简体中文；
- 打印预览；
- Project 双标签页租约行为。

## 11. 已完成验证

代码与数据验证：

- 共享 Office 前端：10 个测试文件、34 项测试；
- 服务端 Office 评论：8 项测试；
- Office/Project GraphQL E2E：6 项测试；
- `packages/frontend/core` 与 `packages/backend/server` TypeScript `--noEmit`；
- 变更文件 Oxlint、Prettier check 和 `git diff --check`；
- 372 个 Prisma 迁移在一次性 PostgreSQL 数据库全量应用成功；
- 评论迁移、Workspace ACL、Project membership、撤权、owner 约束与实时事件均在
  Linux 验证容器内通过。

浏览器验收：

- Workspace 与 Project 均打开了 DOCX、XLSX、PPTX、PDF 的真实 artifact，并显示
  相同的版本、打印、评论、版本历史和下载入口；
- Workspace 的 DOCX、XLSX、PPTX、PDF 均完成实际编辑、保存并重开，当前为
  sequence 3；Project PDF 完成编辑、保存并重开，当前为 sequence 3；
- Project 第二标签页在首标签持有租约时进入只读，并显示持有人和等待通知入口；
- DOCX 历史面板显示 v1/v2、来源和 `0 added / 0 removed / 1 modified` 差异；
- 简体中文、深色主题、760×900 窄屏和桌面宽屏完成可视检查；验证后已恢复系统主题、
  英文和默认视口；
- 浏览器可见下载入口与服务端 package 授权 E2E 均通过；内嵌浏览器不暴露 blob
  下载完成事件，因此自动化以服务端响应和入口可用性作为下载证据。

验证使用既有 `localmind-affine:dev-base`，没有重建镜像，没有同步或迁移业务热开发
数据库。验证开始时 Docker 镜像占用 24.65 GB，结束时为 25.02 GB。

## 12. 剩余风险

1. 内嵌浏览器无法捕获程序化 blob 下载的完成事件；下载 URL、owner 授权和响应已由
   E2E 覆盖，仍建议在 Chrome/Electron 发布候选中做一次人工落盘检查。
2. 打印按钮与打印专用样式已验证，系统打印预览不由内嵌浏览器自动化控制；发布候选
   仍需在 Chrome/Electron 各检查一次实际打印预览和分页。
3. P6 的普通 BlockSuite Page/Edgeless 与通用附件宿主不属于本轮 P0-P5，后续继续按
   各自内容模型实施。

## 13. 完成定义

P0-P5 的代码、数据迁移、聚焦测试和浏览器验证已经完成。后续发布验收继续检查：

1. P0-P5 完成并通过对应测试。
2. 同一测试文件在 Workspace 和 Project 中使用相同编辑器与公共操作顺序。
3. Project 数据库记录、下载 URL、revision 和命令均证明 Project owner，没有 Workspace 回退。
4. 四种格式完成浏览器打开与共享编辑器的编辑、保存、重开和历史验收；两种 owner
   的下载授权持续通过 E2E。
5. Project 第二标签页只读，租约交接后可以安全继续编辑。
6. 简体中文、窄屏和深色持续通过；Chrome/Electron 发布候选补做系统打印预览。
7. 不存在从 Project 普通保存隐式发布或更新 Workspace 的路径。
