# Workspace / Project CRUD 实施记录

实施依据：[补全方案](workspace-project-document-crud-remediation.zh-CN.md)。日期：2026-09-28。
基线：`d390b39ed8` 与任务开始时已有的未提交改动。R01—R16 / S0—S7 已实现并完成本地验收。

范围补充（2026-09-28）：本记录保留当时领域服务及分离 Files 入口的验证证据。后续已完成原生文件与主页主列表、侧栏根目录、全局搜索及既有 Trash 的统一，侧栏「＋」承接新建与上传，旧 Files 面板已移除。新增文档/目录生命周期回执迁移。独立实施及验证证据见[统一资源体验修复方案第 7 节](workspace-unified-resource-experience-remediation.zh-CN.md#7-实施与验证记录2026-09-28)，不复用本记录测试数作为新增 UI 的通过证据。

本文取代首批 S0/S1 记录。代码、迁移与本地开发实例是本次交付对象；没有 commit、push、PR 或生产镜像发布。已有关系图、工单、上下文、侧栏等其他改动保留。

## 实现清单

| 范围                          | 当前实现与约束                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R01 Workspace Page / Edgeless | AI 正文与版本同快照读取；更新要求预期版本，在既有锁/事务内 CAS，审计失败一起回滚。继续复用 BlockSuite 内容与画布模型。                                       |
| R02—R05 既有故障              | Owner 恢复归档 Project；重复归档不重复撤回申请；删除阻塞分记忆/关联历史；Office 下载使用当前标题，导入证据不变；普通文本生成不再错误引导至 Office 命令。     |
| R06 列表一致性                | 名称/大小取当前状态；Files 分页重查去重、资源事件、聚焦/重连对账、撤权清除旧内容；服务端持久 outbox 提交后推送。                                             |
| R07 创建/上传                 | 两侧人工创建 DOCX、XLSX、PPTX、TXT、MD、CSV、JSON；原样上传普通文件，PDF 原生导入；人工来源不伪造 AI 会话。                                                  |
| R08—R09 Workspace 原生资源    | WorkspaceFile 创建证据/不可变修订/当前状态分离；Office 生命周期复用 OfficeRevision；读取、保存、改名、回收、恢复、产品永久删除共用领域服务。                 |
| R10 目录                      | 真实 file / office 节点、移动、目录版本、全部位置实时 ACL；目录回收/恢复/删除协调资源状态；旧 Office doc 节点继续承担目录权限，桌面/移动节点可打开原生资源。 |
| R11 Project 保存              | 文本完整读取与同 ID 保存，二进制显式替换；沿用修订、成员、租约、任务/审批；失败不创建同名副本。                                                              |
| R12 检索                      | 两侧文本/Office 的有界派生索引，旧资源后台分批回填，CAS 防止旧任务覆盖新索引；回收/权限即时过滤；无解析器的二进制仅搜索元数据。                              |
| R13—R14 跨域                  | WorkspaceFile 类型化候选/复制批准/独立导入/显式刷新；Project file 新发布为原生 WorkspaceFile；更新固定目标类型/ID/版本；旧附件页发布绑定保留原契约。         |
| R15—R16 历史/复制             | 有界历史/预览；恢复追加新修订，不改历史或倒退版本；复制生成新 ID，固定源版本及稳定回执；四种 Office 保留原生包与语义状态。                                   |

TXT/MD/CSV/JSON 编辑上限 1 MiB，要求完整 UTF-8，JSON 校验语法。原生文件上传/读取上限 32 MiB；超限文本下载或显式替换，不截断保存。永久删除采用产品不可恢复语义，审计/版本/独立副本引用的 Blob 仍保留。PDF 使用现有固定版式命令。纯本地原生同步、标签/收藏/集合接入、递归目录复制继续按方案排除。

## UI、AI 与协议

普通 Workspace 沿用实时 Workspace/Blob/全部目录位置 ACL，没有 actor-only audience 门禁。UI 能力字段仅用于展示，服务端提交时重新授权。Office 资产、下载、评论、命令与原始 Blob URL 都检查生命周期及目录 ACL。

内部 workspace*\* / project*\* 按会话互斥注册，新工具复用 UI 领域服务；Project 继续任务/租约/审批。完整替换绑定完整读取证据、ID、版本；稳定请求重放返回已提交结果，同键不同内容、旧版本、撤权、租约失效都拒绝。

workspace_file_create 目录支持使用契约 v2；Project 文件/历史/复制使用资源命令 v3；类型化导入/发布为 v2，旧 allowlist 与附件契约保留。公开 MCP 原有 10 个直接资源能力不变，旧凭据/冻结任务不自动获得新能力，旧目录工具不能借新节点类型扩大权限。

主要代码边界：core/doc、core/office、core/project-transfer、models/workspace-native-resource、Project 资源服务、Copilot 工具/运行时、共享 GraphQL、前端 components/native-files 与两侧页面。聚焦文件清单：`.codex-artifacts/crud-full-files.txt`。

## 迁移与本地运行环境

新增四个迁移，当前全量 404 个（基线 400 个）：

1. `20260928000000_workspace_native_resource_lifecycle`：人工来源、FileState/FileRevision、Office 状态、回执/outbox，回填既有文件初始修订。
2. `20260928001000_workspace_native_resource_integrity`：作用域/当前修订一致性、不可变历史及 Blob 引用保留。
3. `20260928002000_native_resource_transfer_contracts`：类型化来源授权和发布目标，保留旧任务语义。
4. `20260928003000_native_publication_receipt`：原生发布成功必须有对应修订及回执证据。

Prisma Client、GraphQL schema/client、i18n 使用仓库生成流程。隔离验证使用固定 `localmind-affine:dev-base`，源码挂载 `/workspace`，复用 Linux node_modules/native；`localmind_crud_full_runner`、`localmind_crud_full_pg`、`localmind_crud_full_redis` 位于独立 `localmind_crud_full_net`。AVA 清表仅作用于一次性 `crud_full` 数据库。重型验证串行，没有重建镜像或新增 tag。

旧形态升级：一次性 crud_upgrade 应用 400 个旧迁移，写入旧 WorkspaceFile/Office fixture，再应用新增四个；核对 ID、时间戳、来源、revision 1、旧 Blob、不可变历史及跨 Workspace 外键。日志：`crud-full-upgrade-fixture.log`、`crud-full-upgrade-migration.log`。

真实备份：`.docker/dev/backups/localmind-hot-pre-crud-20260928.dump`。第一次完整恢复因 Docker 磁盘不足中断，仅移除任务创建的失败恢复库；重试在一次性 crud_hot_upgrade 恢复全业务数据和 schema，排除四项 localmind_log_events\* 的 TABLE DATA，完成 404 个迁移。原完整备份保留，原业务库未删除日志；这是业务数据恢复升级验证，不宣称运行日志数据完整还原。日志/TOC：`crud-full-restored-upgrade.log`、`crud-full-backup-business-toc.txt`。

端口 3011 的本地实例已停后端/worker，额外备份 `.docker/dev/backups/localmind-hot-crud-cutover-20260928.dump`，应用迁移并执行退役检查：扫描 1 个 run，受影响/退役数量均为 0；随后通过既有 start.sh 重启。热开发环境直接挂载源码，不适用 /app 打包同步，不手工复制散落文件。记录：`crud-full-local-cutover.log`、`crud-full-local-restart.log`。

```sh
docker compose -f .docker/dev/localmind-hot/compose.json run --rm --no-deps \
  -e LOCALMIND_WORKERS_PAUSED=1 backend sh -lc \
  'node /workspace/node_modules/prisma/build/index.js migrate deploy && node --import=/workspace/tools/cli/register.js scripts/retire-tool-contracts.ts --apply'
.docker/dev/localmind-hot/start.sh
```

## 自动化证据

下表日志均在 `.codex-artifacts/`，重复执行不重复计数。

| 日志                                                         | 结果/覆盖                                                                                                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| crud-full-final-resource-matrix.log                          | 46 项：Workspace native 11、Project Office 6、Workspace 导入 13、ProjectResource 16；覆盖文本/二进制、Page/Edgeless、四种 Office、同 ID 保存、历史、冲突/租约/撤权、恢复复制、来源审批及冻结任务。 |
| crud-full-final-transfer-directory.log                       | 28 项：发布 9、目录 10、既有 Workspace 文件夹工具 9；含四 Office 原生包/目标修订、ACL、取消、目录回收恢复。                                                                                        |
| crud-full-final-ui.log                                       | 34 项：创建/编辑/草稿/重试/只读、Project 归档恢复、文件预览、Files 分页刷新、Office session、文件名。                                                                                              |
| crud-full-browser-gql.log                                    | 1 项通过：直接使用前端生成请求的新建/保存/读取/冲突回归；浏览器发现 GraphQL 片段问题后新增，修正生成输入并重新生成。                                                                               |
| crud-full-final-backend-types.log                            | 后端完整 TypeScript。                                                                                                                                                                              |
| crud-full-final-frontend-types.log                           | 修改前端文件聚焦 TypeScript，不等于整个 monorepo typecheck。                                                                                                                                       |
| crud-full-backend-eslint.log / crud-full-frontend-eslint.log | 仓库 ESLint 规则，缩小 TypeScript roots 避免全仓 OOM。                                                                                                                                             |
| crud-full-final-oxlint-linux.log                             | Linux 类型感知 oxlint，最后通过批次为 0 warning / 0 error。                                                                                                                                        |

最终后端不同用例共 75 项：资源矩阵 46、发布/目录 28、新增 GraphQL 请求 1；新增请求后 Workspace 整套 12 项再次通过（`crud-full-final-workspace.log`）。最后 UI 收尾的类型/lint 结果见 `crud-full-browser-polish-check.log`。

首批 S0/S1 后端 51 项，以及原生创建/Office 资产与命令等额外聚焦测试保留日志，不与上表简单相加。并行 OOM、恢复磁盘不足、过期夹具、确认按钮缺文案、GraphQL 片段及 Office 更新分支错误的失败记录保留；修复后复验，中断不记为通过。

核心验证命令（数据库测试只能在隔离 runner 执行）：

```sh
docker exec -w /workspace/packages/backend/server localmind_crud_full_runner yarn prisma migrate deploy
docker exec -w /workspace localmind_crud_full_runner yarn workspace @affine/server test \
  src/__tests__/copilot/workspace-native-crud.e2e.ts \
  src/__tests__/copilot/project-office.e2e.ts \
  src/__tests__/copilot/project-workspace-import.e2e.ts \
  src/__tests__/models/project-resource.spec.ts
docker exec -w /workspace localmind_crud_full_runner yarn workspace @affine/server test \
  src/__tests__/copilot/project-publication.e2e.ts \
  src/core/doc/__tests__/workspace-organization.spec.ts \
  src/__tests__/copilot/copilot-workspace-folder-tools.spec.ts
docker exec -w /workspace localmind_crud_full_runner yarn vitest run \
  packages/common/office/src/format.spec.ts \
  packages/frontend/core/src/components/native-files/native-files.spec.tsx \
  packages/frontend/core/src/desktop/pages/intelligence/project-tree.spec.tsx \
  packages/frontend/core/src/desktop/pages/intelligence/project-file.spec.tsx \
  packages/frontend/core/src/desktop/pages/workspace/all-page/workspace-files.spec.tsx \
  packages/frontend/core/src/components/office/resource-session.spec.tsx --maxWorkers=1
docker exec -w /workspace localmind_crud_full_runner yarn tsc \
  -p packages/backend/server/tsconfig.json --noEmit --composite false --incremental false
docker exec -w /workspace localmind_crud_full_runner node \
  .codex-artifacts/crud-full-typecheck.mjs packages/frontend/core
docker exec -w /workspace localmind_crud_full_runner sh -lc \
  'xargs yarn lint:ox --threads=1 < .codex-artifacts/crud-full-files.txt'
docker exec -w /workspace localmind_crud_full_runner node \
  .codex-artifacts/crud-full-eslint.mjs packages/backend/server
docker exec -w /workspace localmind_crud_full_runner node \
  .codex-artifacts/crud-full-eslint.mjs packages/frontend/core
git diff --check
```

## 浏览器与真实模型

使用本地端口 3011、独立项目“CRUD 验收 2026-09-28”，未修改用户已有项目资源。

- 真实模型 project_file_create → project_file_read → project_file_update：ai-crud-check.txt 第一版更新为第二版，同一 ID `c0da5de3-07cd-4d79-afad-d1dda93d8298`，最终 v2，没有副本。
- 浏览器保存 v3，再恢复 v2 内容产生 v4，v1—v3 保留；复制 browser-copy.txt 在列表出现。截图：`.codex-artifacts/crud-project-history.png`。
- 后端热重载短暂断线时页面显示重连状态，恢复后读到已保存内容。恢复/删除/丢弃草稿确认按钮文字已补齐，并增加文案断言。
- Workspace：人工新建 JSON，正文保存生成 v2；历史展示 v1/v2；重命名、回收、从回收站恢复、正文搜索均通过；移动到 First Folder 后原生文件节点出现。
- Workspace Office：人工空白 DOCX 创建、原生段落编辑生成 v2、恢复空白版生成 v3、再次恢复文本版生成 v4。
- CSV 原样上传自动打开原生文本编辑器；JSON 实际下载位于本机 Downloads，文件名为 crud-workspace-renamed.json，解析内容与已保存正文一致。浏览器下载事件捕获超时，使用实际落盘文件核对成功。
- 数据库只读复核：JSON 的同一 ID 为 `88bb42ca-50e2-4f1b-9771-1a42d50435cc`，创建名仍为 crud-workspace-check.json，当前名为 crud-workspace-renamed.json，内容版本 2、元数据版本 5、两个不可变修订；人工来源无伪造会话，恢复后状态 active。证据：`crud-full-browser-db-verification.log`。
- 浅色与深色布局可读，主题恢复到原先的“跟随系统”。Project 实际截图视口约 735×902，Workspace 后台标签为 1280×720；未将未生效的 600 px 视口请求记成验收。截图：`crud-workspace-history.png`、`crud-workspace-dark.png`。
- 独立测试项目与 crud-\* 文件保留用于手工复验；没有对业务文件执行删除、重命名或移动，也未在业务实例执行永久删除。永久删除/撤权/并发/冻结权限等危险路径在隔离测试库验证。

Active track：Project Native Resources / Project Workbench Redesign。Office 以 `docs/office-native/README.md` 为准，Workspace 写入沿用实时 ACL 契约。

## 收尾与运行限制

最后的后端完整 TypeScript、33 个改动前端文件的聚焦 TypeScript、仓库规则 ESLint、类型感知 oxlint、Prettier、`git diff --check` 与冲突标记检查均通过。前端文件选择器受全局样式影响而重复显示的原生控件已隐藏，实际按钮上传验证通过；原生目录图标不再把树状态属性透传到 SVG。

所有验证完成后确认 runner 仅剩 sleep，再停止三个本任务创建的 --rm 容器，移除 localmind_crud_full_net；其一次性测试/升级/恢复数据库与匿名卷随容器清理。业务服务、已有验证环境、备份和其他卷未删除。最终 `docker system df`：Images 31.88 GB、Containers 4.28 GB、Volumes 9.049 GB、Build Cache 3.586 GB；没有重建镜像。Docker 数据盘 59 GB，约 2.1 GB 可用，仍需在后续重型构建前重新评估容量。

本记录证明文档约定在线范围的本地实现与验收，不代替其他部署环境的生产切换、完整 monorepo 构建或所有 Office 格式的任意边缘编辑功能保证。真实模型验证在 Project 作用域；Workspace AI 由调用实际领域服务的集成用例验证，本轮未另行消费 Workspace 模型调用。
