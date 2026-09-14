# LocalMind Logging System 执行记录

本轮在保留现有工作区改动的前提下完成了首个可运行垂直切片：

- `LocalMindLogService` 统一结构化事件、关联 request id、stdout JSON 镜像、PostgreSQL 写入和 spool 补写。
- `redactor.ts` 对嵌套 metadata 做键级脱敏、深度/键数/字符串长度限制，并对 actor id 做 SHA-256 截断哈希。
- `localmind_log_events` Prisma 模型及 `20260913010000_localmind_logging_system` 迁移提供 event_id 唯一幂等约束和关联索引。
- `POST /api/logs/batch` 接收认证客户端批量事件；服务端忽略客户端 actor、Workspace、Project 字段。
- `/admin/observability/logs` 和 `/admin/observability/settings` 已加入 Admin 路由与导航，日志页支持 request id 查询及 loading/empty/error 状态。
- self-hosted TelemetryManager 清空官方 endpoint；前端 TelemetryService 不在 self-hosted 实例执行 identify、people 或 flush。
- `LocalMindClientLogTransport` 位于 `packages/common/infra/src/logging/`，提供 Web/Electron/Android/iOS 可复用的实例批量上传、localStorage 离线队列、边界容量和重试。
- 后端 legacy `console.*` 通过启动时 console bridge 进入 LocalMind sink；浏览器 self-hosted console 同样由 `installLocalMindConsoleBridge` 汇聚到实例。spool 默认按 `LOCALMIND_NODE_ID` 分目录，避免多副本共享目录无协调写入；补写 worker 使用原子 `.flush-lock` lease，60 秒过期后可接管。
- `LocalMindLogPolicy` 持久化默认保留策略、spool 容量和 legal hold；Admin GraphQL 提供读取、受限更新和 retention cleanup。
- `LocalMindAuditEnvelope` 与日志写入使用同一 Prisma transaction，迁移安装不可变 UPDATE/DELETE trigger，并以 fingerprint/event_id 追踪业务审计证据。
- `localmind_log_events` 已迁移为 PostgreSQL `RANGE(occurred_at)` 分区父表、2026–2028 年分区与 DEFAULT 分区；`localmind_log_event_ids` + 触发器提供跨分区全局 `event_id` 幂等约束，Prisma 使用 `[id, occurredAt]` 复合主键兼容分区要求。
- self-hosted 后端在 GA4、OpenTelemetry 初始化入口 fail-closed；Electron Sentry 仅在显式 `LOCALMIND_EXTERNAL_TELEMETRY=1` 时初始化，Web/Admin/移动路由追踪和 Electron preload 在 self-hosted 关闭；Sentry embedding logger 已替换为 `@affine/debug` 结构化入口。
- retention cleanup 使用 PostgreSQL advisory transaction lock，支持 dry-run 和 legal hold；spool 损坏 checksum 会拒绝补写并保留批次供运维处理。
- Admin 支持脱敏 NDJSON/CSV 导出；导出和 retention cleanup 本身写入审计 envelope。
- `LocalMindLogArchive` 与 `retentionFrozen/frozenAt` 已持久化；归档在 advisory lock + Prisma transaction 内批量 upsert 后删除运行日志，法务留置或冻结时 fail-closed 跳过。导出增加 5 MiB 字节上限并在审计中记录截断。
- Log Center GraphQL 查询已支持时间范围、service/component、request/trace、Workspace/Project、run/job、status、error code、关键词过滤，并返回关联 `auditEventId`；Admin 行点击可查看受限事件详情和脱敏 metadata。
- `@affine/debug` 新增结构化 sink；self-hosted TelemetryService 绑定实例 transport，DebugLogger 事件自动进入 `/api/logs/batch`。HTTP middleware 与 GraphQL plugin 产生统一 completed/failed 事件。

验证证据：

