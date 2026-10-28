# 旧目录页面创建与失败恢复执行记录（QA-119）

日期：2026-10-27（America/Los_Angeles；容器日志为 2026-10-28 UTC）。

对应 TODO-02，采用 [Workspace 双容器开发契约](workspace-resource-tree-dual-container-development.zh-CN.md) 第 2.1 节的创建与归属规则。本次修复旧目录侧栏「＋ → 页面／无界」的两步创建问题；已切换的页面树继续使用既有协议。Project、Office、WorkspaceFile 和公开 MCP 能力不扩张。

## 实现与行为

- 在线创建通过 `createWorkspaceFolderPage` 交给领域服务。页面正文、根元数据、所有者、目标文件夹位置与不可变回执，在已有资源事务和目录锁中共同提交。归属写入失败则整体回滚，不留下根页面。
- 回执以 Workspace、操作者和请求键唯一定位，并绑定目标、标题和模式摘要。同一次请求的并发或重放返回同一页面；不同参数不能复用原键。数据库约束与触发器保护回执不被改写或单独删除。
- 每次创建与重放均检查当前成员及目录权限；已移动页面不搬回，已删除页面不重建或复活。页面树切换后拒绝新的旧协议创建。
- 客户端发送前持久保存创建意图。网络失败、结果未知、刷新目录失败、组件重建和浏览器刷新后，继续原请求；成功后才清除意图并打开编辑器。失败提示带「重试」，保留 30 秒；提示消失或刷新后，再从同一文件夹创建同一类型可继续未确认请求。
- 提交中阻止重复点击；迟到结果和旧账号的重试动作不能导航或向新账号提交。旧重试动作始终绑定原请求，不会误加入另一次正在进行的创建。
- 本地 Workspace 保留本地创建能力，用稳定文档 ID 恢复目录写入；重试不重新初始化已有正文，也不恢复回收站页面。在线创建的数据库原子保证不应解释为离线存储事务保证。

## Linux 聚焦验证

复用 Linux 容器 `localmind_qa143_source` 和固定镜像 `localmind-affine:dev-base`。容器名称沿用上一项验收，源码位于独立快照 `/Users/dev2/Documents/project/LocalMind-qa143`。未重建镜像、创建新镜像标签或删除数据卷。

| 检查                                         | 结果                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 后端 AVA `workspace-folder-page.spec.ts`     | 5 项通过：并发幂等、归属失败整笔回滚、权限与不存在目录拒绝、移动／回收后的重放、白板模式与真实 GraphQL |
| 前端 Vitest                                  | 46 项通过：创建服务 9、创建 hook 3、既有目录 store 23、创建菜单 11                                     |
| 后端 `tsc --noEmit`、新增测试定向类型检查    | 通过                                                                                                   |
| GraphQL 与 i18n 项目类型检查                 | 通过                                                                                                   |
| 6 个本次前端文件的项目上下文类型检查         | 通过；未将定向结果声称为整个 monorepo 全量通过                                                         |
| Prisma／GraphQL／i18n 生成                   | 使用既有命令完成                                                                                       |
| lint、Prettier、UI detector、diff whitespace | 本次改动聚焦检查通过                                                                                   |
| 新库全量迁移                                 | 421 个迁移全部应用                                                                                     |
| 420 → 421 升级                               | 带旧文件夹、页面及正文的独立库升级成功，原有 257 张表的数据指纹全部不变                                |

主要命令（容器源码根目录 `/workspace`；后端命令在 `packages/backend/server` 执行）：

```sh
yarn prisma generate
yarn prisma migrate deploy
yarn ava --serial --timeout=60s src/__tests__/copilot/workspace-folder-page.spec.ts
yarn tsc --noEmit --pretty false
yarn typecheck:copilot --file src/__tests__/copilot/workspace-folder-page.spec.ts
yarn vitest run \
  packages/frontend/core/src/modules/organize/services/folder-page.spec.ts \
  packages/frontend/core/src/desktop/components/navigation-panel/nodes/folder/create-page.spec.tsx \
  packages/frontend/core/src/modules/organize/stores/folder.spec.ts \
  packages/frontend/core/src/components/native-files/create-menu.spec.tsx
# packages/common/graphql
yarn gql-gen
# 仓库根目录
yarn workspace @affine/i18n build
```

## 真实页面验收

通过真实浏览器操作隔离实例 `http://127.0.0.1:3031`，使用合成测试用户和旧目录工作区「QA119 创建重试验收」。测试账号、数据和故障代理均不进入业务实例。准备夹具后，所有被验收的创建、重试、刷新与编辑器打开均由页面操作触发；没有调用接口代替页面验收。

| 目标文件夹 | 故障与页面操作                                         | 最终页面 ID                            | 结果                            |
| ---------- | ------------------------------------------------------ | -------------------------------------- | ------------------------------- |
| 提交前失败 | 代理在提交前返回 503；页面显示失败，再从原目录继续创建 | `01ff11fd-534d-4ff2-b48f-52b292fdc28d` | 复用原请求键，目录中 1 页       |
| 响应丢失   | 服务端返回成功后代理改为 504；点击失败通知「重试」     | `319a8225-498a-401c-8311-49f9cadfe306` | 打开已提交的原页面，目录中 1 页 |
| 刷新后恢复 | 服务端提交后丢失响应；刷新浏览器，再从原目录继续创建   | `678b1e23-37ea-4fce-97f9-44db9fed9834` | 持久意图恢复原请求，目录中 1 页 |

三个编辑器均最终显示已保存并完成同步。全部文档页面显示总计 3 页，侧栏分别位于三个指定文件夹；数据库只读核验每个目标仅有一份回执。代理记录中的失败请求键与恢复请求键逐项一致。

原始证据保存在本机忽略目录 `.codex-artifacts/qa119/`：`response-lost.png`、`final-folders.png`、`browser-proxy.log`、`browser-receipts.log` 和聚焦检查日志。故障代理只注入隔离实例的该 mutation，不修改业务实例网络行为。

## 本地集成

修改前核对原仓库与记录的基线，保留其他已有修改；只同步本项实现文件。数据库备份为 `.docker/backups/qa119-20261028-before-folder-page-creation.dump`，约 1.9 GiB，权限 600，已通过 `pg_restore --list` 检验。

运行实例同步使用既有脚本，统一更新迁移、Prisma Client 和同平台 native addon，不构建镜像。脚本首次等待就绪失败：多个容器共享同一 native 文件的 bind mount，文件替换后仍持有旧 inode。停止共享该挂载的隔离验证容器及本地 backend／web／admin，再通过现有 Compose 配置重建这三个开发容器，恢复了文件绑定；未重建镜像、删除数据卷或更改服务配置。

恢复后真实 GraphQL 返回成功，新 mutation 可见，native 加载通过，业务实例确认 421 个迁移；证据见本机 `runtime-sync.log`（保留首次失败）及 `runtime-ready.json`（最终成功）。隔离故障代理、验证 Web 和 Redis 已停止，测试源码与数据库保留。本项没有 commit、push、创建 PR 或发布生产镜像。

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_qa143_source \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_qa143_source \
LOCALMIND_DATABASE_BACKUP=/Users/dev2/Documents/project/LocalMind/.docker/backups/qa119-20261028-before-folder-page-creation.dump \
yarn localmind:sync:backend
```

检查时磁盘剩余约 66 GiB；Docker 镜像总计 20.33 GB，构建缓存 1.365 GB。此次未清理无关镜像、容器或持久卷。备份、测试快照与测试数据库保留供复核。
