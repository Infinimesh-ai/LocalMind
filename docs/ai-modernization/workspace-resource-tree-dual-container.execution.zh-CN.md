# Workspace 双容器 v2 独立候选执行记录

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
