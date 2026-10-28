# Workspace 双容器 v2 独立候选执行记录

2026-10-27 补充：旧目录侧栏的页面／白板创建已增加原子提交与持久重试，见 [QA-119 执行记录](workspace-folder-page-creation.execution.zh-CN.md)。该修复仅覆盖尚未切换页面树的旧目录入口；双容器 v2 保持既有创建协议，不开放旧协议回退。

日期：2026-10-09（America/Los_Angeles；容器日志日期为 2026-10-10 UTC）。

本记录对应[开发契约](workspace-resource-tree-dual-container-development.zh-CN.md)。实现和隔离验证位于 `/Users/dev2/.codex/worktrees/workspace-page-tree/LocalMind`，分支 `codex/workspace-page-tree`。用户于 2026-10-09 体验后授权合入本地 main；本次本地集成包含资源树、资源显示／排序依赖及删除两条侧栏常驻提示的调整。未推送、创建 PR、部署或迁移业务库。其他未提交改动保留；日志、截图、数据库备份和本机体验配置不进入提交。

## 体验入口

- v2：<http://127.0.0.1:3183>，合成账号 `resource-tree@example.local`，密码 `1`。
- 工作区：`双容器资源树 · 隔离体验`，ID `f01ce6b0-3fee-4186-9c47-0afa02e759fc`。
- v1：<http://localhost:3181>，原体验账号和已有编辑保留。v1 已改为挂载冻结源码和独立旧 Prisma Client，不再跟随本 worktree 热更新。
- v2 提供根／文件夹／页面的新建菜单，混合移动、排序撤销、回收恢复、文件夹改名和“转为页面”；已有页面继续使用原生编辑器。

**未开放页面转文件夹。** 反向转换所需的正文历史归档尚未实现，服务端与 UI 均不提供入口。文件夹转页面仅在服务端能证明新页面访问范围等价时开放；当前要求非公开 Workspace 且默认成员文档角色为 manager，目录及文档创建权限仍分别检查，不静默改变共享范围。

## 改动边界

- 共享 `localmind-page-tree/v2` 协议增加 folder、成对的创建／更新证据、独立资源版本、容器能力和类型化上传。Yjs folders 仍为位置权威；不新建第二份 SQL 目录图。
- 新增 `20261010023500_workspace_resource_tree_v2` 迁移，保存带类型的迁移映射及不可变转换证据。旧 v1 plan、mapping、receipt 和迁移文件保留。
- 领域服务实现 folder 创建／改名／前向转换、双容器位置授权、生命周期、转换别名及 CAS。修复原生文件访问路径把所有祖先都当作页面的问题。
- GraphQL schema、operation 和生成类型通过仓库生成命令同步；旧客户端不带 v2 契约时明确拒绝。
- Web／共用 Electron 路由及 mobile 路由增加文件夹列表；侧栏、面包屑、创建菜单、移动选择器、混合元数据及显示偏好支持双容器。文件夹没有正文和标签伪数据。
- 本地适配器保留 legacy 文件夹和已切换 v1 页面；journal、转换和 typed 上传保留资源 ID。导入目录创建文件夹，不生成占位文档。
- Workspace 内部 AI 新增受限 folder create／rename／convert，复用实时 ACL 和持久回执；不注册到 Project、私人工单、外部委托旧任务。公开 MCP 不扩权。
- Project 新发布命令为 v4，绑定 v2、parentKind、稳定 nodeId 和版本；旧 v3 不自动升级。Office 和 WorkspaceFile 内容域不变。
- 修复创建／改名共用 PromptModal：每次打开正确初始化默认值、失败保留输入并显示安全错误、重复点击去重、迟到结果不关闭新弹窗。

## 隔离与备份

复用 `localmind-affine:dev-base`，未重建镜像；本机没有 `localmind-affine:test`。Redis 复用已存在的 `redis:7-alpine` 镜像，未发布端口。

| 对象          | 隔离资源                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v1 体验       | `localmind_page_tree_preview`／`localmind_page_tree_web`，3180／3181，`page_tree_preview`，冻结 v1 源码                        |
| v2 体验       | `localmind_resource_tree_v2_preview`／`localmind_resource_tree_v2_web`，3182／3183，`resource_tree_v2_preview`，独立 Blob 路径 |
| v2 同步／缓存 | `localmind_resource_tree_v2_redis`，与 v1 和测试分开                                                                           |
| 聚焦验证      | `localmind_page_tree_validation`，`resource_tree_v2_test`，`localmind_resource_tree_test_redis`                                |
| 升级演练      | `resource_tree_v2_upgrade`，从 v1 备份恢复后应用新迁移并升级                                                                   |
| 回滚演练      | `resource_tree_v1_rollback`／`localmind_resource_tree_v1_rollback`，冻结 v1 源码和旧 Prisma 读取恢复数据                       |

本地证据保存在 `.codex-artifacts/workspace-resource-tree-v2/`，不纳入业务产物：

- `v1-source/`、`v2-baseline.json`：开发前 11,678 个源码文件快照及哈希；新增改动清单单独与此基线比较，不能把整个 dirty worktree 当成本轮修改。
- `v1-preview-before-v2.dump`、`v1-storage/`：停止 v1 写入后取得的 DB＋Blob 备份；冻结后恢复旧体验服务。
- `upgrade-result.json`：2 个真实 v1 合成体验工作区、15 个根／页面／属性文档升级前后字节哈希一致，包括用户在 v1 的编辑。
- `rollback-result.json`、`rollback-blob-hashes.json`：新建回滚数据库恢复旧 schema 和成套 Blob；旧运行时成功读取 11 个文档、3 个原生资源，Blob 文件哈希一致。原 v1 和 v2 体验库均未被回滚操作覆盖。
- `changed-files.json`、`logs/`：增量源文件和命令结果；`screenshots/`：桌面浅色中文创建菜单、桌面深色及 390×844 窄屏深色截图。

