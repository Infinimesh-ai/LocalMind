# Workspace 页面树独立候选版与隔离验证记录

状态：独立 worktree 候选版，供本机体验；未合入、未提交、未推送、未部署。生产切换与全平台实机认证不在本次体验环境中执行。下面逐项区分源码、自动化证据和仍需实机覆盖的边界，不把测试数量等同于 A01—A46 全部完成。

后续方向：用户已确认[文件夹与页面双容器方案](workspace-resource-tree-dual-container-development.zh-CN.md)。本文继续记录页面唯一容器 v1 的实际结果；双容器 v2 尚未实施，本轮方案编写没有修改这里的测试证据或升级体验库。

## 工作边界与入口

用户于 2026-10-09 要求按 `workspace-page-tree-development.zh-CN.md` 建立独立 worktree，补全功能并隔离验证，体验后决定是否保留。

- Worktree：`/Users/dev2/.codex/worktrees/workspace-page-tree/LocalMind`，分支 `codex/workspace-page-tree`。
- 基线 HEAD：`98566c945209cd424f477749fd6596e0352729f9`。继承主目录 127 个未提交文件，保留资源显示/排序依赖；清单为 `.codex-artifacts/workspace-page-tree/inherited-baseline.json`。
- 主目录 `/Users/dev2/Documents/project/LocalMind` 不参与写入；没有 commit、push、merge、远端 PR、运行同步或业务库改动。
- 体验入口：[页面树隔离体验](http://localhost:3181/workspace/1fb8da04-8135-4021-8351-35e69ab288f1/fd2f7383-9000-4ecb-a328-306555b9271a)。合成账号见本地 `.codex-artifacts/workspace-page-tree/preview-access.json`。
- 活跃契约：本开发方案、Workspace CRUD、资源显示/排序、原生 Office、Project Native Resources、Workspace AI 授权与 Docker 开发约束。

## 最终实现范围

目录权威仍是原 `folders` Yjs 表。新 SQL 表仅保存契约切换、不可变迁移计划/映射、租约、checkpoint 和操作回执；没有第二份可写父级。节点与 doc/office/file 身份分离，显式根、唯一父级、64 层、无环、容器类型、回收依赖和实时 ACL 由共享图协议及后端领域服务校验。

页面/白板及原生 Office、文本文件创建与唯一归属共同完成。移动、完整同级重排、子树回收、恢复、显式恢复选址、永久删除、重放与版本化撤销使用同一领域入口。回收确认先读取受权、有界影响清单，提交绑定树及权限版本；隐藏后代不会通过数量或标题泄露。旧原生生命周期和旧目录写协议在切换后拒绝执行。

侧栏、面包屑、页面直属混合列表、移动目标、原生复制和 Project 发布读取同一位置。行内创建、排序、更多菜单及根排序沿用现有组件；个人显示偏好与持久手动顺序分离。主列表元数据、标签、分组和偏好保留。权限设置页识别真实页面容器，拒绝对白板授权为容器。

正文有独立 `localmind:subpage` 块和“子页面”命令。归属与正文入口在同一领域事务写入；普通粘贴、复制、导入、Markdown/HTML/文本导出降为引用，不转移归属。用户删除入口走同一回收确认；原始 Yjs 更新、历史及内容 Undo 不回收资源。正文确认期间并发改动保留原内容。原生读取器只在临时副本中将入口投影为引用以支持索引，规范正文保持不变。

原生页面创建入口、模板、日记、导入、采集及编辑器创建协议改为等待权威资源创建。纯本地 Workspace 使用持久日志和浏览器排他锁，可断点恢复；上传先复制正文与文件，再由服务端核对完整图和版本，成功后切换。账号、源正文或归属变化则保留本地副本；个人根/容器排序迁移不覆盖目标已有偏好。

内部 Workspace AI 使用专属 `workspace_page_tree_*` 工具，复用服务、ACL、不可变回执和写审计；Project/私人工单/旧冻结任务不注册这些工具。原生改名有独立严格版本工具。Project 内部资源保持独立；发布目标采用 `project-publication/v3` 的显式页面节点和版本，四种 Office、页面和普通文件仍生成独立副本，更新保持目标身份。公开 MCP 不扩大旧凭据能力。

## 隔离环境与验证方式

复用固定镜像 `localmind-affine:dev-base`，没有重建镜像；本机无 `localmind-affine:test`。依赖卷 `localmind_hot_node_modules` 只读；Prisma Client、测试缓存独立；源码挂载上述 worktree。

网络 `localmind_page_tree`，专用 PostgreSQL `localmind_page_tree_pg`（tmpfs）和 Redis `localmind_page_tree_redis`。测试库 `affine`，体验库 `page_tree_preview`，升级源/恢复库 `page_tree_upgrade_source` / `page_tree_upgrade_restored`。没有连接实际业务数据库或删除持久卷。

`localmind_page_tree_validation` 执行 Linux 验证；`localmind_page_tree_preview` / `localmind_page_tree_web` 提供后端及前端体验，仅绑定 `127.0.0.1:3180/3181`。体验用测试应用，后台队列为 mock；不代表真实队列、生产打包、移动安装包或部署验收。数据库为临时数据，容器重建后不承诺保留；只使用合成内容。

交付时体验容器保持运行。当前合成数据库和 Blob 已另存 `preview-workspace.dump` / `preview-workspace-blobs.tar`，大小与 SHA-256 见 `preview-checkpoint.json`；这些文件位于本 worktree 的 `.codex-artifacts/workspace-page-tree/`，没有上传到外部服务。它们是交付时快照，不自动包含后续体验写入。

主要命令（日志位于 `.codex-artifacts/workspace-page-tree/logs/`）：

```sh
docker exec localmind_page_tree_validation node node_modules/prisma/build/index.js validate --schema packages/backend/server/schema.prisma
docker exec localmind_page_tree_validation node node_modules/prisma/build/index.js generate --schema packages/backend/server/schema.prisma
docker exec localmind_page_tree_validation node node_modules/prisma/build/index.js migrate deploy --schema packages/backend/server/schema.prisma
docker exec -w /workspace/packages/backend/server localmind_page_tree_validation /workspace/node_modules/.bin/ava --serial --timeout=3m src/__tests__/copilot/workspace-page-tree.e2e.ts
docker exec -w /workspace/packages/backend/server localmind_page_tree_validation /workspace/node_modules/.bin/ava --serial --timeout=3m src/__tests__/copilot/project-publication.e2e.ts
docker exec -w /workspace/packages/backend/server localmind_page_tree_validation /workspace/node_modules/.bin/ava --serial --timeout=3m src/__tests__/copilot/copilot-mcp-resources.spec.ts src/core/doc/__tests__/reader-from-database.spec.ts src/__tests__/sync/gateway.spec.ts
docker exec localmind_page_tree_validation node node_modules/vitest/vitest.mjs run packages/common/graphql/src/workspace-page-tree.spec.ts packages/frontend/core/src/blocksuite/initialization/index.spec.ts packages/frontend/core/src/desktop/pages/intelligence/project-publications.spec.tsx packages/frontend/core/src/modules/organize packages/frontend/core/src/modules/workspace-resources/lifecycle.spec.ts packages/frontend/core/src/desktop/dialogs/import/commit-service.spec.ts packages/frontend/core/src/components/native-files/resource-display.spec.ts --maxWorkers=1
docker exec localmind_page_tree_validation node node_modules/typescript/bin/tsc -b packages/frontend/core packages/backend/server --pretty false
docker exec localmind_page_tree_validation node .codex-artifacts/workspace-page-tree/check-files.cjs lint
git diff --check
```

GraphQL 使用真实 Nest schema 生成及 `gql-gen --errors-only`，i18n 使用包内 `build.ts`。没有手工编辑生成类型。源文件列表由 `capture-changes.py` 对继承文件哈希计算，格式与 lint 只检查本次涉及文件。

最终结果：

- 页面树后端 22 项通过（`page-tree-final.log`）；Project 发布 12 项通过；MCP、原生只读 reader 和同步协议回归通过（`backend-regression.log` 共 87 项，包含前一轮 21 项页面树测试，不重复累加）。
- 前端、共享图协议、本地持久恢复、导入和生命周期共 110 项通过（`frontend-final.log`）。最后补齐显式返回值后，相关 20 项再次通过（`frontend-return-check.log`）。
- 前后端 TypeScript project build 通过（`types.log`，退出码 0）；oxlint、Prettier、GraphQL/i18n 生成及 `git diff --check` 通过。
- 主目录 127 个继承文件 SHA-256 与基线 HEAD 核对一致（`main-preservation.json`）；本次源码清单见 `changed-files.json`，不包含隔离测试产物。

## A01—A46 验收证据索引

“核心通过”表示所列 Linux 行为或浏览器场景已验证，不外推为所有设备与所有交互组合通过。

| 编号 | 结果与证据                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A01  | 核心通过：根页面/白板及 DOCX/XLSX/PPTX/PDF/TXT/MD/CSV/JSON 创建、唯一 typed 身份和重新读取；`workspace-page-tree.e2e.ts` mixed formats。       |
| A02  | 核心通过：同一格式矩阵在页面下创建，原生内容不写入 BlockSuite。                                                                                |
| A03  | 核心通过：真实子页和明确入口原子写入，重放同身份，失效锚点回滚；正文命令及块已接线。                                                           |
| A04  | 核心通过：引用导入规范化、原始正文变化不更改归属；正文普通引用仍由原协议处理。                                                                 |
| A05  | 浏览器验证多层页面、侧栏、面包屑及直属混合列表；按稳定节点定位。                                                                               |
| A06  | 核心通过：移动保持子树/ID；浏览器移动后旧位置消失。                                                                                            |
| A07  | 共享图及 API 验证自身、后代、叶子、跨 Workspace 拒绝；UI 显示通用失败反馈。                                                                    |
| A08  | 核心通过：完整同级手动顺序、旧顺序回执、撤销及并发版本拒绝；浏览器根重排。                                                                     |
| A09  | 核心通过：并发反向移动只有一项成功，不形成环。                                                                                                 |
| A10  | 核心通过：实时授权版本与目标状态拒绝，事务回滚；权限变化使分页游标失效。                                                                       |
| A11  | 核心通过：后代和恢复依赖阻止主模式改为白板；前端在写入前做保守检查。                                                                           |
| A12  | 已实现：用户删除入口进入领域确认；内容 Undo/历史/原始写不改树；删除拦截单测及后端生命周期证据。完整编辑器跨页拖放组合仍需实机回归。            |
| A13  | 核心通过：导入/复制入口变为普通引用，不重新绑定原子项，不递归复制。                                                                            |
| A14  | 核心通过：混合子树回收再恢复，OfficeRevision/WorkspaceFile/revisions 不变；预览有界。                                                          |
| A15  | 核心通过：先前独立回收子项不随父级恢复。                                                                                                       |
| A16  | 核心通过：失效原父级拒绝；UI 提供明确恢复目标。                                                                                                |
| A17  | 核心通过：隐藏子项使影响预览整体拒绝，错误不含标题或数量，拒绝后无半状态。                                                                     |
| A18  | 核心通过：条件版本、独立 claim、不可变回执和身份防复活；未做真实进程强杀与对象存储故障压力测试。                                               |
| A19  | 核心通过：空白、嵌套、同名旧文件夹确定性转换真实正文，稳定映射重启不重复。                                                                     |
| A20  | 核心通过：归属只看目录和权威资源清单，正文引用不参与迁移。                                                                                     |
| A21  | 核心通过：完整路径确定性收敛；逐主体权限不等价时阻止切换。                                                                                     |
| A22  | 核心通过：隐藏路径不降为根，旧 Office doc 节点按真实类型归一。                                                                                 |
| A23  | 核心通过：旧 manifest、独立回收保留；重叠 claim 报冲突，不静默复活。                                                                           |
| A24  | 核心通过：checkpoint、过期租约、接管、取消与重新领取，旧 token 拒绝。                                                                          |
| A25  | 核心通过：真实 pg_dump/Blob tar 隔离恢复、升级、切换后保留快照再恢复旧备份并重新升级。详情见下一节。                                           |
| A26  | 核心通过：旧目录/root lifecycle/模式增量拒绝；普通正文同步与 0.25/0.26 广播回归。未启动所有历史桌面/移动安装包。                               |
| A27  | 本地持久日志/断点恢复/上传全图单测通过；浏览器完成真实本地上传且同 ID/正文保留。                                                               |
| A28  | 核心通过：64 层、分页、权限游标、账号切换迟到响应拒绝；未进行十万级资源压力测试。                                                              |
| A29  | 核心通过：未知响应保留 request key，确定冲突换版本；插入失败回滚；本地持久恢复。                                                               |
| A30  | 核心通过：内部 AI 创建/移动/回收/永久删除/原生创建/改名走同一服务；删除须最新用户明确意图。                                                    |
| A31  | 核心通过：旧冻结任务不注册新工具，旧协议退役；原公开能力枚举和资源 schema 回归。公开 MCP 真实客户端升级体验未在此环境开放。                    |
| A32  | 核心通过：Project 页面、四种 Office 和普通文件发布/原位更新，内部正文/字节及独立修订不变；旧发布目标不能获得新权限。                           |
| A33  | 已适配普通创建、主页、日记、模板、导入、采集、收藏等入口；导入异步创建、文件夹映射、引用规范化及幂等聚焦测试。没有逐一启用外部 Readwise 账号。 |
| A34  | 浏览器主题/断点证据在“浏览器记录”中单列；实际触屏设备、Electron/iOS/Android 安装包未验收。                                                     |
| A35  | 核心通过：原始同步写、跨域 ID、伪造父级、旧身份重用均拒绝；不依赖 UI。                                                                         |
| A36  | 核心通过：正文/原生字节/ID/修订/标签/策略哈希清点；转换只增加规定页面。                                                                        |
| A37  | 核心通过：直属列表复用现有资源行及成对事件；资源显示回归通过。                                                                                 |
| A38  | 核心通过：迁移/移动/回收恢复不重写内容更新证据；真实正文编辑由既有流程记录。                                                                   |
| A39  | 核心通过：旧 tag/collection 放置退出树，原标签关系保留；原资源显示/分组测试回归。                                                              |
| A40  | 核心通过：稳定容器 ID 保留默认与个人值；本地上传继承偏好并尊重目标显式选择；账号及 Workspace 隔离测试。                                        |
| A41  | 核心通过：个人排序与组织权限分离；键盘菜单焦点/选择、根重排；真实触屏显隐与拖动仍需设备覆盖。                                                  |
| A42  | 核心通过：自然比较及稳定 identity 复用；名称排序先载完直属层；完整手动顺序拒绝部分目录。                                                       |
| A43  | 核心通过：旧元数据/标签 fixture→新 schema→Yjs 切换→备份恢复保真；没有对真实历史库做回填。                                                      |
| A44  | 核心通过：复用现有模式元数据事务，重复值和拒绝不推进用户更新事件。                                                                             |
| A45  | 核心通过：权威只读 reader 与事务内读，迁移预检/树读取/回执不压缩正文。                                                                         |
| A46  | 核心通过：慢 socket 发现不占授权锁，client/outbox 广播发送前重查撤权，0.25/0.26 均通过。                                                       |

## 迁移、冲突处理和恢复

迁移通过 `scripts/migrate-workspace-page-tree.ts` 运行独立、持久、有租约的批处理。首次只读预检输出计划；执行必须显式提供 Workspace、管理员、指纹、数据库备份及匹配的恢复证据，且声明 affected workers 已暂停。旧工具退役沿用 `retire-tool-contracts.ts` 的 Workspace 范围过滤。本次没有对真实 Workspace 执行这些命令。

冲突不自动修补：权限不等价时，管理员先在旧目录界面检查各路径和主体，明确选定位置及权限后再预检；禁止为了完成迁移一律放宽或收紧。重叠回收 claim、缺失 manifest、超深或环路要求先在旧契约下恢复/整理或从匹配备份恢复。没有合法旧操作可解决时保留只读预检失败，不能手工改 SQL/Yjs 伪造证据。冻结后的取消只撤销 worker 租约，保留 checkpoint 和只读状态；重新执行相同计划续跑，或者按成套备份恢复，不能降级已切换目录。

隔离演练保存：

- `upgrade-fixture.json`：切换前资源/正文/修订/标签/策略哈希与实际原生字节 SHA-256。
- `old-workspace.dump` 与 `old-workspace-blobs.tar`：旧 schema、旧目录以及独立 Blob 实体备份。
- `upgrade-result.json`：数据库及 Blob 备份 SHA、恢复验证和计划指纹绑定。
- `switched-workspace.dump`：已切换状态另存，恢复演练不覆盖唯一证据。
- `logs/upgrade-migrations.log`、`upgrade-verify.log`、`rollback-migrations.log`、`rollback-verify.log`：升级与恢复后重新切换验证。

体验环境没有切换后的真实协作写入。真实故障恢复必须先暂停写入并保全切换后数据库、Blob 与操作回执，再选择恢复范围；不能把本演练视为允许丢弃用户后续写入。

## 浏览器记录与剩余限制

已完成：真实子页面创建与移动、面包屑、本地真实正文初始化、本地回收和撤销、本地上传保持正文和 ID、根显示排序、排序菜单键盘导航、根键盘重排及撤销还原。正文子页面打开成功，回收对话框显示受影响资源；取消后入口和归属不变。专用合成夹具补充正文子页面块和原生 DOCX，便于体验混合直属资源。

浏览器检查 CSS 1440×900 浅色/深色以及 390×844 窄屏。窄屏会收起侧栏，正文及混合资源元数据保持可读；显示菜单可用，键盘 Escape 返回触发按钮。截图位于 `.codex-artifacts/workspace-page-tree/screenshots/`：`desktop-light.jpg`、`desktop-dark.jpg`、`narrow-dark.jpg`、`narrow-resource-list.jpg`。已恢复默认浏览器视口与跟随系统主题，体验界面采用简体中文。

DOCX 从“研究资料”的直属列表打开，原生编辑器显示正文，面包屑为 Workspace 根目录 → 研究资料 → 页面树使用说明.docx，状态为“已保存”（`native-docx.jpg`）。最终浏览器错误日志为空。

本地上传后的根排序继承与已释放 engine 防护最后修订由单测覆盖，没有再重复完整的第二次浏览器上传。完整编辑器跨页拖动/剪贴板历史组合、真实多设备离线冲突、外部服务凭据和生产后台 worker 不由当前测试应用代替。当前候选版适合隔离体验，不作为真实数据自动切换或生产就绪认证。

磁盘末次检查：镜像 31.02 GB、容器 1.694 GB、卷 22.11 GB、构建缓存 4.81 GB；没有重建镜像、删除卷或清理无关镜像。
