# 项目记忆来源重新授权执行记录（TODO-01 / QA-143）

日期：2026-10-28（UTC）。产品规则由用户于 2026-10-27 确认。本记录仅关闭 TODO-01，
不代表共享记忆全部 A01—A40 或其他验收待办完成。

## 产品结果

来源文档分享菜单增加「已有项目记忆共享」。有来源管理权限的用户重新允许共享后，
服务端自动恢复此前因来源撤权而隔离的共享记忆，无需逐条重新启用。

- 恢复保留原内容、贡献和来源关系，并递增记忆及项目记忆版本。
- 原本停用、已删除、因其他原因隔离的记忆不启用。过期或与较新活动事实冲突的旧版本继续停用。
- 混合来源正文要求全部绑定来源有效；只恢复部分来源时，独立事实先恢复，混合事实继续隐藏。
- 每次决定保存不可变回执；相同请求可幂等重试，过期版本返回 409 并要求刷新。
- 管理列表、召回、修改、历史撤销及共享写入都检查当前来源资格。打开的项目设置页随项目版本变化刷新，保留现有定期校准兜底。
- 记忆共享授权不恢复旧项目文档授权，也不授予普通页面、搜索或来源新版读取权限；已批准的独立副本沿用原契约。

## 实现边界

领域实现位于 `intelligence-workbench-authorization.ts`、`copilot-context-memory.ts`
和 `copilot-context.ts`；GraphQL resolver 与分享菜单共用领域授权。
授权前后检查来源管理权限、有效项目、来源绑定及当前分享资格。
恢复和撤权锁定关联记忆，历史来源删除遵循来源 grant → memory 的统一锁顺序，
避免与共享写入交叉持锁。新事实唯一键冲突只推迟对应旧版本，不回滚其他合法恢复。

新增前向迁移 `20261028010000_project_memory_source_reauthorization`：

1. 将当前记忆来源授权与不可变授权事件分开保存，不改写历史文档 grant 或记忆来源边。
2. 数据库要求授权版本单调递增并有匹配回执；解除隔离必须绑定原记忆 ID、revision、隔离时间，且全部来源重新有效。
3. 保留原生项目证据、项目摘要和 Owner 修订链的既有约束。迁移本身不解除任何隔离。
4. 项目记忆版本变化写入现有按成员投递的 `project.list.changed` outbox；通知不包含正文。

GraphQL schema/client 和中英繁体文案通过现有生成流程更新；未增加 AI 工具或公开 MCP 能力。

## Linux 验证

复用固定镜像 `localmind-affine:dev-base`，独立源码目录
`/Users/dev2/Documents/project/LocalMind-qa143`，测试容器 `localmind_qa143_source`。
数据分别使用 `localmind_qa143_isolated`、`localmind_qa143_upgrade`、
`localmind_qa143_ui`，Redis 也与本地业务实例隔离。没有构建镜像或更换固定 tag。

| 检查                                    | 结果                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| 来源撤权/自动恢复 AVA                   | 9 个通过，进程正常退出                                      |
| 原生 Project Memory 回归                | 2 个通过                                                    |
| 记忆可见性 planner 回归                 | 2 个通过                                                    |
| 分享菜单与项目设置 Vitest               | 11 个通过                                                   |
| 后端全量 `tsc --noEmit`                 | 通过                                                        |
| 新增后端测试聚焦类型检查                | 通过                                                        |
| 4 个变更前端组件/测试的项目配置类型诊断 | 通过                                                        |
| GraphQL 与 i18n 类型构建                | 通过                                                        |
| 变更文件 oxlint / Prettier              | 通过                                                        |
| 空库全量迁移                            | 420 个迁移全部应用成功                                      |
| 旧库升级                                | 419 → 420；迁移不恢复隔离，显式重新授权仅恢复原 active 记录 |

行为用例覆盖：多来源部分/全部授权、重复和冲突请求、原本停用/删除/其他隔离、
过期和较新事实冲突、无权来源管理者、过期分享资格、数据库绕过拒绝、不可变回执、
撤权与恢复并发、撤权与共享写入锁顺序、成员刷新、记忆重新召回后合法共享写入，
以及实际 GraphQL 的 409 与越权拒绝。

主要执行命令（测试容器默认工作目录为 `/workspace/packages/backend/server`）：

```sh
docker exec localmind_qa143_source yarn ava --serial --timeout=60s src/__tests__/copilot/copilot-memory-source-revocation.spec.ts
docker exec localmind_qa143_source yarn ava --serial --timeout=60s src/__tests__/copilot/project-context.e2e.ts '--match=*native Project memory*'
docker exec localmind_qa143_source yarn ava --serial --timeout=60s src/__tests__/copilot/copilot-context-planner.spec.ts '--match=*memory visibility*'
docker exec -w /workspace localmind_qa143_source yarn vitest run packages/frontend/core/src/modules/share-menu/view/share-menu/project-access.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/project-shell-settings.spec.tsx
docker exec localmind_qa143_source yarn tsc --noEmit --pretty false
docker exec localmind_qa143_source yarn typecheck:copilot --file src/__tests__/copilot/copilot-memory-source-revocation.spec.ts
docker exec -w /workspace localmind_qa143_source yarn tsc -b packages/common/graphql packages/frontend/i18n
docker exec -w /workspace/packages/common/graphql localmind_qa143_source yarn gql-gen
docker exec -w /workspace localmind_qa143_source yarn workspace @affine/i18n build
```