体验数据保存在一次性 PostgreSQL 容器中；退出／删除该容器可能失去内存盘内容，因此另保存交付时的 v2 DB＋Blob 备份。不要删除现有容器或 volume 来切换版本。

## 验证命令与结果

以下 shell 命令中的 `$V2_TEST_DB` 为 `postgresql://affine:page-tree-isolated@localmind_page_tree_pg:5432/resource_tree_v2_test`，仅为隔离合成测试数据库。

```sh
# 真实 Prisma / GraphQL / i18n 生成（不手改生成文件）
docker exec localmind_page_tree_validation yarn workspace @affine/server prisma generate
docker exec -e DATABASE_URL="$V2_TEST_DB" localmind_page_tree_validation yarn workspace @affine/server prisma migrate deploy
docker exec -e NODE_ENV=test -e DATABASE_URL="$V2_TEST_DB" localmind_page_tree_validation node /workspace/.codex-artifacts/workspace-resource-tree-v2/generate-schema.ts
docker exec localmind_page_tree_validation cp /workspace/packages/backend/server/node_modules/.cache/schema.gql /workspace/packages/backend/server/src/schema.gql
docker exec localmind_page_tree_validation yarn workspace @affine/graphql exec gql-gen
docker exec localmind_page_tree_validation yarn workspace @affine/i18n build

# 领域及 Project 发布（38 项）
docker exec -e REDIS_SERVER_HOST=localmind_resource_tree_test_redis -e DATABASE_URL="$V2_TEST_DB" localmind_page_tree_validation yarn workspace @affine/server test --timeout=3m src/__tests__/copilot/workspace-page-tree.e2e.ts src/__tests__/copilot/project-publication.e2e.ts

# MCP、权威只读、同步回归（30 + 10 + 26 项）
docker exec -e REDIS_SERVER_HOST=localmind_resource_tree_test_redis -e DATABASE_URL="$V2_TEST_DB" localmind_page_tree_validation yarn workspace @affine/server test --timeout=3m src/__tests__/copilot/copilot-mcp-resources.spec.ts src/core/doc/__tests__/reader-from-database.spec.ts src/__tests__/sync/gateway.spec.ts

# 前端、共享协议、导入与弹窗（123 项）
docker exec localmind_page_tree_validation yarn vitest run packages/frontend/component/src/ui/modal/prompt-modal.spec.tsx packages/common/graphql/src/workspace-page-tree.spec.ts packages/frontend/core/src/modules/organize packages/frontend/core/src/desktop/dialogs/import/commit-service.spec.ts packages/frontend/core/src/components/native-files/resource-display.spec.ts packages/frontend/core/src/components/native-files/resource-selection.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/project-publications.spec.tsx packages/frontend/core/src/modules/workspace-resources --maxWorkers=1

# 产品包和两份后端测试类型检查
docker exec localmind_page_tree_validation node --max-old-space-size=12288 node_modules/typescript/bin/tsc -b packages/frontend/core packages/backend/server --pretty false
docker exec localmind_page_tree_validation node --max-old-space-size=8192 packages/backend/server/scripts/typecheck-copilot-tests.mjs --file src/__tests__/copilot/workspace-page-tree.e2e.ts
docker exec localmind_page_tree_validation node --max-old-space-size=8192 packages/backend/server/scripts/typecheck-copilot-tests.mjs --file src/__tests__/copilot/project-publication.e2e.ts

git diff --check
```

新增及变更源文件使用 `check-files.cjs` 调用仓库 oxlint（deny warnings）和 Prettier；结果以 `logs/lint.log`、`logs/format-check.log` 为准。未构建桌面／移动安装包。最终 `docker system df`：镜像 31.02 GB、容器 1.701 GB、卷 22.45 GB、构建缓存 4.81 GB；未删除无关镜像、容器或 volume。

首次扩大回归时，在线人数统计受共用 Redis 广播影响，另有一次旧 Project grant 撤销 fixture 时间约束失败。拆分 Redis 后，同步文件全部 26 项通过；单独重跑 Project scope 和新 v4 发布也通过。保留首次失败日志，不把重跑描述为从未失败。

## B01—B40 证据与限制

“通过”仅针对列出的候选环境和测试规模；未列举的真实设备、生产库和长时间压力验证不包含在内。