```text
yarn workspace @affine/server prisma validate --schema schema.prisma       PASS
yarn workspace @affine/server prisma generate --schema schema.prisma       PASS
yarn workspace @affine/graphql build                                      PASS
yarn exec tsc -p packages/backend/server/tsconfig.json --noEmit           PASS
yarn exec tsc -p packages/frontend/admin/tsconfig.json --noEmit            PASS
yarn lint:ox <日志改动文件>                                                  PASS
yarn prettier --ignore-unknown --check <日志改动文件>                      PASS
yarn workspace @affine/server ava --serial src/base/logger/__tests__/localmind-log-service.spec.ts  PASS (3)
yarn vitest run packages/common/nbstore/src/telemetry/__tests__/manager.spec.ts                 PASS (3)
yarn vitest run packages/common/infra/src/logging/client-transport.spec.ts                       PASS (2)
yarn r packages/backend/server/scripts/localmind-selfhosted-egress.smoke.ts                     PASS (fetch=0)
spool checksum 损坏恢复测试（`localmind-log-service.spec.ts`）                                PASS
spool 重启/损坏/容量上限 smoke（`localmind-spool-recovery.smoke.ts`）                           PASS
审计事务失败后 spool 补写及 envelope replay（`localmind-audit-spool-recovery.smoke.ts`）         PASS
空 PostgreSQL 迁移（pgvector/pgvector:pg16，365 migrations）                      PASS
空 PostgreSQL 分区与全局 event_id 触发器验证（父表 `relkind=p`、重复插入返回 `23505`） PASS
pg_dump/pg_restore 备份恢复验证（恢复库保留分区父表与 event_id 注册表）         PASS
self-hosted 外发阻断 smoke（`yarn r packages/backend/server/scripts/localmind-selfhosted-egress.smoke.ts`） PASS（fetch 调用数 0）
冻结/法务留置 cleanup + archive 单元覆盖已加入 `localmind-log-service.spec.ts`；AdminGuard 非管理员拒绝/管理员允许覆盖已加入 `core/common/__tests__/admin-guard.spec.ts`（AVA 受仓库 prelude extensionless import 限制，需通过既有打包测试入口运行）。
新增 `20260913014000_localmind_log_archive` 在一次性 pgvector/pg16 空库成功应用，确认 `localmind_log_archives` 与冻结字段存在。
`./node_modules/.bin/affine bundle -p @affine/admin` 生产 bundle 编译成功；开发服务器可启动于 `http://localhost:8080`，但其默认代理目标为 `localhost:3010`，当前运行容器监听 `3011` 且仍为旧镜像，故浏览器只能验证静态 bundle 启动，GraphQL/页面数据验证被代理连接拒绝阻断。
源码后端以 `DEPLOYMENT_TYPE=selfhosted AFFINE_SERVER_PORT=3010` 连接一次性 pgvector/pg16 数据库启动成功；未认证的 `/api/logs/batch` 与 `/api/logs/export` 均返回 401，GraphQL 日志查询返回认证错误。运行约 90 秒期间 PostgreSQL 写入 632 条结构化事件，其中 23 条敏感启动消息被 `[message redacted]` 替换，证明 stdout mirror 与 PostgreSQL 真相源同时工作。测试完成后已停止临时进程和容器。
同一 spool 目录的两个 `LocalMindLogSpool` 实例并发获取 flush lease 返回 `{first:true,second:false}`，证明跨副本文件租约互斥。
使用临时静态代理和注入的 self-hosted 运行配置，在 Chrome 真实标签页完成 Admin 浏览器验证：`/admin/observability/logs` 显示导航、五个筛选框、空状态和导出入口；填入 `req-demo` 后导出链接变为 `/api/logs/export?format=ndjson&requestId=req-demo`。`/admin/observability/settings` 显示保留天数、spool 状态、法务留置、冻结、保存和 dry-run 控件；390×844 窄视口下同样完成渲染检查。代理返回的 GraphQL 数据为脱敏测试数据，未使用真实用户凭据。
```

`yarn typecheck` 仍被仓库既有 BlockSuite `DefaultViewDataType` 测试错误阻断；日志相关 server/admin 独立 typecheck 已通过。当前运行中的 `localmind_affine_server` 容器使用旧镜像，浏览器打开新 Admin 路由返回静态壳但未加载本轮前端 bundle，因此无法作为新页面的运行时证据。

全仓 `rg` 接入扫描与有意保留例外见 `docs/localmind-logging-system.integration-inventory.md`。CLI/BlockSuite 开发诊断和 Electron 本地文件 logger 是明确例外；它们不进入外部 telemetry，客户端实例 transport 负责自动补写。此前容器使用旧镜像的限制已由静态代理 + Chrome 窄屏/桌面验证补足；源码后端和数据库迁移证据也已补齐。

## 2026-09-14 最终验收补充

- 使用仓库要求的 TypeScript ESM hook 运行后端 AVA：`resolver.spec.ts`、`admin-guard.spec.ts` 与 `localmind-log-service.spec.ts` 共 10 项全部通过。覆盖无 `Workspace.Users.Manage` 权限拒绝、授权用户的 Workspace/Project 过滤、管理员守卫、脱敏、checksum、event_id 幂等、事务审计和 legal hold/freeze。
- `yarn vitest run packages/common/infra/src/logging/client-transport.spec.ts packages/common/nbstore/src/telemetry/__tests__/manager.spec.ts packages/backend/server/src/core/telemetry/__tests__/selfhosted-block.spec.ts`：5 项通过；spool、审计补写和 self-hosted 外发阻断 smoke 全部通过。
- 只读导出当前 `localmind_affine_postgres` 得到 `/tmp/localmind-logging-upgrade-20260914.dump`（6.7 MB）。恢复到临时 `pgvector/pgvector:pg16` 后执行 `DATABASE_URL=postgresql://affine:affine@127.0.0.1:55436/affine yarn workspace @affine/server prisma migrate deploy --schema schema.prisma`；361 条既有迁移加本轮 5 条迁移共 366 条全部成功，确认日志分区父表、DEFAULT 分区、全局 event-id 注册表和归档表存在。临时容器随后移除，现有数据库与卷未修改。
- 新增 scoped audit resolver 的真实 AVA 权限覆盖，且 `yarn exec tsc -p packages/backend/server/tsconfig.json --noEmit`、Admin typecheck、oxlint、Prettier 和 `git diff --check` 均通过。spool status 现在返回最近 flush 时间、成功数和失败原因，便于 Admin 诊断。
- 2026-09-14 重新执行全仓扫描命令，报告为 1,874 条命中；入口分类及有意保留例外见 `docs/localmind-logging-system.integration-inventory.md`，扫描原文见 `docs/localmind-logging-system.rg-report.txt`。
