# 协作星图方案二：实施与验收记录

日期：2026-09-29。状态：实施中。验收标准见[开发文档](project-collaboration-orbit-scheme-2-development.zh-CN.md)第 9 节。未列为通过的项目均未完成验收。

## P0 基线

- 工作目录：`/Users/dev2/Documents/project/LocalMind`，分支 `main`。开始时 `git status --short` 有 228 行，涉及既有关系图、Project/Workspace 原生资源、Prisma、GraphQL、前端与文档；本任务保留这些未提交修改，不整体还原或替换关系图。
- 原型目录：`/Users/dev2/Documents/project/LocalMind-graph-scheme-2`。2026-09-29 的 SHA-256：

| 参考文件                      | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `DESIGN.md`                   | `7a6248f80009ffc27b21359b1e5177e0e56cbe263cbb19f3b30c6b198d3bcc0f` |
| `src/orbit-model.ts`          | `7605e3af3d219459b848d9b7090114bdbfcf8a7889c1603e0f9a84bb10a41af9` |
| `src/orbit-world.tsx`         | `3b104a1f8aa89356b29394a0841dbaa5c8f674b1f23e5f3696df577ad60780a7` |
| `src/orbit-order-cards.tsx`   | `69c1df02b9f7307c3e67777f1d92901814c0df93f4f8798ed13f6f58c61a4aec` |
| `src/orbit-order-motion.ts`   | `04134952e98a8e9de0b95a44a2509269d8a8f32e3c0abc2201a80a770ec10eaf` |
| `src/orbit-delivery-line.tsx` | `5ed87c4773a57b29c48089a2486b45764970032fb916c87e33fd42b2f7f923c0` |
| `src/relationship-board.tsx`  | `e94db3ed6c5426de153a1988dd0e1baff431fb2a291eb21aac15f10d122cab19` |
| `tests/orbit.test.tsx`        | `f3e34d1746ba6faec9bd25b6d7180af6762d1498953b2d4015fd18cb1a6d44b1` |

- 当前正式入口：`conversation-board.tsx` 维护唯一项目筛选与「条目／关系」切换；`collaboration-graph.tsx` 维护图查询、实时刷新、草稿期限、详情读取和授权导航回调；`index.tsx` 执行本人会话打开或补建。
- 现有镜像：`localmind-affine:dev-base`、`localmind-affine:local`；无 `localmind-affine:test`。本机已有 `localmind_hot_*` 容器。未重建镜像。

## 阶段进度

| 阶段          | 状态                     | 证据                                                                                                     |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| P0 基线与契约 | 完成                     | 上述路径、哈希与差异边界                                                                                 |
| P1 数据接入   | 源码与聚焦验证完成       | actor-scoped 头像投影、GraphQL 生成、模型与授权测试                                                      |
| P2 静态星图   | 源码与部分浏览器验证完成 | `/project` 正式入口、真实数据、有限相机与响应式布局                                                      |
| P3 动效与交互 | 源码与聚焦验证完成       | 锁定参数、逐颗落位、取消与迟到回调测试；真实页面观察                                                     |
| P4 正式验收   | 部分完成                 | Linux 聚焦测试及部分真实浏览器路径通过；见下表剩余项                                                     |
| P5 本机同步   | 同步完成，复验部分完成   | 隔离工作树通过脚本同步 `localmind_affine_server`；3011 上真实工单详情、逐颗落位和 Project 会话入口已复验 |

## A01—A19