| 编号 | 本轮证据／结论                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01  | 通过：领域服务、本地适配器及浏览器验证真实 folder，不存在同 ID 正文；根、页面、文件夹允许创建。                                                                                                 |
| B02  | 通过：共享图和领域创建测试验证 page／edgeless，白板拒绝接收下级。                                                                                                                               |
| B03  | 通过：根／page／folder 各 8 种内容（DOCX、XLSX、PPTX、PDF、TXT、MD、CSV、JSON）创建及混合恢复；修订链保持不变。浏览器已验证文件夹内创建 Word 并进入原生编辑器；上传完整文件选择器未逐格式操作。 |
| B04  | 通过：浏览器页面→文件夹→子文件夹，转换后页面及混合列表；面包屑及移动目标读取同一图。                                                                                                            |
| B05  | 核心通过：复用资源选择和类型化身份；folder 元数据、无标签显示。浏览器批量操作未逐项覆盖。                                                                                                       |
| B06  | 核心通过：随机身份、请求键回执、重复导入／创建及旧身份拒绝；同名不会覆盖。                                                                                                                      |
| B07  | 核心通过：移动不改内容域；共享图、服务版本及浏览器文件夹带子页面移动。所有 Office 格式移动依赖共用流程，未逐个浏览器拖放。                                                                      |
| B08  | 通过：环、自身／后代、叶子目标、跨 Workspace、64 层及整棵子树校验。                                                                                                                             |
| B09  | 通过：完整同级排序和撤销、隐藏同级拒绝、并发 revision 冲突；显示排序与手动位置独立。                                                                                                            |
| B10  | 核心通过：异步状态、同请求重放、账号切换迟到结果隔离、弹窗重复点击与失败保留输入测试。未人工断网覆盖全部入口。                                                                                  |
| B11  | 核心通过：目录 canCreateFolder 与页面创建能力分别计算；禁止新建文件夹时仍可创建页面的服务测试通过。全部自定义权限组合未穷举。                                                                   |
| B12  | 核心通过：移动整条路径权限、转换访问范围等价门禁、授权版本漂移。不能证明转换权限等价时拒绝。                                                                                                    |
| B13  | 通过：隐藏路径列表／预览／直接请求拒绝；预览上限 20，迟到新增子项使确认失效。                                                                                                                   |
| B14  | 核心通过：目录管理识别两类容器，原生资源复用目录路径授权；父页面分享不赋予子文档读取权限。未做多浏览器公开分享专项。                                                                            |
| B15  | 通过：混合子树回收／恢复，保留原生内容、不可变修订和先前独立回收标记。                                                                                                                          |
| B16  | 核心通过：恢复失败不静默落根，复用显式双容器位置选择；未逐个浏览器恢复冲突场景。                                                                                                                |
| B17  | 核心通过：删除、旧导入身份重放、墓碑和不可变证据回归；folder 走目录授权，无假原生资源删除。                                                                                                     |
| B18  | 通过：folder→page 保留 nodeId／下级／位置，生成真实正文及转换证据；浏览器确认可进入编辑器。                                                                                                     |
| B19  | 核心通过：转换回执重放、元数据／树／授权 CAS、注入正文创建后失败，事务完整回滚；转换是短事务，没有独立转换 worker／租约。                                                                       |
| B20  | 安全边界通过：服务端只支持 folder→doc，反向命令不在 schema，UI 隐藏。尚未实现空白／未知块细分的反向转换。                                                                                       |
| B21  | 未开放：页面历史归档及反向转换未实现。                                                                                                                                                          |
| B22  | 部分：前向转换与结构并发 CAS、旧链接解析通过；往返转换和反向期间正文并发未开放。                                                                                                                |
| B23  | 通过：legacy 空白／嵌套目录保留为 folder，无额外页面；未知作者／时间成对为 null。                                                                                                               |
| B24  | 通过：旧多位置授权等价冲突和回收 manifest 迁移；不会复活已独立回收资源。                                                                                                                        |
| B25  | 通过：真实 v1 备份恢复后两工作区升级，15 个文档原始字节不变，已编辑页面不降级。                                                                                                                 |
| B26  | 核心通过：新 checkpoint／lease CAS、旧 plan 不可变；未完成 v1 plan 明确要求在冻结 v1 运行时恢复／取消，v2 不重新解释旧计划。                                                                    |
| B27  | 核心通过：全新库全部迁移、legacy fixture→v2、真实 v1 schema＋数据升级及 DB＋Blob 成套回滚；旧运行时读取和 Blob 哈希通过。没有生产规模备份演练。                                                 |
| B28  | 通过：旧契约写入拒绝、原始 folders／根 lifecycle／mode 同步拒绝，folder marker 只由受控服务写入。                                                                                               |
| B29  | 通过：本地 v1／legacy 升级、持久化 journal、重启／失败恢复、转换不重复建页面。                                                                                                                  |
| B30  | 核心通过：typed 上传 folder＋doc 清单、位置／ID、无假正文、本地适配器重启测试；未做完整多账号浏览器上传长流程。                                                                                 |
| B31  | 核心通过：本地来源／账号 generation 与不兼容目标拒绝的前端服务回归；无隐式替代 Workspace。                                                                                                      |
| B32  | 通过：导入 12 项测试，目录保留 folder，Notion 页面仍可带子项，正文 subpage 转普通引用；只为页面建立真实正文。                                                                                   |
| B33  | 通过：AI folder create／rename／convert 共用回执和权限，缺少转换意图／明确否定请求拒绝，旧 task／scope 变化拒绝。                                                                               |
| B34  | 核心通过：公开 MCP 30 项回归，跨域不注册；没有新增公开双容器写能力。                                                                                                                            |
| B35  | 通过：Project 发布 12 项；v4 冻结 folder 类型，伪 v3＋v2 命令拒绝；页面／根的 Office 和原生文件发布、原位更新仍保持独立修订。                                                                   |
| B36  | 核心通过：folder 事件成对、结构操作不刷新内容证据、未知来源不造作者，旧页面显示偏好兼容；未枚举所有语言／时区。                                                                                 |
| B37  | 核心通过：旧 folder URL 浏览器重定向到转换后的真实页面，服务旧身份别名和权限检查通过；搜索／收藏依赖统一 doc 路由，未逐入口浏览器操作。                                                         |
| B38  | 核心通过：共享图 15,001 节点及 64 层边界，前端全层和账号切换回归；不是生产数据量端到端性能压测。                                                                                                |
| B39  | 浏览器验证：桌面、窄屏、浅／深色、键盘操作和截图；未执行真机触摸或移动／Electron 安装包。                                                                                                       |
| B40  | 通过：权威只读 10 项，同步 26 项；0.25／0.26 网络发现不占写锁、广播前重查撤权。                                                                                                                 |

用户体验后已授权本地集成。此记录不构成上线或生产迁移验收。

## 2026-10-09：本地子页面创建、回车与中文文案回归

