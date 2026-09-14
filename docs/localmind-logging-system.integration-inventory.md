# LocalMind 统一日志接入清单

本清单由以下扫描生成（2026-09-14）：

```sh
rg -n "new Logger|console\\.(log|error|warn|info|debug)|@affine/debug|\\.catch\\(console\\.error\\)|Sentry|OpenTelemetry|telemetry" packages blocksuite services tests tools
```

扫描结果包含 1874 个命中（CLI、BlockSuite worker 和构建脚本为明确例外）。后端新增的 `LocalMindLogService`、脱敏器和 spool 位于
`packages/backend/server/src/base/logger/`，Admin 查询位于
`packages/backend/server/src/core/observability/`。客户端日志批量入口为
`POST /api/logs/batch`，服务端会丢弃客户端提交的 actor、Workspace、Project 等身份字段，
仅使用当前认证上下文。

逐条命中（文件、行号和原始表达式）保存在
[`localmind-logging-system.rg-report.txt`](localmind-logging-system.rg-report.txt)。

有意保留的入口：

- `tools/*` 下的 CLI 输出：这些是命令行用户界面，不属于实例运行日志；错误内容仍应避免凭据。
- `blocksuite/*` 与 `packages/common/nbstore/*` 中的开发期诊断输出：它们不携带文档正文，生产自托管的官方 Telemetry transport 已阻断。
- `@sentry/*` 构建集成：仅在显式 Sentry build 环境启用；self-hosted Web/Admin/移动路由不包装 Sentry，Electron preload 不加载 Sentry，Electron main 仅在 `LOCALMIND_EXTERNAL_TELEMETRY=1` 时初始化。
- `packages/backend/server/src/base/metrics/*` 与 `plugins/gcloud/metrics.ts`：保留 exporter 依赖和 affine 云端实现；self-hosted `OpentelemetryProvider` 在初始化前返回，不创建 SDK/exporter。

新增的 self-hosted 阻断逻辑位于 `packages/common/nbstore/src/telemetry/manager.ts`、`packages/backend/server/src/core/telemetry/service.ts` 和 `packages/backend/server/src/base/metrics/opentelemetry.ts`：
`isSelfHosted` 会清空官方 endpoint，`flush()` 在没有 endpoint 时不发出网络请求。浏览器端
`TelemetryService` 也不会在 self-hosted 实例执行 identify、people 或 flush。

Electron 主进程的 `electron-log` 文件 transport 是故障排查用本地短期 spool 例外；业务日志仍通过 renderer 的 `LocalMindClientLogTransport` 自动写入同一实例。`AffineErrorBoundary`、embedding progress/enabled 和 Electron 启动错误已转入 `@affine/debug`/LocalMind transport。

保留策略现在支持 `retentionFrozen/frozenAt` 的冻结/解冻；归档接口使用 `LocalMindLogArchive` 表、事务和 advisory lock，5 MiB 导出上限及截断审计也已接入。新增迁移为 `20260913014000_localmind_log_archive`。

源码 self-hosted 后端实跑时，未认证的批量写入、导出和 GraphQL 日志查询均被统一认证守卫拒绝；临时 PostgreSQL 中观察到 632 条结构化事件写入，敏感启动消息经过脱敏后才落库。

2026-09-14 的 scoped audit resolver 权限测试覆盖了无 `Workspace.Users.Manage` 权限拒绝、授权用户的 Workspace/Project 过滤；常规事件 event_id 重放也已验证为幂等成功。spool health API 同时返回积压字节/文件数、最近 flush 时间、成功数和最近失败原因。

需要后续垂直迁移的入口仍可通过上述 `rg` 命令定位；迁移时必须调用
`LocalMindLogService.write()`，不得直接把原始 payload 写入 stdout、Telemetry 或第三方 exporter。