| 编号 | 状态 | 已有证据与剩余验收                                                                                                                                                                                         |
| ---- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01  | 通过 | `/project`「关系」挂载 `CollaborationOrbitBoard`；真实页面无旧外框和固定右栏，项目筛选只有一处。                                                                                                           |
| A02  | 通过 | 模型测试覆盖跨项目、双向与工单 ID 去重；真实页面 13 单聚于同一 testadmin 头像。                                                                                                                            |
| A03  | 部分 | 后端测试验证头像投影，组件使用 `Avatar` 的姓名回退，空图测试通过；本机账号没有可观察的真实照片和加载失败实例。                                                                                             |
| A04  | 通过 | 模型测试验证 `to → from` 与双向曲线；真实 12/1 方向统计、方向文字与胶囊一致。                                                                                                                              |
| A05  | 通过 | 0/1/2/5/6/12 单模型测试覆盖头像大小、历史/草稿隔离与项目/搜索；真实 13 单统计和搜索结果正确。                                                                                                              |
| A06  | 部分 | 服务端测试覆盖草稿所有者隔离、过期、确认、来源失权；前端待确认入口与到期计时实现并测试；真实浏览器没有草稿样本。                                                                                           |
| A07  | 部分 | 源码实现 140ms/450ms、单人固定与几何通道；真实点击展开和收起可用，悬停/通道/触屏计时尚缺可保存的正式证据。                                                                                                 |
| A08  | 部分 | 运动测试核定 280ms、1333ms、球形与左右绕行；真实页见逐颗出球，尚缺可保存的时间点录制。                                                                                                                     |
| A09  | 部分 | 运动及组件测试覆盖每颗独立出口、滑出/变形重叠与单颗落位可操作；真实页面观察到顺序形成胶囊，尚缺录制文件。                                                                                                  |
| A10  | 通过 | 组件测试覆盖固定不重播、切换/收起/卸载取消与迟到回调隔离。                                                                                                                                                 |
| A11  | 部分 | 真实点击读取 `myWorkOrder` 的目的和必交付项，Esc 关闭后焦点回到胶囊；组件测试覆盖失败重试，缺真实失败/旧请求覆盖场景。                                                                                     |
| A12  | 部分 | 真实页面仅点击「打开对话」后进入 Project 来源会话及个人工单会话；服务端 e2e 验证 Workspace 来源授权、重复点击组件测试通过；缺 Workspace 来源真实浏览器样本。                                               |
| A13  | 通过 | 隔离 PostgreSQL 的服务端 e2e 覆盖当前版本采用、无关用户、来源失权、删除会话及授权导航拒绝。                                                                                                                |
| A14  | 部分 | 复用任务实时事件、focus/online 与到期刷新，模型测试保持人物槽位，组件签名避免详情重播；尚缺真实重连与刷新时相机连续性验收。                                                                                |
| A15  | 部分 | 复用有限相机和中心缩放；旧关系图相机/布局/模型/组件 Linux 40/40 通过，真实页面验证初始适配、查看全图与窄屏平移；尚缺完整触屏手势和动画中相机稳定证据。                                                     |
| A16  | 部分 | 真实页检查 1440/1040/760/390px、浅深主题、长中文、390px 底部详情；200% 浏览器页面缩放未成功施加，截图工具未提供保存到指定目录的接口。                                                                      |
| A17  | 部分 | 真实页面检查鼠标点击、Tab/Enter/Esc、加载/空搜索与清除；组件测试覆盖错误重试/防重，缺真实触屏和真实截断/失效样本。                                                                                         |
| A18  | 通过 | GraphQL/i18n 生成、前端类型、oxlint/Prettier、Linux 星图 21/21、旧关系图 40/40、后端 23/23 通过；工作区既有无关回归失败另列。                                                                              |
| A19  | 部分 | 隔离工作树运行 `yarn localmind:sync:all` 成功；容器记录源、时间和 671 项运行时输入，3011 上验证真实 13 单、逐颗落位、完整详情及 Project 会话导航。当前账号只显示头像回退，缺真实照片和其余部分浏览器样本。 |

## 验证与运行记录

### 源码与隔离验证