当前主工作树的本地环境复现了“新建子页面”失败。销售区根文档可由 Yjs 读取，
但 native 注册增量在 Yjs 回放后没有新增页面，旧兼容分支因此生成整份替换快照。
双容器事务拒绝这种替换，最终返回 `failed_to_save_updates`。本轮在有效 Yjs 页面
数组上增加原位增量登记，保留原有 CRDT 身份、未知元数据及事务内禁止整份替换
的保护；非事务根文档压缩也使用 Yjs，避免再次依赖不兼容的 native 编解码。
没有修改 schema、迁移、正文或 OfficeRevision。原始 native 根文档读取兼容问题
仍存在；本轮证明的是创建登记兼容路径，不代表 Rust 解析器已修复。

共享 PromptModal 现在将输入框回车接到与按钮相同的确认操作，保留失败后的输入
及保存中的防重复提交；中文输入法候选确认、长按回车和空白必填名称不触发保存。
2026-09-28 的原生文件创建回车修复仍在，此次缺失位于新增的页面树弹窗入口。
修正 5 处 `save` 为既有 `Save` 翻译键，复用属性、导出的既有键，并补齐关闭、
完成、发送、下载、加载更多、搜索标签、导出及工作区移除提示等 11 个缺失源键
的英文和简／繁中文词条。共享弹窗的默认取消／确认也改用翻译。新增静态检查
覆盖 core、component、admin 中的 `t['literal']`，不涵盖动态键及任意硬编码文案。

验证使用 `localmind-affine:dev-base`，没有重建镜像。后端在独立 PostgreSQL 内存盘
和 Redis 上应用 409 个迁移，2 项根文档增量测试及 26 项页面树 E2E 通过；前端
5 项弹窗测试和 1 项翻译键测试通过。最初隔离测试继承了运行环境的 script flavor，
导致模块缺失；清除此变量、使用测试 MockJobQueue 后 28 项后端测试全部通过。
修改文件的定向类型检查、oxlint、Prettier 及 `git diff --check` 通过。

浏览器在原文件夹 `Infinimesh` 中按回车创建用户原先输入的 `2026-09`，进入真实
编辑器并显示保存／同步完成；刷新后页面仍在。只读数据库检查确认页面 ID
`6a983e15-01a4-4b63-b195-afaa778dd388` 仅登记一次，创建回执仅一份，父节点仍为
`Dwl-vAi54oqU5R4szOVHQ`，树版本从 1 更新为 2。截图、检查脚本和日志位于本地
`.codex-artifacts/page-tree-create-fix-20261009/`。这不是完整 B01—B40 重验或生产验收。

```sh
docker --context colima exec localmind_create_regression node /workspace/.codex-artifacts/page-tree-create-fix-20261009/run-backend-checks.cjs migrate
docker --context colima exec localmind_create_regression node /workspace/.codex-artifacts/page-tree-create-fix-20261009/run-backend-checks.cjs test
docker --context colima exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --maxWorkers=1 packages/frontend/component/src/ui/modal/prompt-modal.spec.tsx packages/frontend/i18n/src/static-keys.spec.ts'
docker --context colima exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn workspace @affine/i18n build'
```

本轮仅停止并移除三个新建的隔离验证容器，保留运行中的本地服务、既有容器及
持久化 volume。收尾磁盘可用约 1.4 GiB；没有借此执行镜像重建或无关数据清理。

## 2026-10-11：页面树请求放大与限流恢复修复

本地浏览器日志曾在 60 秒内记录 154 次 GraphQL 请求，其中页面树读取 99 次、
树修改 11 次、目录读取 12 次。默认限流按登录会话共享，写后刷新又遍历所有展开
分支，叠加轮询后触发 `too_many_requests`。

本轮在保留当前工作树既有改动的基础上完成以下修复：

- `workspacePageTree` 与 `workspaceDirectory` 使用显式 `workspace-tree-read`
  限流桶，仍采用默认的每分钟 120 次配置；写入、审批及其他接口保留原额度。
  命名桶不依赖限额数值是否不同，管理员调整默认值后仍保持隔离。
- 写后刷新根据回执更新根节点、原／目标父级和路径受影响的可见后代；原生文件
  创建也只刷新根和目标。无效参数拒绝不再刷新全树。回收视图继续随生命周期操作
  更新，折叠分支的失效缓存在重新打开时读取。
- 已解析的资源身份与节点身份共享缓存；账号切换仍清除缓存并取消旧读取。
  迟到的旧快照不能覆盖新快照，树版本变化后的分页从首批重新获取，保持版本和
  权限快照检查，不拼接过期游标。
- GraphQL 客户端保留有界的 `Retry-After`，兼容 HTTP 200 的 GraphQL 限流错误及
  HTTP 429。并发失败只建立一轮冷却，目录通知和轮询也遵守冷却。权限读取失败
  仍清空权限状态，不保留过期授权。
- 写入已成功但根节点尚未校验时显示“已保存，正在同步资源树”，暂时禁止后续
  结构写入；成功回执与原有不确定结果幂等键规则保留。读取失败不再同时显示空目录。

Linux 容器验证复用 `localmind_hot_web` 的 `localmind-affine:dev-base`，没有重建
镜像、修改 schema／迁移或业务资源数据。85 项前端及共享层测试、3 项后端限流
测试通过；16 个相关源／测试文件的定向类型检查、oxlint、Prettier 和
`git diff --check` 通过。8 个展开分支中连续创建 10 次的写后读取由研究实验的
90 次降至 20 次；转换后代身份、迟到响应、原生创建范围、回收、账号切换及旧
版本写入阻断均有回归覆盖。

