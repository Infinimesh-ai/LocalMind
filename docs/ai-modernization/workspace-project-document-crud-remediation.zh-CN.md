# Workspace / Project 文档与文件 CRUD 补全方案

状态：S0—S7 已实现并完成本地验收。2026-09-28；本表保留修复前检查基线，当前交付与验证见第 13 节。基线：`d390b39ed8` 加当前工作区未提交改动。

补充边界（2026-09-28）：以上完成记录对应领域能力及当时分离的 Files 入口；后续已将原生文件接入主页主列表、侧栏根目录、全局搜索与既有 Trash，侧栏「＋」统一新建/上传。界面整合、原位恢复、逐动作权限及独立验证证据见[统一资源体验方案第 7 节](workspace-unified-resource-experience-remediation.zh-CN.md#7-实施与验证记录2026-09-28)，不将此前 CRUD 测试数重复作为新增 UI 的验收。

本方案覆盖资源级增删查改和必要的编辑、目录、版本、搜索、导入发布、UI/AI 接入。它扩展此前只针对五项故障的修复建议；第 2—12 节保留检查时的基线与实施设计；第 13 节及实施记录说明当前交付，不能把基线缺口表误读为尚未实现。资源、授权和 Office 契约已同步更新，公开 MCP 能力清单不变。

## 1. 范围与完成标准

覆盖 Workspace 与 Project 的以下资源：

- BlockSuite Page、Edgeless 画布；文档中的数据库、图像、附件等仍是原文档模型的一部分。
- 原生 DOCX、XLSX、PPTX、PDF。
- 独立 TXT、Markdown、CSV、JSON 文件。
- 其他上传文件、图片、音频、视频等二进制附件，以及组织这些资源的文件夹。

完整资源 CRUD 至少包括：人工或适合该类型的创建/导入；可发现的列表和读取；正文或该类型支持的编辑；改名和移动；回收、恢复和受控的不可恢复删除；刷新、重开及跨入口状态一致。历史恢复、独立复制和跨作用域流转也列入本方案，但与基本 CRUD 分批交付。

PDF 的内容修改是现有批注、表单、页面、遮盖等固定版式操作，不扩张成 DOCX 式正文重排。其他二进制文件的 CRUD 指上传、查看/下载、元数据管理、回收恢复及必要时的显式替换版本，不承诺为每个格式建设编辑器。普通文档 AI 的 Markdown 工具不等于支持画布全部图形或任意数据库块操作。

主要在线交付对象为自托管/服务端 Workspace 和原生 Project。纯本地 Workspace 的普通文档继续沿用既有 local-first 能力；当前原生 Files 组件对 local Workspace 隐藏，Office 依赖服务端资源 API。纯本地原生文件完整离线编辑与同步需要独立能力阶段，不能计入本方案在线验收的已完成项。

## 2. 当前能力矩阵

“已有”表示找到真实入口及持久化实现，或已有聚焦测试证据，不表示每个格式的全部编辑特性和所有部署都已验收。

| 所属 / 类型                      | 新增与导入                                                            | 读取与查找                                                     | 正文/内容修改                                        | 改名、移动、回收、恢复       | 历史与复制                                              | 主要待办                                     |
| -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Workspace Page                   | 人工/AI 新建、导入已有                                                | 列表、搜索、编辑器已有                                         | 已有；普通 AI 全文更新缺读取版本保护                 | 已有，含永久删除             | 历史恢复、复制已有                                      | R01；回归既有能力                            |
| Workspace Edgeless               | 人工新建已有                                                          | 画布及文档查询已有                                             | 图形编辑和保存已有；Markdown AI 不是完整画布编辑接口 | 复用文档生命周期             | 复用文档历史/复制                                       | 检验画布元素与附件保真，不重建画布           |
| Project Page / Edgeless          | 人工/AI 创建及授权导入已有                                            | 目录、读取、关键词检索已有                                     | 已有，带内容版本和编辑租约                           | 已有，含不可恢复逻辑删除     | 有不可变修订及按序号读取；缺完整历史恢复/同项目复制入口 | R15、R16                                     |
| Workspace DOCX                   | 导入、AI 生成已有；缺人工空白创建入口                                 | 原生编辑器/下载已有；没有完整接入统一资源搜索                  | 文本、段落、格式、表格等原生命令已有                 | 缺文件级管理闭环             | 历史查看/比较已有，未接恢复为当前版本                   | R06—R10、R12、R15—R16                        |
| Workspace XLSX                   | 导入、AI 生成已有；缺人工空白创建入口                                 | 原生工作表读取/下载已有；统一搜索不完整                        | 单元格/公式、行列、工作表等操作已有                  | 同上                         | 同上                                                    | 同上；CSV 文件不自动冒充 XLSX                |
| Workspace PPTX                   | 导入、AI 生成已有；缺人工空白创建入口                                 | 原生幻灯片读取/下载已有；统一搜索不完整                        | 幻灯片、形状、文本等操作已有                         | 同上                         | 同上                                                    | 同上                                         |
| Workspace PDF                    | 原生导入已有；不是现有 AI 文件生成格式                                | 预览、文内查找、下载已有；统一资源检索不完整                   | 固定版式命令已有                                     | 缺文件级管理闭环             | 历史查看/比较已有，未接版本恢复                         | R06、R09—R10、R12、R15—R16                   |
| Project DOCX / XLSX / PPTX / PDF | 上传/导入已有；前三种 AI 生成已有，缺人工空白创建入口；PDF 以导入为主 | 原生读取、预览、版本及资源索引已有                             | 复用 Office 命令、修订、任务/租约                    | 复用 ProjectResource，已实现 | 有历史查看/比较；缺版本恢复和同项目独立复制入口         | R03、R07、R15—R16                            |
| Workspace TXT / MD / CSV / JSON  | AI 创建已有；缺原生人工创建/上传链路                                  | Files 列表、原格式下载；缺资源 ID 正文读取、编辑视图和内容检索 | 未实现                                               | 未实现                       | 当前创建证据不可变，没有后续修订体系                    | R07—R10、R12—R16                             |
| Project TXT / MD / CSV / JSON    | 上传、AI 创建已有；缺人工空白创建入口                                 | 文本预览、下载、标题查询、选入 AI 上下文已有；正文索引空缺     | 当前只读；底层修订机制可复用                         | 已有                         | 有不可变修订基础；缺用户历史管理                        | R07、R11—R16                                 |
| Workspace 其他原生文件           | 文档内附件已有；不等于独立 WorkspaceFile 上传管理                     | 文档内附件读取已有；独立文件库链路未完整建立                   | 按格式预览/下载；可计划显式替换版本                  | 需纳入原生文件生命周期       | 同 R08 的修订模型                                       | R07—R10；支持范围与配额明确化                |
| Project 其他文件                 | 文件树上传已有                                                        | 支持的图像/音视频预览，其他类型下载                            | 通用原位替换文件内容入口未实现                       | 已有                         | 复用 Project 修订基础                                   | R11 的二进制替换分支，不能误走文本编辑       |
| Workspace / Project 文件夹       | 创建和组织已有                                                        | 已有目录查询                                                   | 改名、位置、排序等已有                               | 已有相应组织/回收行为        | 递归复制不是本期基础 CRUD 前提                          | Workspace 原生文件接入 R10；保留既有目录语义 |

公开 Workspace MCP 只开放现行契约规定的 10 个直接资源工具；Project、Office、附件上传和直接删除/回收不在该公开目录。内部 UI/AI 已有相应能力，并不能说明公开 MCP 已开放，反之也不能据此认定产品能力缺失。

## 3. 完整待办清单

优先级：P1 为先修的一致性/恢复问题或本次核心能力缺口；P2 为完整资源工作流；P3 为独立的小修正。以下混合了确定故障、实现边界和功能补全，不把它们统称为安全漏洞。

| ID  | 优先级 / 性质       | 确定范围                                                                                                          | 交付结果                                                                   |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| R01 | P1 / 一致性风险     | 普通 Workspace AI 全文更新没有绑定读取版本；生产 native 探针已复现覆盖读取后新增段落                              | 读取版本、事务内 CAS、冲突重读、失败不创建副本                             |
| R02 | P1 / 故障           | Project 已归档管理 UI 存在，但后端 active 门禁拒绝恢复；归档行元数据保存也失败                                    | 修正状态转换，保留 Owner/锁；归档状态 UI 与后端一致，主壳可找回项目        |
| R03 | P2 / 故障           | Project Office 已改名，下载仍取 sourceFileName                                                                    | 当前标题生成下载名；不改导入证据                                           |
| R04 | P2 / 故障           | Project 任意外键删除阻塞被误报为存在用户记忆                                                                      | 类型化阻塞原因；保留不可删除的历史约束                                     |
| R05 | P3 / 描述错误       | 文件生成工具把 TXT/MD/CSV/JSON 也指向 Office 编辑工具                                                             | 工具说明与实际可调用类型一致                                               |
| R06 | P2 / 列表一致性     | Workspace Office 列表读 sourceFileName/sourceByteSize；Files 本身只初始加载、手动重试/翻页，未订阅资源变更        | 展示当前元数据/修订大小，创建编辑回收后自动刷新并正确分页                  |
| R07 | P1 / 创建入口缺口   | 两侧缺原生人工空白创建；Workspace 缺独立普通文件上传，Markdown 导入当前转为 Page                                  | 新建 Office/文本文件、原样上传普通文件，保留“导入为页面”明确选项           |
| R08 | P1 / 存储与编辑缺口 | WorkspaceFile 只有 create/list/get，整行 UPDATE 被触发器禁止                                                      | 不可变创建证据 + 当前状态 + 不可变修订；正文读取、预览、更新               |
| R09 | P1 / 生命周期缺口   | WorkspaceFile 与 Workspace Office 缺文件级改名、回收、恢复、不可恢复删除闭环                                      | 共享管理入口、各自内容模型；全部读写入口执行相同状态/权限检查              |
| R10 | P1 / 目录接入缺口   | Workspace 目录只支持 folder/doc/tag/collection；原生文件根目录独立展示                                            | 扩展真实资源类型、移动、目录 ACL、回收恢复位置及事务一致性                 |
| R11 | P1 / 保存入口缺口   | Project 普通文件只有只读预览；saveDocument 拒绝 file，但 appendRevision 已支持                                    | 文本编辑与显式文件替换，复用原有 ID、版本、租约、审计及 AI 任务            |
| R12 | P2 / 检索缺口       | Project 普通 file 索引写空正文；Workspace 原生文件/Office 未完整进入文档统一检索                                  | 类型化资源列表/关键词搜索，按最新修订索引并实时过滤权限和回收状态          |
| R13 | P1 / 跨域接入缺口   | Workspace→Project 候选仅查询 snapshots/updates/office_artifacts，未查询 workspace_files；文件导入仍按附件页面解码 | 原生 WorkspaceFile 可被合法发现、批准、复制与显式刷新，保留类型和来源版本  |
| R14 | P1 / 跨域契约衔接   | Project 普通文件→Workspace 仍生成附件页面，未接新 WorkspaceFile；旧实现及测试确实如此                             | 新发布保存为原生文件；更新绑定确定类型/ID/版本；旧附件载体保留明确兼容路径 |
| R15 | P2 / 历史恢复缺口   | Office 历史当前只读/比较；Project 非 Office 缺完整历史列表/恢复 UI；WorkspaceFile 缺修订基础                      | 有界历史查询和预览，选择历史内容后追加新修订，不回写旧修订或倒退计数器     |
| R16 | P2 / 独立复制缺口   | Workspace Page 已有复制；原生 Office/File、Project 同作用域资源缺统一用户复制入口                                 | 另存/复制生成新资源 ID，保留类型；明确来源与幂等，不成为更新失败兜底       |

与清单配套但不重复计数的必做工作：UI/AI 同期接入、能力冻结兼容、错误/冲突/未保存草稿状态、旧数据升级、测试夹具修正和回归。收藏/标签/集合筛选及纯本地原生文件同步属于扩展阶段；它们不能作为当前“全部已支持”的宣传内容。

## 4. 本轮新增发现的代码证据

### 4.1 新建入口需要从 AI 服务中分离

Project 新建菜单只有 Page、Edgeless 和文件夹；Workspace 新建入口也使用 Page/Edgeless。Office 已有导入和 AI 生成，不等于存在无需 AI 的空白创建。

当前 NativeFileCreateService.create 强制读取并验证 sessionId；WorkspaceFile.sourceSessionId 非空。实现人工创建必须正式支持非 AI 来源，不能传伪造 sessionId。

证据：[Project 新建菜单](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-files.tsx:785)、[Workspace 新建入口](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/workspace/all-page/all-page-header.tsx:46)、[会话要求](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/office/create-service.ts:70)、[WorkspaceFile 模型](/Users/dev2/Documents/project/LocalMind/packages/backend/server/schema.prisma:5046)。

Workspace 的 Markdown 导入调用 MarkdownTransformer.importMarkdownToDoc，产生 docId，不能作为“上传原生 .md 文件”的实现证据：[导入代码](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/dialogs/import/index.tsx:412)。

### 4.2 普通 Project 文件未索引正文

Project indexer 对 Office 解析原生内容，对 Page/Edgeless 解析 Markdown，对其余 file 写入空字符串并推进 searchVersion。这意味着文件名能查到、已选入上下文能读取，不代表可以按文件正文搜索。

证据：[Project 索引分支](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/office/project-indexer.ts:65)。Workspace 的 DocsSearchService 则查询 doc/block 索引，独立 Files 只有列表；不能把旧的 ai_workspace_files 附件向量库当作 WorkspaceFile 主资源索引。

证据：[Workspace 文档搜索](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/modules/docs-search/services/docs-search.ts:103)、[Files 组件](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/workspace/all-page/workspace-files.tsx:25)。

### 4.3 原生文件跨域流转仍使用旧附件路径

导入候选 SQL 的集合不含 workspace_files。导入 kind=file 时调用 DocReader，然后 readFileCopySnapshot；因此新 WorkspaceFile 既不在正常候选中，也没有对应的原生读取分支。

证据：[候选 SQL](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/models/project-workspace-import.ts:48)、[导入读取](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/project-transfer/import-service.ts:239)。

发布普通 Project file 时创建 Yjs 附件快照，后续经 createDocFromSnapshot 保存到 Workspace 页面。旧测试明确断言附件页面存在。这是历史设计与新原生文件模型的衔接缺口，不是所有 Project 发布都失败。

证据：[发布文件转换](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/project-transfer/publication-service.ts:634)、[保存页面](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/project-transfer/publication-service.ts:518)、[旧验收断言](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/__tests__/copilot/project-publication.e2e.ts:604)。

### 4.4 版本历史不等于版本恢复

Office 历史选择只切换展示修订，historical 会使编辑器只读；未找到恢复为当前版本的 mutation。Project 普通资源有按 sequence 读取 API，但编辑器只读取 revisions/current，没有完整历史恢复界面。Workspace Page 已有 recoverDoc 流程，必须保留复用。

证据：[Office 历史只读](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/components/office/resource-surface.tsx:102)、[Project 修订查询](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/project/resolver.ts:100)、[Workspace 恢复已有实现](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/components/affine/page-history-modal/data.ts:275)。

### 4.5 文件列表缺少当前资源状态的完整表达

Office 列表返回导入时名称和大小；UI 展示该大小，未读取 currentRevision 的大小。Files 组件没有资源变更订阅，当前只在初始化/手动请求时读取。集合或过滤视图下还会隐藏 Files 区块。

证据：[列表字段](/Users/dev2/Documents/project/LocalMind/packages/backend/server/src/core/office/file-controller.ts:54)、[列表加载](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/workspace/all-page/workspace-files.tsx:81)、[集合过滤](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/workspace/all-page/all-page.tsx:370)。

R01—R05 的详细调用链与已有复现见[前次代码复核](/Users/dev2/Documents/project/LocalMind/.codex-artifacts/crud-code-review-and-repair-plan-2026-09-28.md)。

## 5. 领域服务与数据设计

### 5.1 保留各类资源的现有内容模型

| 内容类型                            | 继续采用的真相来源                                      | 增量内容                                                                               |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Workspace Page / Edgeless           | BlockSuite/Yjs、既有同步与文档服务                      | 普通 AI 写入版本检查；不强制把 UI 本地编辑全部改成 HTTP                                |
| Project Page / Edgeless / 普通 file | ProjectResource + ProjectResourceRevision + ProjectBlob | file 保存/读取/历史能力；不另造 ProjectFileRevision                                    |
| 两侧 Office                         | OfficeArtifact + OfficeRevision + 原生包/语义状态       | Workspace 文件级状态、恢复/复制入口；不把 OOXML/PDF 内容存入 WorkspaceFile 或普通 Page |
| Workspace 普通原生文件              | WorkspaceFile 创建证据 + 新当前状态/修订                | 独立文件读取、更新与生命周期                                                           |

可共享类型化资源描述和管理服务，但“统一入口”不等于“统一成一个存储模型”。资源描述至少区分 owner、kind、resourceId、当前内容版本、元数据版本、生命周期状态和可执行能力。Office metadataVersion 与内容 revisionId 分离，改名不制造一次 Office 正文修订。

### 5.2 WorkspaceFile 保留不可变证据

现有触发器拒绝 WorkspaceFile 的任何 UPDATE，应保留这一保护。建议新增：

- WorkspaceFileState：一对一 fileId、workspaceId、当前显示名、metadataVersion、当前修订指针、trashedAt、不可恢复删除状态。
- WorkspaceFileRevision：fileId、workspaceId、sequence、parentRevisionId、Blob/MIME/大小/指纹、actor、来源、请求键和请求指纹。
- 更新回执/审计：绑定资源和操作身份，明确成功、失败和待对账状态；复用适合的既有事务/审计基础，不能假装直接 MCP 的凭据族回执天然适用于普通 AI 会话。

使用复合作用域外键、修订序号唯一键、稳定请求身份和数据库条件更新；当前修订必须属于同一个文件和 Workspace。旧记录回填初始状态与第一修订，不修改创建证据，不重写 Blob。相同创建请求重放返回原资源身份，不恢复创建时名称/内容，也不复活已删除资源。

人工创建新增明确来源，sourceSessionId 允许非 AI 来源为空；保留旧行的真实会话值及不可变规则。新增字段和约束应通过迁移设置，不能在应用层填假会话绕过。

### 5.3 Workspace Office 生命周期

继续使用 OfficeArtifact.title 作为当前标题。通过 Workspace 专属状态扩展补元数据版本、回收和不可恢复删除；Project Office 的状态继续由 ProjectResource 管理，避免两个状态源。

所有访问通道接入同一状态检查：列表、打开、package/state/part 下载、PDF 导出、历史读取、评论、AI 读取、命令执行及跨域导入。正常访问与回收站专用访问的规则必须明确，不能只从列表隐藏。

删除与正文保存按固定顺序获取资源/版本锁；已在回收站或已永久删除时新写入被拒绝。编辑器保留未提交草稿和错误反馈。永久删除首先采用不可恢复的产品删除语义，物理存储回收遵守审计/版本/副本引用保留策略，不承诺点击后立即清空历史 Blob。

### 5.4 Project 文件保存

在 ProjectResourceService 增加版本化 file 读取/保存：校验 kind、编码和格式，写不可变 ProjectBlob，再调用现有 appendRevision。继续使用原 resourceId、expectedContentVersion、requestKey、编辑租约和来源审计。

UI 文本编辑与 AI 文件更新共用服务。二进制文件采用显式“替换文件版本”，不送进 Markdown 转换。Project 现有资源管理和 Office 内容更新保持原服务。

### 5.5 创建、上传及容量

将生成/校验/持久化的可复用部分与 AI 会话授权拆开：人工入口按用户实时权限调用；AI 入口保留会话、来源、任务和现有审批规则。生成 Office 空白文件复用现有生成器与 import/revision 管线，不另写 OOXML。

Workspace 原生上传建立独立 WorkspaceFile，Markdown “转为 Page”保留为明确的另一个操作。新建 TXT/MD/CSV/JSON 和 DOCX/XLSX/PPTX 有无需模型的入口；PDF 支持导入及已有导出生成，不将空白 PDF 生成列为故障。

当前 WorkspaceFile 下载有 4 MiB 读取上限，而 AI 生成输入是有界的小文件。开放人工上传前必须统一上传/预览/下载/配额边界；较大文件应复用合适的流式 Blob 下载，不出现“上传成功但下载必失败”。文本编辑使用明确的字节/编码预算，超出范围仍可下载，不能截断后保存。

## 6. 操作协议、权限与 UI/AI 接入

### 6.1 写入协议

所有原位更新绑定 owner + resourceId + 预期内容/元数据版本。读取返回权威版本；同一写事务比较版本、核查状态/权限并持久化。完整替换必须确认读取覆盖完整内容，不能拿截断预览或分段摘要直接覆盖全文。

相同请求键和相同内容重放返回原结果；同键不同内容拒绝；网络结果不明时以回执和当前版本对账，不换 ID 重做。资源不存在、类型不符、版本冲突、权限撤回、租约丢失均返回真实错误。任何更新失败都不转换成新建同名副本。

R01 应复用 core/doc 的事务、锁和版本基础；公开直接 MCP 已有版本比较，但其普通 Markdown 结构限制不能不加区分地替换现有 AI 编辑能力。工具 schema 变更要同步冻结能力的兼容处理。

### 6.2 权限

- 普通 Workspace 操作沿用 UI 等价的实时 ACL。原生文件当前采用 Blob 权限，接入目录后还需相同的目录资源约束；不添加 actor-only audience 门禁。
- Project 内部成员读写、来源复制/分享授权、显式发布目标 ACL、编辑租约及现有工具审批继续执行。
- Workspace→Project 不是普通 Workspace 内部编辑。新增文件来源仍需复制/分享权限和持久来源授权，不能只凭 Blobs.Read 允许复制给整个 Project。
- UI 能力字段只用于展示；服务端每次读取/执行及提交时都要校验。隐藏菜单不承担授权。

### 6.3 AI 工具

| 类型                                                         | 实施方式                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 已有 Workspace 文档/目录、Project 资源管理、两侧 Office 编辑 | 保留并复用；仅对实际缺陷调整协议                                                 |
| Workspace 普通原生文件                                       | 补作用域明确的 list/read/update/meta/trash/restore 等工具，调用共同领域服务      |
| Project 普通文件                                             | 补 project_file_read/update；管理操作继续使用 project_resource_update_meta       |
| 历史恢复/独立复制                                            | 后续按明确意图接入专用工具，遵守该作用域现有运行规则                             |
| 不可恢复删除                                                 | UI 明确确认；AI 是否开放按破坏性操作策略单独定义，不因普通 delete 能力就自动授予 |

新增工具同步更新工具工厂、运行时注册、schema、允许执行枚举、任务命令协议、写副作用分类和冻结快照测试。当前未知名称可能默认归为 read，新增写工具必须显式分类。

旧 MCP 凭据、旧冻结任务不获得新能力。不把两个作用域混合注册，不恢复已退役的模糊工具别名。若变更旧契约，按既有备份、暂停 worker、retire-tool-contracts 流程完成切换，不重签旧快照来跳过限制。

### 6.4 公开 MCP

现行直接资源 MCP 的排除项有明确产品契约，本轮 UI/内部 AI CRUD 补全不自动改变它。若以后开放 Workspace 原生文件或直接删除，需要独立的工具 schema、capability、输出回执与显式授权。Project 公开 MCP 是单独范围，不能借旧 Workspace 凭据访问。

### 6.5 UI 工作流

两侧提供按类型的新建/上传、打开/下载、改名、移动、回收站入口；文本文件有编辑/保存、冲突与重读提示。Office 保留原生编辑器。历史恢复、另存副本与原位保存使用不同操作名称和资源身份。

覆盖 loading、empty、error、success、只读、无权限、重复提交、离线、草稿未保存和资源已删除等状态。列表展示当前标题、类型、当前修订大小和更新时间；提交后刷新当前资源及受影响目录，订阅提交后的变更事件并保留有界重连对账。

Workspace Files 不能继续只是“All pages 中额外的一块下载列表”。应接入类型化资源列表、回收站和搜索。收藏/标签/集合若在扩展阶段实现，也应使用原生资源类型，不伪装 docId；在此前清楚表示筛选范围，不让隐藏 Files 区块被误读为文件不存在。

## 7. 目录、查询与跨域流转

### 7.1 Workspace 目录

扩展后端目录 schema、组织服务、前端 node 类型及权限过滤，增加真实 native file / Office 资源节点。位置沿用既有目录存储，不在新文件状态表建立第二套可独立修改的 parentId。

移动校验源位置与目标目录的组织权限、目录版本、循环/深度限制和资源状态；复用现有文档位置语义。回收保存恢复所需的原位置，原目录已删除或不可访问时给出明确可选位置，不能静默越权恢复。

目录事务与文件状态更新必须原子协调。列表、直链下载、AI 读取、搜索及复制全部执行相同可见性规则，避免进入受限目录后只在 UI 隐藏。

### 7.2 搜索

Project 普通文本文件增加有界文本提取，复用 searchText/searchVersion；二进制无解析器时明确只有元数据搜索。Workspace 原生文件和 Office 增加派生的关键词索引，并在共享资源搜索结果中保留类型和导航地址。

复用现有 Office 内容解析，不建设第二套内容源。索引任务绑定内容修订，旧任务不能覆盖新版本索引；回收和撤权即时影响查询，不能等待异步索引删除才生效。结果提供索引状态/覆盖边界，不能把零结果解释为资源一定不存在。

### 7.3 Workspace 原生文件导入 Project

修改候选 SQL、资源描述/读取、复制授权和执行服务。sourceKind、源 ID、源版本必须共同确定资源，避免把新文件 ID 当作 docId 去检查或读取。

来源授权记录与冻结任务也要能区分 Page、Office、WorkspaceFile 和旧附件载体。新增类型不能复用一个原本只授权某种文档的旧授权。执行时重查来源可读/可复制/可分享、Project 成员、目标目录和来源版本；批准后建立独立 Project ID 与 Blob/修订。

来源刷新继续是显式行为，绑定源与目标双方的预期版本；来源后续改动不自动覆盖 Project 内部副本。

### 7.4 Project 普通文件发布到 Workspace

新发布写入 WorkspaceFile 的原生创建/修订服务，目标记录带明确资源类型；新文件不会生成附件 Page。已有 Page/Edgeless/Office 发布服务继续复用。

更新必须绑定已选择的 target kind、ID 和预期版本；目标被删、类型改变或版本冲突即失败。不按标题匹配新建，也不从旧附件页自动换绑为新文件。

旧 publication 回执、目标附件页面及冻结任务保留原语义：区分契约版本，提供受限兼容读取/更新或显式迁移，不能批量覆盖旧绑定。只有严格识别出的独立附件载体才可能迁移；包含正文/画布内容的页面保持原样。物理 Blob 可按现有机制去重，但各作用域的权限和当前版本独立。

## 8. 历史恢复与独立复制

Office 恢复取所选历史包/状态并追加新 revision，expectedParentRevisionId 指向当前版本，operationSummary 记录恢复来源；不修改历史记录。Project 普通文档/文件使用相同的“旧内容追加为新版本”原则，保留当前资源 ID、编辑租约和 CAS。Workspace Page 继续使用现有 recoverDoc，不另建平行历史系统。

独立复制生成新 ID，源当前版本固定，源资源不变；同作用域可以复用合法的不可变 Blob，但不可共享可变当前版本指针。跨作用域复制继续走导入/发布授权。第一批不要求递归复制大目录，也不把“更新失败创建副本”算作另存功能。

## 9. 数据迁移与兼容步骤

1. 盘点 WorkspaceFile、OfficeArtifact、ProjectResource、旧附件发布目标及未完成任务的数量、作用域和契约版本，不输出私密正文。
2. 增加 Workspace 文件状态/修订、人工来源、Office Workspace 状态和必要的类型化来源/目标字段及约束。
3. 从原 WorkspaceFile 创建证据回填 revision 1 和当前状态；Office 只回填 Workspace 生命周期状态，保留既有内容修订；Project 不重建修订表。
4. 先部署能读取旧/新记录的服务，再启用新写入口；旧创建回执和下载身份保持可对账。新目录、搜索及流转逐项启用。
5. 旧附件页面发布绑定按明确版本处理；迁移不能仅靠同名判定，也不清空旧审批、回执或审计。
6. 使用真实旧形态 fixture 在隔离库验证升级和中断重试；回滚通过关闭新入口、保留已有数据完成，禁止删除迁移后的业务数据来回退。

schema 变化同步 Prisma、GraphQL 服务端/operation/生成类型和消费者；使用仓库既有生成流程。修改现行产品契约时同步 Office README、Project Native Resources 和相应授权/流转文档；公开 MCP 未扩展时不改其能力清单。

## 10. 实施批次与依赖

| 批次                      | 交付范围                                                        | 依赖                   | 完成门槛                                                  |
| ------------------------- | --------------------------------------------------------------- | ---------------------- | --------------------------------------------------------- |
| S0 回归基线               | 修正过期测试夹具；建立隔离验证环境，保留可复现失败用例          | 无                     | 不放宽生产约束；已有 CRUD 回归结果可解释                  |
| S1 现有故障               | R01—R06；归档主壳入口可以作为同批 UI 小项                       | S0                     | 版本冲突不丢内容，归档可恢复，名称/错误/列表状态准确      |
| S2 Project 文件保存       | R11，及对应 UI/AI、修订索引更新                                 | S0                     | 同 ID 保存、冲突/租约/重试/撤权闭环；普通二进制不误转文本 |
| S3 Workspace 原生资源基础 | R07 的 Workspace 部分、R08、R09；同时补两侧人工 Office/文本创建 | S0；复用 S1 的写入规范 | 升级兼容、文件创建/读取/更新/回收/恢复/逻辑删除全链路通过 |
| S4 目录与查找             | R10、R12，列表/回收站/搜索状态统一                              | S2、S3                 | 文件进入目录后 UI、直链、AI、检索权限一致                 |
| S5 跨域流转               | R13、R14                                                        | S3；目录发布依赖 S4    | 原生类型往返、独立副本、来源/目标版本和审批回执正确       |
| S6 完整资源工作流         | R15、R16及剩余 UI/AI 一致性                                     | 各内容/生命周期基础    | 历史恢复创建新修订；复制创建新 ID；重新打开内容正确       |
| S7 总体验收               | 全资源矩阵、旧数据升级、真实浏览器与 AI、备份恢复及部署准备     | S1—S6                  | 每项有证据，失败/排除项明确，不能以单元测试代替上线验收   |

建议先完成 S1，再以 S2 交付一个完整的 Project 文件编辑闭环；随后执行 Workspace 基础、目录、流转和历史。批次中对应 UI 与内部 AI 同时完成，不能先上线按钮再留下工具/授权待补。

## 11. 验收矩阵

| 类别           | 必测场景                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| 类型覆盖       | Page、Edgeless、DOCX、XLSX、PPTX、PDF、TXT、MD、CSV、JSON、至少一种二进制文件；两侧分别记录                        |
| 新增           | 人工新建、导入、AI 创建；中文/重名/扩展名；非法格式与超限；网络重试只产生一个资源                                  |
| 查询           | 列表分页、目录/回收站、标题及支持的正文搜索、完整/分段读取、索引延迟、权限撤回与旧直链                             |
| 内容更新       | 同 ID 新版本、旧版本不变；读取后并发编辑、只读/历史模式、类型/编码不符、失败零副作用                               |
| 元数据         | 改名不丢内容，下载名更新；目录移动/排序冲突；当前名称和创建证据各自正确                                            |
| 删除恢复       | 文件和含子项目录；恢复原位置失效；回收与保存并发；永久删除不可恢复、旧链接/AI 不再执行                             |
| 历史/复制      | 历史内容追加新修订；源不变的新 ID 副本；重复请求、版本漂移、附件/图形/原生包保真                                   |
| 跨域           | WorkspaceFile↔Project file；Page/Office 旧能力不退化；来源仅可读不可复制、审批等待/撤回、目标 ACL 变化、旧附件回执 |
| Project 运行时 | 人工/AI 租约竞争、断线过期、任务等待、审批、取消、重试、worker 接管、当前成员撤销                                  |
| Workspace 授权 | 当前用户真实 ACL；共享 Workspace 正常写入，不追加 actor-only 门禁；目录受限文件全入口一致                          |
| 能力冻结       | 旧 MCP 凭据无新增能力；旧任务不能执行新 schema/工具；Workspace/Project 互斥、写副作用分类正确                      |
| UI             | loading/empty/error/success、重复提交、冲突和未保存草稿；跨标签页刷新、断网重连、浅/深色和窄屏                     |
| 数据           | 空库全量迁移、旧形态升级、中断回填重跑、不可变证据、跨作用域外键、配额与 Blob 引用、备份恢复                       |

Office 内容测试应按真实支持能力取样：DOCX 文本/段落/表格，XLSX 值/公式/行列/工作表，PPTX 幻灯片/形状/文本，PDF 批注/表单/页面/遮盖。保存后用原生包重开验证，不只检查 UI 返回成功。

现有测试债务：Project 资源与 Office 测试仍有 read_only 夹具，违反当前固定 read_write 契约；native-file Project 会话夹具缺 scopeType；会话旧异常/快照断言需校准。上一轮摘要可见性用例首轮失败、单独复测通过，原因仍未定，不标记为已修复。

数据库测试初始化会清表，只能在隔离库执行。普通改动使用既有 Linux 验证容器和固定镜像角色，先做聚焦测试；不为本方案重建镜像。实施到运行环境同步时遵守现有 schema/native 版本证据、备份和同步脚本约束。

## 12. 本次检查与未执行事项

本轮补查了新建/导入菜单、Files 列表、Office 内容命令与历史、普通文件服务和数据库约束、Project 索引、跨域候选/导入/发布、AI 工具和公开 MCP 契约。R06—R16 的判断主要来自源码和现有测试断言，没有在业务资源上实施改名、删除或迁移，也没有把它们记成新通过的运行测试。

此前的行为证据继续保留：前端 137 项通过、修正夹具后的 Project 资源/Office/native-file 20 项通过、隔离 Workspace MCP 37 项通过；归档恢复失败已在隔离库复现；普通 Workspace 旧全文覆盖机制已用生产 native 函数在 Linux 容器中复现。详见[原始审计报告](/Users/dev2/Documents/project/LocalMind/.codex-artifacts/crud-audit-2026-09-28.md)及[五项故障复核](/Users/dev2/Documents/project/LocalMind/.codex-artifacts/crud-code-review-and-repair-plan-2026-09-28.md)。

以上是制定方案时的检查记录；后续源码修改与验证单独记录在下节。它是当前检查范围内的完整待办，不是对所有 Office 格式边缘行为、移动端或生产环境“没有其他问题”的保证。

## 13. 实施进展

R01—R16 的实现均已落地：同版本读取与 CAS、归档恢复、当前下载名、类型化删除阻塞、列表事件刷新、两侧人工创建与上传、Workspace 文件状态/修订及 Office 生命周期、目录 ACL、Project 文件原位保存、派生索引、原生文件跨域导入发布、历史恢复和独立复制。UI 与内部 AI 共用领域服务，新增能力不进入旧 MCP 凭据和冻结任务。

S7 已完成隔离库资源回归、旧形态升级、真实备份业务数据恢复升级、本地开发实例迁移、浏览器 CRUD 和真实 Project 模型文件操作；完整证据、静态检查及范围边界以 [CRUD 实施记录](workspace-project-document-crud.execution.zh-CN.md) 为准。该记录取代旧的“只完成 S0/S1”阶段说明，不以本段文字代替验收证据。