- `yarn workspace @affine/graphql build`、`yarn tsc -b packages/common/graphql/tsconfig.json`：通过；`avatarUrl` 可空字段和详情 operation 由既有生成流程产出。
- `yarn workspace @affine/i18n build`、`yarn tsc -b packages/frontend/i18n/tsconfig.json`：通过；新增星图中英文文案。
- `yarn tsc -p packages/frontend/core/tsconfig.json --noEmit --pretty false`：通过。
- `yarn lint:ox <本次星图和后端改动文件>`：通过；`yarn prettier --ignore-unknown --check <本次星图和文档文件>`：通过。
- `docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/collaboration-orbit-model.spec.ts packages/frontend/core/src/desktop/pages/intelligence/collaboration-orbit-motion.spec.ts packages/frontend/core/src/desktop/pages/intelligence/collaboration-orbit-orders.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/collaboration-orbit-board.spec.tsx`：4 文件、21 测试通过。
- `docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/collaboration-graph-model.spec.ts packages/frontend/core/src/desktop/pages/intelligence/collaboration-graph-layout.spec.ts packages/frontend/core/src/desktop/pages/intelligence/collaboration-graph-camera.spec.ts packages/frontend/core/src/desktop/pages/intelligence/collaboration-graph.spec.tsx`：4 文件、40 测试通过。
- 在既有 `localmind_hot_backend` Linux 容器内，以独立 PostgreSQL 数据库 `localmind_orbit2_test_20260929` 执行 `prisma migrate deploy`，全部 405 个迁移应用成功。随后运行 `docker exec -w /workspace localmind_hot_backend node -e 'const {spawnSync}=require("node:child_process");const u=new URL(process.env.DATABASE_URL);u.pathname="/localmind_orbit2_test_20260929";const r=spawnSync("/workspace/node_modules/.bin/ava",["--serial","src/__tests__/copilot/project-workbench-v9.e2e.ts"],{env:{...process.env,DATABASE_URL:u.toString()},stdio:"inherit"});process.exit(r.status??1)'`，23 测试通过。`DATABASE_URL` 只在测试进程内指向该隔离库，未对运行服务库执行测试清表。
- `git diff --check`：通过。未重建镜像；最终 `docker system df` 观察 Images 31.85 GB、Containers 4.246 GB、Volumes 10.85 GB、Build Cache 3.586 GB；现有镜像 `localmind-affine:dev-base` 1.62 GB、`localmind-affine:local` 3.19 GB，`localmind-affine:test` 不存在。
- 混合运行既有关系图与 `index.spec.tsx` 时为 47 通过、1 失败；失败断言要求 `includeArchived: false`，当前工作区此前已将 `index.tsx` 改为 `true`，与本次星图接线无关，未擅自修改。

### 真实页面观察

通过本机现有热开发环境 `http://localhost:3011/project` 及 CUA 浏览器操作：登录用户 T、协作者 testadmin，有 13 张未完成工单（12 张「对方 → 我」，1 张「我 → 对方」）。在关系页观察单头像、逐颗出球/落位；点击胶囊后读取真实目的与 3 项必交付要求，Esc 关闭后焦点回原胶囊。只有明确点击对话按钮后才导航，分别验证 Project 来源会话与个人工单会话。无匹配搜索保留本人头像、空态及「清除搜索」。1440/1040/760/390px 与浅深主题已观察，390px 详情为底部可滚动面板。细节记录见 `.codex-artifacts/project-collaboration-orbit-scheme-2/BROWSER-OBSERVATIONS.md`。CUA 截图在工具输出中可见，但该工具会话没有将截图字节写入 `.codex-artifacts/` 的文档化接口；因此未伪造截图或录制路径。

### 本机同步路径

仓库 `tools/localmind-dev-sync.mjs` 的 `all` 路径依次打包并复制完整 server/web/mobile/admin；当前主工作区起始有 228 行既有未提交状态，包含本专项之外的 schema、迁移、后端和前端差异。为限定同步范围，建立受管理的 `orbit-scheme-2-sync` 工作树，只移入方案二代码、关系索引迁移及必要生成文件。Linux 容器 `localmind_orbit2_validation` 挂载该工作树，提供同平台 Prisma Client 和与原 `localmind-affine:local` 完全相同 SHA-256 的 native addon。隔离 PostgreSQL 上的全量迁移和后端 23/23 测试通过；隔离前端 21/21、类型检查及 Web/Mobile/Admin 打包通过。

验证热开发数据库备份可完整恢复后，停止占用 3011 的 `localmind_hot_web`、`localmind_hot_backend`，以及与正式 PostgreSQL 容器共用数据卷的 `localmind_hot_postgres`；单独启动 `localmind_affine_postgres` 和 `localmind_affine_server`。从隔离工作树执行：

```sh
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_orbit2_validation \
LOCALMIND_DATABASE_BACKUP=/Users/dev2/Documents/project/LocalMind/.docker/dev/backups/orbit-scheme2-hot-before-sync-20260929.dump \
LOCALMIND_CONTAINER=localmind_affine_server \
LOCALMIND_URL=http://localhost:3011 \
corepack yarn localmind:sync:all
```