```sh
docker exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --maxWorkers=1 packages/frontend/core/src/modules/organize/services/page-tree.spec.ts packages/frontend/core/src/modules/organize/services/page-tree-local.spec.ts packages/frontend/core/src/modules/organize/stores/directory-access.spec.ts packages/frontend/core/src/modules/navigation-panel/services/created-resource.spec.ts packages/common/graphql/src/__tests__/fetcher.spec.ts packages/common/error/src/__tests__/index.spec.ts packages/frontend/i18n/src/static-keys.spec.ts'
docker exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn workspace @affine/server ava --serial src/__tests__/nestjs/throttler-bucket.spec.ts'
docker exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --pool=threads --maxWorkers=1 packages/frontend/core/src/modules/organize/services/page-tree.spec.ts'
docker exec -w /workspace localmind_hot_web yarn tsc -b packages/common/error packages/common/graphql
docker exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn workspace @affine/i18n build'
docker exec -w /workspace localmind_hot_web node .codex-artifacts/page-tree-throttle-fix-20261011/typecheck.mjs packages/frontend/core
docker exec -w /workspace localmind_hot_web node .codex-artifacts/page-tree-throttle-fix-20261011/typecheck.mjs packages/backend/server
docker exec -w /workspace localmind_hot_web node .codex-artifacts/page-tree-throttle-fix-20261011/typecheck.mjs packages/common/error
docker exec -w /workspace localmind_hot_web node .codex-artifacts/page-tree-throttle-fix-20261011/typecheck.mjs packages/common/graphql
```

本地开发容器直接挂载当前源码，后端 nodemon 和前端热更新已加载改动，无需复制
到部署容器。浏览器刷新后连续切换“2 → 22 → 2222”，目录及路径正常，原限流
提示消失；截图位于 `.codex-artifacts/page-tree-throttle-fix-20261011/browser-after.jpg`。
验证没有向业务库批量创建测试资源，没有进行生产规模多用户／大目录压力测试，
也不构成完整 B01—B40 重验或业务环境部署验收。

## 2026-10-12：侧栏拖放落点、完整排序与跨父级撤销

本轮按实际代码评审修复侧栏拖放，不新增 Page 顶部入口、正文索引块或第二套列表刷新机制。现有 `PageTreeChildrenList`、底部索引、侧栏与直属列表的独立显示偏好继续使用原实现；本轮没有修改它们。

### 实现

- 树行提供标题单行引用；原生拖放的提示与提交共用 `before / after / inside` 判断。排除展开子树、加载和错误区域的高度，复用已有 `DropIndicator` 与悬停展开，避免两套落点处理同时提交。
- 前后拖放、菜单上移／下移和 Alt+方向键共用排序算法：先移除源节点，再确定目标前后的位置。完整同级顺序不变时不提交；名称排序切换到手动排序时一次保存全部同级顺序，避免其他项跳位及自身插入锚点。
- 原有 `siblingOrder` 仍用于同级重排；跨父级增加 `targetSiblingOrder`，逆向移动增加 `sourceSiblingOrder`。在线组织事务与本地持久化日志均校验移动后的完整活动层级、资源身份及重复项。在线入口继续逐资源检查实时 ACL、目录组织权、子树授权变化、树与权限版本及幂等请求键。
- 操作回执仅为被重排的层级保存 `oldTargetSiblingOrder / oldSourceSiblingOrder`。撤销沿用原来的版本门禁，在一次移动事务中恢复父级和被改动的层级顺序；历史回执缺少新字段时按 null 解释，不改写历史证据。未被重排的源层级仍用原插入锚点恢复，不额外暴露完整源目录。
- 去掉依据旧缓存跳过“移入容器”的优化。重复同级重排在完整顺序上判断；容器移动由权威服务执行。没有改变正文引用、内容更新时间、OfficeRevision 或 WorkspaceFile Blob。

### 验证

复用固定 `localmind-affine:dev-base` 镜像及热开发容器；新建本轮验证容器 `localmind_page_tree_drag_validation`，使用已有隔离 PostgreSQL／Redis 服务和专用数据库 `page_tree_drag_20261012_7b81`。409 个现有迁移全部应用到该新库；没有新增数据库迁移或修改业务库 schema。GraphQL schema 由开发后端生成，共享 operation/types 使用 `gql-gen` 生成，未手写生成产物。

- 78 项前端／共享层测试通过：行落点、名称正逆序、相邻重复拖放、跨父级完整顺序、本地持久回执、逆向移动、版本冲突、缓存刷新以及桌面／移动端树行回归。
- 3 项在线领域测试通过：跨父级移动与两层撤销、原生 TXT 的移动／撤销及内容证据保持、重复请求回执、部分／重复顺序拒绝、无权 actor 拒绝、并发版本与撤销门禁、既有完整同级排序。
- 前端 9 文件、后端 3 文件的聚焦 TypeScript 检查及共享 GraphQL declaration build 通过；定向 oxlint、Prettier 和 `git diff --check` 通过。
- 浏览器创建临时目录和三个空白 Page：B、A 同级，C 属于 B。实际验证展开 Page 中央移入、跨父级移动和撤销；名称正序下把 C 拖到 A 后面，结果为 A、C、B，一次撤销恢复 B、A 及 C→B。操作回执的树版本为 31→32，两层恢复发生于同一版本提交。B 的现有底部索引随移动清空，撤销后恢复 C。
- 4 项浏览器临时资源已整体回收，回执版本 33；没有永久删除。用户已有资源的归属和正文未改动，临时收起的两个原分支及原文件夹视图已恢复。

主要命令（下述连接仅对应本轮专用合成测试库）：

