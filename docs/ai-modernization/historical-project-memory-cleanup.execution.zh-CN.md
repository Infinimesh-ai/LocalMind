# QA-123：历史错误共享记忆清理执行记录

日期：2026-10-28。对应验收 TODO-04；active track 为
[Context Memory](./tracks/context-memory.md)，产品边界沿用
[共享记忆契约 §5.6](./workspace-project-context-session-remediation.zh-CN.md#56-关闭删除撤销及成员生命周期)。

## 范围与历史核查

只读清点本地运行实例的全部 10 条 Project 共享记忆（3 个项目）：原状态为
7 条 active、1 条 disabled、1 条 deleted、1 条 superseded。逐条核对当前内容、
提取事件、来源用户消息及贡献链；不会因为内容属于测试、多人贡献或发生事实冲突而删除。
另有 16 条非 Project 记忆，本任务不处理。无自动关键词批量清理、无重跑提取器改写历史。

确认两条错误提取：

| 记忆 ID                                | 项目                | 错误依据                                                                                                        | 处置                                               |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `c540e9e8-b810-4fcc-b868-c995b954c807` | QA-P1-海棠-20261019 | 原用户消息要求原地修改 JSON；旧提取器将“将 total 从 60 改为 66，并增加 verified=true”的一次操作误提取为项目事实 | Owner 通过页面暂停为 disabled / revision 2         |
| `de38692c-c591-4c37-8475-10897a6f14ad` | QA-RERUN-P1-1027    | 原消息明确要求保存海棠与销售目标；实际提取成“它作为项目共享记忆，并简短确认”，属于指令残句                      | 保持已有 disabled / revision 2，不为补审计重新启用 |

其他 8 条保留原状，包括活动事实、成员的独立冲突贡献，以及 deleted/superseded
历史版本。错误事实键与被覆盖事实的恢复仍属于 TODO-06，不据此宣布完成。

清理前后的清点脚本仅读取；本地证据只保存 ID、状态、指纹及关系哈希，不导出私人
消息正文。原始事件、来源消息与贡献仍保留在数据库。旧停用动作没有新类型回执，
本轮不伪造其历史操作者/时间。

## 实现

- 项目设置增加单条自动记忆的「暂停召回／恢复召回」，复用现有 mutation。
  Owner 可管理共享库，成员仅可管理仍属本人独立、未被他人修改/合并的贡献；
  服务端再次核对当前成员身份与来源资格，UI 隐藏无管理权限的操作。
- 状态请求必须带页面显示的 revision。写入在事实键锁、记录锁及版本校验下完成；
  同状态请求不增加版本或回执，旧版本和并发重复请求不能覆盖新状态。
- 暂停保留正文、内容指纹、来源与贡献；所有成员后续的主动召回排除该记录。
  恢复拒绝已删除/退役、过期、撤权/隔离或与新活动事实冲突的记录。
  修正已暂停内容产生的后继版本仍暂停；同时修改正文和召回状态的请求被拒绝。
- 状态、Project 记忆修订版/失效通知与 PAUSE/RESUME 回执同事务提交。
  回执保存独立 actor 快照及结果 revision，数据库约束检查其与实际写入一致；
  回执不可修改或删除，账号清理只允许按既有删除流程解除 live FK，保留快照。
- 迁移 `20261028030000_project_memory_recall_lifecycle` 添加两列与约束，
  不改变旧提取事件，不新增模型工具或公开 MCP 权限。GraphQL 签名未变化。
- 暂停不会抹除已经出现在私人会话里的聊天历史；本轮验证的是后续召回、状态及审计。

主要源码：

- `packages/backend/server/src/models/copilot-context-memory.ts`：生命周期事务与回执。
- `packages/backend/server/src/plugins/copilot/context-memory-resolver.ts`：公开写入版本要求。
- `packages/backend/server/schema.prisma` 及上述新迁移：actor/revision 证据与数据库保护。
- `packages/frontend/core/src/desktop/pages/intelligence/project-shell-settings.tsx` 与
  `workbench-labels.ts`：确认、重复提交保护、状态刷新和审计标签。
- `packages/frontend/i18n/src/resources/{en,zh-Hans,zh-Hant}.json` 与生成类型：三种语言文案。
- 新增 `copilot-memory-recall-lifecycle.spec.ts`，扩充设置组件测试；QA-143 的删除场景
  改用已有专用 `delete` 领域方法，继续验证删除后不会因重新授权恢复。

## Linux 验证

复用 `localmind_qa122_sync_source` 容器和隔离源码，镜像为
`localmind-affine:dev-base`，没有重建镜像。

| 检查                                        | 结果                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| 7 项新增后端生命周期测试 + 9 项 QA-143 回归 | 16 项通过                                                                |
| 项目设置组件                                | 11 项通过                                                                |
| 422 个迁移在空库全量应用                    | 通过                                                                     |
| 421 → 422 升级                              | active/disabled/deleted/superseded 四类旧记录及旧 ADD 事件逐字段保持一致 |
| 后端 `tsc --noEmit`                         | 通过                                                                     |
| 变更的后端测试及前端组件/测试类型诊断       | 通过                                                                     |
| oxlint、Prettier、i18n 生成                 | 通过                                                                     |
| Impeccable 静态检测                         | 0 项发现                                                                 |

后端覆盖：跨成员召回、Owner/独立贡献者/多人贡献权限、退出成员拒绝、并发与陈旧
revision、过期/删除/退役/撤权/冲突恢复拒绝、内容修订保留停用、审计不可变、
账号关联解除、审计写入失败整笔回滚、GraphQL 必需版本及授权拒绝。
前端覆盖确认、传递 revision、重复提交锁定、失败保留原状态、权限/历史版本按钮
隐藏，以及切换项目后旧确认无效。

主要命令：

```sh
docker exec localmind_qa122_sync_source yarn test src/__tests__/copilot/copilot-memory-recall-lifecycle.spec.ts src/__tests__/copilot/copilot-memory-source-revocation.spec.ts
docker exec -w /workspace localmind_qa122_sync_source yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/project-shell-settings.spec.tsx
docker exec localmind_qa122_sync_source yarn tsc --noEmit --pretty false
docker exec localmind_qa122_sync_source yarn typecheck:copilot --file src/__tests__/copilot/copilot-memory-recall-lifecycle.spec.ts --file src/__tests__/copilot/copilot-memory-source-revocation.spec.ts
docker exec -w /workspace localmind_qa122_sync_source node .codex-artifacts/qa123/typecheck-frontend.mjs packages/frontend/core/src/desktop/pages/intelligence/project-shell-settings.tsx packages/frontend/core/src/desktop/pages/intelligence/project-shell-settings.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/workbench-labels.ts
```

升级 fixture、检查脚本和结果保存在 `.codex-artifacts/qa123/`。迁移和破坏性失败注入
仅在隔离数据库运行，业务数据处置必须通过页面。

## 真实页面验证

隔离 Web `http://127.0.0.1:3031`，真实后端/数据库，未 mock GraphQL：

- Owner 从「项目操作 → 项目权限与成员」进入设置；错误片段显示活动状态。
- 点击暂停并确认，记录变为「当前未启用」，共享记忆修订版 4 → 5，历史显示
  「已暂停召回」；正确事实仍活动，原本停用记录仍停用。
- 点击恢复并确认，修订版 5 → 6，历史增加「已恢复召回」；再次暂停至修订版 7，
  最终错误样本仍停用。
- 1280×720 浅色、深色检查通过。此改动复用既有设置布局，未做移动端验收。

截图：[深色暂停](../../.codex-artifacts/qa123/isolated-paused-dark.png)、
[浅色恢复](../../.codex-artifacts/qa123/isolated-restored-light.png)。

业务实例 `http://localhost:3011` 使用项目 Owner 的原测试账号真实操作：

- QA-P1-海棠-20261019 中误提取的 JSON 操作指令，经「暂停召回」确认后变为
  「当前未启用」；项目共享记忆修订版 5 → 6，贡献历史增加「已暂停召回」。
- 回执 `42790bc0-6325-4857-8a70-a08c60239bb8` 绑定原记忆 ID、操作者快照和
  memory revision 2，保留原 ADD 提取事件。
- QA-RERUN-P1-1027 页面确认旧残句仍未启用；海棠/销售目标与部署区域事实保持活动。
- 只读前后核对通过：6 active、2 disabled、1 deleted、1 superseded；仅目标的
  状态/revision 及操作者/更新时间改变，并新增 1 条 PAUSE 回执。其余 8 条共享
  记录和原停用残句逐字段一致，全部正文/指纹、贡献和来源哈希一致；16 条非 Project
  记忆也逐字段一致。
- 真实页面没有直接调用写接口或改数据库，未额外运行真实模型回答质量评测。

截图：[实际错误记录暂停及回执](../../.codex-artifacts/qa123/historical-error-paused.png)、
[旧停用项保留](../../.codex-artifacts/qa123/previously-disabled-preserved.png)。
原始清点、哈希断言和回执见 `.codex-artifacts/qa123/inventory-before.json`、
`inventory-after.json`、`cleanup-check.json` 与 `cleanup-receipt.json`。

## 本地运行交付

- 变更前备份 `affine` 数据库：
  `.docker/backups/qa123-20261028-before-memory-cleanup.dump`，2,000,186,735 字节，
  权限 600，`pg_restore --list` 校验通过。
- 使用既有源码模式同步脚本应用迁移、Client、native；不绕过 schema、数据库身份
  或备份检查。固定源码容器复用上轮已验证 Linux native，不重建镜像。
- 首次同步应用迁移成功，但原有单文件 native bind mount 需要重新绑定，首次
  60 秒就绪探测超时；保留失败日志。按既有 Compose 配置依次以
  `--no-deps --no-build --force-recreate` 重建 Web/Admin 容器，再重建 backend
  容器，native 加载和 GraphQL HTTP 200 / Query 复核通过，业务数据库为 422 个迁移。
  这是容器重建，不是镜像重建；未改同步脚本或绕过检查。
- 同步前磁盘可用约 63 GiB；Docker 镜像 20.69 GB、容器 3.748 GB、卷 29.76 GB、
  构建缓存 1.365 GB。没有删除 volume 或无关数据。最终磁盘可用约 54 GiB。

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_qa122_sync_source \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_qa122_sync_source \
LOCALMIND_DATABASE_BACKUP=/Users/dev2/Documents/project/LocalMind/.docker/backups/qa123-20261028-before-memory-cleanup.dump \
yarn localmind:sync:backend
```

隔离 Web、后端、验证容器与本轮 Redis 已停止；保留隔离源码、数据库和验证证据，
业务热启动实例继续运行。未 commit、push、创建 PR 或发布生产镜像；保留原工作区其他改动。

验收清单已删除 TODO-04，剩余 8 项（6 项待处理、2 项待页面验证）。本轮结论限于
本地源码、Linux 验证及本地运行实例，不代表生产发布或完整 A01—A40 验收。