命令退出 0，日志为 `/tmp/localmind-orbit2-sync-all.log`，结束语为 `LocalMind all synced without rebuilding the image: http://localhost:3011`。容器 `/app/localmind-dev-sync-state.json` 记录 `source=localmind_orbit2_validation`、`syncedAt=2026-09-29T10:36:14.435Z` 和 671 项运行时输入；脚本已校验 HTML 对应新 Web entrypoint。`http://localhost:3011/project` 返回 200。只更新了本机运行容器，没有重建 `localmind-affine:local` 镜像，也没有触及远端。

数据库已有 405 条迁移记录，包含本专项关系索引及 5 条主工作区其他专项迁移；隔离源码较该既有运行库更窄，迁移部署报告无待应用项。首页、工单详情和对话路径已通过运行版复验，但其他既有功能相对于这 5 条库结构的兼容性未做全量回归，属于剩余风险。

### 隔离源码与数据库恢复演练（追加）

- 建立受管理的 `orbit-scheme-2-sync` 工作树，仅移入本专项源码、关系索引迁移和必要生成文件；`corepack yarn install --immutable`、`yarn workspace @affine/server prisma generate`、`yarn workspace @affine/i18n build`、`yarn workspace @affine/graphql build` 完成。GraphQL schema 由隔离服务端测试生成后重建，生成差异只包含关系头像字段。
- 在 `localmind-affine:dev-base` 隔离容器 `localmind_orbit2_validation` 中，针对独立数据库 `localmind_orbit2_scoped_20260929` 运行 `prisma migrate deploy` 成功；`project-workbench-v9.e2e.ts` 23/23 通过，`yarn affine bundle -p @affine/server` 通过。没有重建镜像。
- 对现有热开发数据库执行 `pg_dump` 取得 `.docker/dev/backups/orbit-scheme2-hot-before-sync-20260929.dump`（约 561 MB）。首次在同实例独立数据库恢复时 Docker 虚拟盘写满（容器内 `df -h /` 为 59G、可用 0），PostgreSQL 因无法写入 WAL 进入重启循环。`docker builder prune --force` 返回 `0B`。检查发现已停止服务容器和原 PostgreSQL 容器的 Docker 日志分别约 3.5 GB、6.3 GB；完整压缩归档到 `.docker/dev/backups/`，逐一比对原日志与解压内容的 SHA-256 后轮转原日志，释放约 9.8 GB。两个 PostgreSQL 容器挂载同一个 `localmind_hot_postgres_data`，已停止另一实例，仅启动 `localmind_hot_postgres`；WAL 恢复完成，`pg_isready` 和页面数据恢复正常。没有删除镜像、数据卷或业务数据。
- 主机绑定目录恢复因 macOS/Colima 文件所有权映射在建索引时失败，改在不联网的独立 Docker 数据卷 `localmind_orbit2_restore_validation_data` 再试。`pg_restore --exit-on-error --no-owner --no-acl -U affine -d affine /backup.dump` **退出 0**；恢复库和源库均有 4 个 Workspace、405 条 Prisma 迁移记录。恢复演练容器已停止，备份与测试数据保留。此证据证明热开发库逻辑备份可恢复；仍未执行正式运行容器同步。
- 隔离前端完整 Linux TypeScript build 因 Node 默认约 2 GB 堆上限触发内存不足；随后在隔离工作树以 `NODE_OPTIONS=--max-old-space-size=6144 corepack yarn tsc -p packages/frontend/core/tsconfig.json --noEmit --pretty false` 通过。旧 `project-tree.spec.tsx` 的 `WorkbenchConversationCard` fixture 补齐已有生成类型要求的两个可空字段，该改动仅在隔离工作树，主工作区原本已有同样字段。Linux 前端用现有依赖卷运行方案二 4 文件、21/21 测试通过；Web、Mobile、Admin 单独打包和同步脚本再次打包通过。
- 默认目标 `localmind_affine_postgres` 的 `pg_dump` 在 `workspaces` 表报告 MultiXact 错误；其部分文件已标为 `.dump.failed`，不能作为备份。该目标在本轮开始前即不可用。运行中的热开发数据库恢复及可靠备份，是继续 A19 的前提。