```sh
DRAG_TEST_DB='postgresql://affine:page-tree-isolated@localmind_page_tree_pg:5432/page_tree_drag_20261012_7b81'
docker exec -e DATABASE_URL="$DRAG_TEST_DB" -w /workspace localmind_page_tree_drag_validation yarn workspace @affine/server prisma migrate deploy
docker exec -e DATABASE_URL="$DRAG_TEST_DB" -e REDIS_SERVER_HOST=localmind_resource_tree_test_redis -e NODE_OPTIONS='--import=/workspace/tools/cli/register.js --max-old-space-size=4096' -w /workspace localmind_page_tree_drag_validation yarn workspace @affine/server test --timeout=3m src/__tests__/copilot/workspace-page-tree.e2e.ts --match='*cross-parent manual*' --match='*manual*order*' --match='*concurrent opposite moves*'
docker exec -w /workspace localmind_hot_web yarn workspace @affine/graphql exec gql-gen --errors-only
docker exec -w /workspace localmind_hot_web yarn tsc -b packages/common/graphql
docker exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --pool=threads --maxWorkers=1 packages/frontend/core/src/components/root-app-sidebar/page-tree-drag.spec.ts packages/frontend/core/src/modules/organize/services/page-tree-local.spec.ts packages/frontend/core/src/modules/organize/services/page-tree.spec.ts packages/frontend/core/src/desktop/components/navigation-panel/tree/node.spec.tsx packages/common/graphql/src/workspace-page-tree.spec.ts'
docker exec -w /workspace localmind_hot_web yarn node .codex-artifacts/page-tree-drag-fix-20261012/typecheck.mjs packages/frontend/core
docker exec -w /workspace localmind_hot_web yarn node .codex-artifacts/page-tree-drag-fix-20261012/typecheck.mjs packages/backend/server
```

证据位于 `.codex-artifacts/page-tree-drag-fix-20261012/`，包括测试／类型／格式日志、浏览器移动及撤销截图、DOM 层级和持久操作回执。开发后端热重载曾内存不足，重启现有 `localmind_hot_backend` 后恢复；未改变其配置。浏览器验证期间原有读取限流仍造成短时缓存显示延迟，自动恢复后完成核对，本轮没有扩大限流策略。未验证真实触屏拖动；移动端既有树行测试通过。

没有重建镜像或删除 volume。验证后的 Docker 状态约为 Images 31.1 GB、Local Volumes 23.94 GB、Build Cache 4.514 GB。本轮没有 commit、push、PR 或远端发布。

## 2026-10-13：重复读取与示例文档同步循环修复

本地排查确认两条放大链：示例迁移把已经迁移的 `Visit LocalMind` 再次写入，
同步状态回到 ready 后又触发迁移；页面树则在内容未变时仍轮询每个挂载分支，
正文子页面块还会因任意层缓存更新而额外调用 `locate`。目录三个实时订阅的 ready
信号及同账号资料更新会重复取消并重启读取。诊断确认实际触发的仍是原有
`120 / 60000ms` 限制，本轮没有改变限流配置、超时或轮询间隔。

- 示例迁移比较完整文本 delta，合并同 Workspace 的并发迁移，并只在初始化首次
  ready 时运行。已经迁移的内容连续执行十次不产生写事务。
- 账号身份按 id 去重；三个目录订阅就绪信号合并为一次补读。真实权限变更仍立即
  清空旧结果，隐藏页面停止目录轮询。
- GraphQL 增加可空 `snapshotRevision`，由 actor、树版本及权威 root／目录／属性、
  原生资源清单与 ACL 快照推导；正文标题变更和 Yjs 纯删除同样改变该版本。
  客户端先检查根快照，相同快照的子层直接复用；版本变化、请求失败或缺少快照
  字段时继续正常重验。原有写后定向刷新、分页、账号切换及授权门禁保留。
- 正文子页面块改为观察对应资源层，复用页面树的合并请求、缓存与退避；交互写入
  仍执行实时定位与服务端权限校验。
- 承接已有的解析 worker 修复，补齐 Yjs subdocument 的可传输快照以及正文同步时
  的权威 root 读取和解析缓存；资源删除或存储读取失败仍拒绝同步。

### 聚焦验证

复用 `localmind_hot_web`、`localmind_hot_backend`（固定
`localmind-affine:dev-base`）的 Linux 环境，没有重建镜像。源码 bind mount、nodemon
和 Rspack 已加载当前改动；没有复制散落文件、执行数据库迁移或修改业务库 schema。
服务端 schema 与共享 GraphQL client 均由既有生成流程更新。

- 69 项不同的前端测试通过：页面树 32、本地树 8、目录 23、示例迁移 6。
- 9 项后端测试通过：真实 Yjs 快照版本、嵌套标题、纯删除、授权拒绝、subdocument
  解析、删除后的正文同步拒绝和解析 worker 的既有回归。
- 9 个前端文件及 3 个后端文件的定向类型检查、共享 GraphQL declaration build、
  定向 oxlint／Prettier 及 `git diff --check` 通过；没有宣称全仓类型检查通过。
- 假时钟测试中，8 个展开分支静置 3 分钟只读取根快照 6 次；标题或权限快照改变后
  会刷新子层，根读取失败不会让旧缓存被错误标记为有效。

```sh
docker --context colima exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --maxWorkers=1 packages/frontend/core/src/utils/__tests__/showcase-migration.spec.ts packages/frontend/core/src/modules/organize/services/page-tree.spec.ts packages/frontend/core/src/modules/organize/stores/directory-access.spec.ts'
docker --context colima exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --maxWorkers=1 packages/frontend/core/src/modules/organize/services/page-tree.spec.ts packages/frontend/core/src/modules/organize/services/page-tree-local.spec.ts'
docker --context colima exec -w /workspace localmind_hot_backend sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn workspace @affine/server test src/core/doc/__tests__/page-tree-snapshot.spec.ts src/core/doc/__tests__/snapshot-worker-subdoc.spec.ts src/__tests__/core/snapshot-parser.spec.ts'
docker --context colima exec -w /workspace localmind_hot_web yarn workspace @affine/graphql exec gql-gen --errors-only
docker --context colima exec -w /workspace localmind_hot_web yarn tsc -b packages/common/graphql
node .codex-artifacts/page-tree-sync-fix-20261013/typecheck.mjs packages/frontend/core
node .codex-artifacts/page-tree-sync-fix-20261013/typecheck.mjs packages/backend/server
```