使用普通 AVA 模式，不设置 `TEST_MODE=e2e`。全量迁移通过一次性数据库的
`prisma migrate reset --force --skip-seed` 完成；升级先应用前 419 个迁移，
用旧代码/Client 建立 active、disabled、deleted 和撤权 fixture，再用新代码执行
`prisma migrate deploy` 及状态断言。所有 reset/fixture 都限于隔离测试库。

聚焦类型诊断脚本、升级 fixture/断言及检查日志保存在本地
`.codex-artifacts/qa143/`；该目录不包含数据库凭据或备份正文。

## 真实页面复测

使用隔离 Web `http://127.0.0.1:3031` 与真实后端/数据库，不 mock GraphQL。
先通过测试 fixture 建立两份历史合法来源 A/B、单来源记忆 A/B、双来源记忆 AB，
以及原本停用、已删除记录。后续撤权与重新授权全部通过页面真实按钮操作。

| 页面操作                                    | 观察结果                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| 分享菜单撤销 A                              | A 和 AB 隐藏，B 保留；包含停用项的管理列表也不显示未授权正文                 |
| 重新允许 A                                  | 自动恢复 A/AB，原本停用项显示「当前未启用」，已删除项不出现                  |
| 分别撤销 A/B，再仅允许 A                    | 提示恢复 1 条、暂缓 1 条；AB 继续隐藏                                        |
| 再允许 B                                    | 提示恢复 2 条；A/B/AB 均活动，原本停用项仍停用                               |
| 保持项目设置页打开，另一标签页反复撤权/恢复 | 项目记忆版本与列表自动刷新，无需关闭重开                                     |
| 两个标签页持同一授权版本确认撤权            | 首次成功；第二次显示「记忆共享已被其他操作修改，请刷新权限状态后重新确认。」 |
| 深色主题打开来源分享菜单                    | 授权状态、确认操作和独立副本区域清晰可读                                     |

桌面 1280×720 的浅色项目设置页与深色分享菜单已检查；本次未修改布局或进行移动端验收。
页面最后恢复全部测试来源共享，停用/删除记录保持原状态。真实模型质量评测不属于此授权任务。

截图：

- [恢复后记忆列表](../../.codex-artifacts/qa143/restored-memories.png)
- [深色分享菜单](../../.codex-artifacts/qa143/source-sharing-dark.png)

## 本地运行环境交付

已完成本地源码热启动实例同步，未发布生产镜像或远端变更。

- 同步前使用 `pg_dump -Fc` 备份原 `affine` 数据库，保存为
  `.docker/backups/qa143-20261028-before-reauthorization.dump`（约 1.9 GiB），
  `pg_restore --list` 校验成功；文件权限为 600。
- 暂停源码 watcher 后复制本任务文件，现有脚本暂停后端 worker、应用迁移、同步
  Prisma Client/native 并通过 Compose `--no-build --force-recreate` 重启后端。
  源码快照去除无关格式变化后曾触发 Client 文本证据不一致；确认仅缺一行注释并补齐后，
  校验通过，没有跳过同步保护。
- `http://localhost:3011/graphql` 返回 HTTP 200 / `Query`；运行后端 schema 包含
  `setCopilotMemorySourceAuthorization`。热启动 Web 通过源码轮询重新编译成功。
- 已保留原工作区无关改动，没有 commit、push 或创建 PR。验收清单删除 TODO-01，
  当前剩余 11 项（9 项待处理、2 项待页面验证）。
- 使用 active track `tracks/context-memory.md` 及共享记忆修复契约 §5.6；未扩展
  Project 原生资源或公开 MCP 权限。
- 未重建镜像。同步后磁盘可用约 68 GiB；`docker system df` 显示镜像 20.33 GB、
  容器 3.382 GB、卷 29.46 GB、构建缓存 1.365 GB。未删除持久化卷或业务数据。
- 验证结束后停止本任务的隔离 Web、后端、测试容器及 Redis；保留隔离源码、测试数据库
  和本地日志便于复核，正常热启动业务实例继续运行。

同步命令：

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_qa143_source \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_qa143_source \
LOCALMIND_DATABASE_BACKUP=/Users/dev2/Documents/project/LocalMind/.docker/backups/qa143-20261028-before-reauthorization.dump \
yarn localmind:sync:backend
```

运行同步及 GraphQL 检查日志同样保存在 `.codex-artifacts/qa143/`。本次结论限于
源码、本地 Linux 验证及本地热启动环境；生产部署仍需按正式发布流程执行。