真实浏览器验证完成新建页面、输入正文、刷新后内容保留、通过正文命令新建子页面、
子页面重命名后父页面入口自动更新，以及连续展开／收起十次。页面显示“已保存到本地
并完成同步”。截图与最终日志摘要位于
`.codex-artifacts/page-tree-sync-fix-20261013/`。

最终静置窗口为 `2026-10-14T04:40:40Z` 至 `04:43:44Z`，期间保留父页面正文的
子页面块及多个展开分支，没有重启服务或热更新代码。整个本地后端记录页面树读取
67 次（P50 95 ms、P95 290 ms、最大 457 ms）、目录读取 72 次（P95 118 ms）；
限流、其他错误、CORS 告警和文档／工作区写入事件均为 0。页面持续显示同步完成。
该统计包含实例上的其他打开页面，不是单标签页请求数。验证前另有 AI provider
未配置的既有错误，不属于本次页面树修复范围；最终静置窗口未出现这些错误。

临时父页面和子页面已通过 UI 的两项影响预览一并移至回收站，未永久删除；原有
业务资源没有改写。清理后再连续切换正常页面和文件夹六次，耗时 330—838 ms，
页面均显示同步完成，目录内容正常，没有限流提示。

本轮未验证生产规模多用户／大目录压力，不构成完整 B01—B40 重验或生产部署验收。
没有 commit、push、PR、远端发布、永久删除或 volume 清理。Docker 状态为 Images
26.23 GB、Local Volumes 17.86 GB、Build Cache 13.21 GB；宿主机剩余约 26 GiB。

## 2026-10-19：侧栏单一拖放落点与自身下方抖动修复

侧栏统一保存当前拖放目标。文件夹／页面行主体使用浅蓝底色和目标文字表示移入，
行边缘和行间只显示一条同级插入线。上下边缘命中带最多 6px，原有 2px 行间距
纳入下一行的命中范围；展开容器以整个子树之后的固定尾部区域表示其同级插入点。
Office、普通文件和白板的行主体仍不接收下级。

原根目录拖放提示插入列表顶部，会改变鼠标下方行的位置。现在根目录落点固定在
树底部，提示不会撑开布局。拖到自身及相邻原位置不读取目录、不提交排序，也不
切换排序模式；移入容器仍交由权威服务处理，不根据旧缓存跳过。结束、取消、
离开树、窗口失焦和切换 Workspace 会清理提示，嵌套父子行不会同时保留高亮。

本轮只改前端命中、反馈与回归测试，复用既有移动服务、权限、版本与撤销契约。
未修改数据库、GraphQL 或内容存储。

验证复用 `localmind_hot_web`（固定镜像 `localmind-affine:dev-base`）：

```sh
docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/components/root-app-sidebar/page-tree-drag.spec.ts packages/frontend/core/src/components/root-app-sidebar/page-tree.spec.tsx packages/frontend/core/src/desktop/components/navigation-panel/tree/node.spec.tsx --maxWorkers=1
docker exec -w /workspace localmind_hot_web yarn node .codex-artifacts/sidebar-drag-20261019/typecheck.mjs packages/frontend/core
```

46 项测试和 8 个改动文件的聚焦类型检查通过，包括单一提示、跨父级移动、
展开子树同级排序、自身／原位置无操作、取消、失焦及移动失败。定向 oxlint、
Prettier、设计静态检查和 `git diff --check` 通过。日志和类型检查脚本位于
`.codex-artifacts/sidebar-drag-20261019/`。

当前 `localhost:3011` 源码挂载实例已热更新。浏览器验证文档拖至自身下沿、
展开文档末尾及根目录底部空白处，操作前后的目录行坐标与顺序相同，结束后
没有遗留拖放提示。实际浏览器检查限于当前浅色桌面视口；跨目录成功／失败
由组件测试覆盖，未在用户资源上执行这些移动，未重验深色主题和触屏设备。
没有重建镜像、执行部署同步、删除数据卷或提交代码。

### 同日补充：跨层级间隙归一化与文件夹名称遮挡

用户确认蓝线是在鼠标微移时切换，并非同时残留。上一轮保留了末尾子项的
after、父容器 6px 尾区和下一根节点 before 三个相邻落点，仍会在同一视觉间隙
切换位置和归属。本轮移除父级尾区，由树根根据可见行统一解析落点；间隙两侧
均归一为下一可见行的 before，采用该行的父级。在当前示例中，
“How to use folder and Tags”与“未命名”之间固定为根目录、“未命名”之前。
行主体继续表示移入该文件夹／页面；进入和移动事件使用相同解析，快速释放
也不依赖下一次 dragover 才能接受目标。上节关于固定子树尾区的描述由此覆盖。

文件夹名称遮挡来自旧拖放监听：canDrop 回调返回 false 仍会注册外部拖放，
其提前接受分支绕过回调，写入 make-child 后触发覆盖文字的不透明伪元素。
受控资源树现在使用字面量 canDrop=false、allowExternal=false，且不挂载旧
覆盖层样式；其他树仍保留既有拖放功能。WorkbenchLink 将 draggable 传到实际
链接元素，关闭链接默认拖动，避免与资源行争抢。

验证继续复用 `localmind_hot_web` / `localmind-affine:dev-base`：

```sh
docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/components/root-app-sidebar/page-tree-drag.spec.ts packages/frontend/core/src/components/root-app-sidebar/page-tree.spec.tsx packages/frontend/core/src/desktop/components/navigation-panel/tree/node.spec.tsx packages/frontend/core/src/modules/workbench/view/workbench-link.spec.tsx --maxWorkers=1
docker exec -w /workspace localmind_hot_web yarn node .codex-artifacts/sidebar-drag-20261019/typecheck.mjs packages/frontend/core
```

48 项测试、10 个文件的聚焦类型检查和定向 oxlint 通过。新增回归逐像素覆盖
末尾子项／父级／下一行之间的进入、移动与离开事件，以及真实 useDropTarget
和外部适配器的注册／注销；不再用模拟 hook 掩盖旧监听问题。

当前用户页面完成三次真实成功拖放：Getting Started 从间隙的中间和上沿
分别放到根目录“未命名”之前，再直接拖入 First Folder。拖动期间 DOM 采样
中 before 始终指向同一个节点、同一个纵坐标（目标行 top=384），没有旧
tree-instruction。文件夹的名称保持 visible、opacity=1，覆盖伪元素为 none；
活动蓝线与文件夹高亮均捕获真实截图。每次成功移动均通过 UI 撤销，已恢复原
目录归属和顺序。另回归自身下沿拖动，17 次采样的四个行坐标完全相同，没有落点
提示或移动。日志、采样和截图位于 `.codex-artifacts/sidebar-drag-20261019/`
的 `*-followup.log`、`browser-*.json`、`gap-drag.png` 和 `folder-drag.png`。

本轮实际浏览器覆盖当前浅色桌面视口，未重验深色主题或触屏。源码挂载实例已
热更新，无镜像重建、部署同步、数据库变更、commit 或 push。诊断期间的临时
事件日志代码已移除。

## 2026-10-19：侧栏排序入口与操作按钮显示规则

按确认方案，当前工作区展开时常驻根目录的新建和排序按钮；文件夹及页面的
排序统一移入「… → 下级资源排序」，Word 等叶子资源不显示下级排序入口。
旧文件夹树复用相同菜单。行尾固定保留 44px 的新建／更多操作区，按钮只在
悬停、键盘聚焦或本行菜单打开时显示；触屏沿用无悬停设备的常显规则。
展开容器的折叠箭头不触发菜单常显，避免展开／折叠两种状态的显示规则不一致。

排序菜单继续复用既有偏好和选中状态。测试发现桌面子菜单没有向 Radix 传递
`disabled`，已补齐普通菜单和右键菜单两条路径，确保未就绪／保存期间不能
通过键盘或点击打开排序子菜单。

验证复用 Linux 容器 `localmind_hot_web` / `localmind-affine:dev-base`：

```sh
docker exec -w /workspace localmind_hot_web yarn workspace @affine/i18n build
docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/components/root-app-sidebar/page-tree.spec.tsx packages/frontend/core/src/components/root-app-sidebar/page-tree-drag.spec.ts packages/frontend/core/src/components/root-app-sidebar/workspaces.spec.tsx packages/frontend/core/src/desktop/components/navigation-panel/tree/node.spec.tsx packages/frontend/core/src/desktop/components/navigation-panel/nodes/folder/sort-menu.spec.tsx packages/frontend/core/src/modules/organize/stores/folder-sorting.spec.ts --maxWorkers=1
docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/desktop/components/navigation-panel/nodes/folder/sort-menu.spec.tsx --maxWorkers=1
docker exec -w /workspace localmind_hot_web yarn node .codex-artifacts/sidebar-sort-20261019/typecheck.mjs packages/frontend/core
docker exec -w /workspace localmind_hot_web yarn node .codex-artifacts/sidebar-sort-20261019/typecheck.mjs packages/frontend/component
```

首轮测试定位禁用子菜单问题；修复后的定向复测通过，合计 62 项聚焦测试通过。
验证覆盖根目录显示条件、展开／折叠容器的菜单入口、叶子资源、排序选中及切换、
普通／右键菜单禁用行为，并回归既有拖放。类型检查限于本轮 11 个相关文件，
不代表仓库全量类型检查；相关文件的 oxlint、Prettier 及 `git diff --check` 通过。

实际浏览器检查使用用户当前工作区 `0f6a4941-4124-4e6a-96f2-97d36dc329c9/all`，
浅色桌面视口为 753×901。Getting Started 和 First Folder 均从更多菜单进入
三级排序选项；1.docx 菜单没有下级排序。根目录折叠后新建／排序按钮数量为 0，
恢复展开后独立排序按钮为 1。已恢复原展开状态，未切换资源排序偏好。

10 行资源的标题位置和尺寸在文档／文件夹悬停、菜单打开、鼠标移入菜单及恢复
静置时完全一致；文件夹折叠后另对 8 行资源比较悬停和键盘聚焦，变化均为
0 像素。新建菜单与更多菜单打开时，本行在无悬停、无焦点状态下操作区仍保持
可见。样本和截图保存在 `.codex-artifacts/sidebar-sort-20261019/`。
本轮未实测深色主题或触屏；源码挂载实例已热更新，未重建镜像、执行部署同步、
修改数据库或提交代码。

同日按后续反馈收紧菜单条件：仅有两个及以上可见直接下级资源的页面／文件夹显示
排序入口，子文件夹也计入下级资源；零个或一个下级资源时不显示。子菜单移除左侧
排序图标，保留右侧展开
箭头。页面树在菜单挂载时复用目录层观察，折叠未加载的容器会按需读取，避免
仅为了显示侧栏而遍历所有分支；目录加载和移除资源后入口随数据更新。旧文件夹
树按可见子项数量采用相同规则。

`page-tree.spec.tsx` 和 `sort-menu.spec.tsx` 定向运行共 16 项测试通过，聚焦类型、
oxlint、Prettier 检查通过。用户当前 `/HyWzmNCbCF` 页面实测 Getting Started
空页面及“222”空文件夹的排序项数量均为 0；First Folder 折叠时仍保留入口，
恢复展开后可打开三项排序选项，菜单前方无图标。截图为同一证据目录中的
`empty-page-menu.png` 和 `child-sort-without-icon.png`。原展开状态已恢复，
未改变排序偏好。
