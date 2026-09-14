# LocalMind 实例内置日志系统设计

## 1. 文档定位

本文定义 LocalMind 企业私有部署的日志系统设计和后续实施边界。

LocalMind 的部署模型是“一家公司一个逻辑实例”。实例可以由多个服务、容器或副本组成，但日志采集、持久化、查询、保留和导出必须由 LocalMind 自身提供。部署方不需要先安装 ELK、Loki、Fluent Bit 或其他外部系统，才能获得完整的 LocalMind 日志。

stdout 只作为启动故障和容器故障的兼容性镜像，不作为日志真相源，也不作为审计证据。

## 2. 设计目标

日志系统必须能够回答以下问题：

1. 某个请求、WebSocket 连接、队列任务或 AI Run 发生了什么；
2. 哪个实例服务、Worker、Provider 或外部连接器参与了处理；
3. 操作者、Workspace、Project、资源和授权快照是什么；
4. 操作最终成功、失败、拒绝、取消、过期还是重试；
5. 是否产生了副作用，副作用对应哪个审计事件或执行回执；
6. 日志是否已持久化、是否有待补写数据、是否发生过清理或归档；
7. 管理员能否在不暴露文档正文和凭据的情况下完成排障与审计。

## 3. 当前代码基线

当前实现已经存在若干可复用能力，但它们尚未形成统一日志产品：

- `packages/backend/server/src/base/logger/service.ts` 的 `AFFiNELogger` 基于 NestJS `ConsoleLogger`，主要输出文本并附加 request ID；
- `packages/backend/server/src/base/graphql/logger-plugin.ts` 记录 GraphQL operation、耗时和错误指标，但没有持久化请求日志；
- `packages/backend/server/src/base/metrics/opentelemetry.ts` 已覆盖 HTTP、GraphQL、Redis、Socket.IO 和 Prisma Trace/Metric；
- `packages/backend/server/src/base/job/queue/queue.ts` 与 Worker 已通过 `$$requestId` 传播队列关联 ID；
- `packages/backend/server/schema.prisma` 已有 Project、Support Bundle、Repair Execution、Agent Runtime、MCP、企业连接器和 AI Usage 等分散的审计或运行证据模型；
- 自托管 Compose 当前主要通过 `docker compose logs` 观察 stdout，尚无 LocalMind 自己的日志库、日志查询 API 和统一 Admin 日志页面。

这些能力应当被统一，而不是继续为每个功能单独增加另一套日志字段。

## 4. 三种数据的边界

### 4.1 运行日志 `system log`

用于服务运维、错误诊断、性能排查和 Worker 运行观察。它由 LocalMind 采集并写入 `localmind_log_events`，可以按策略采样或清理，但必须记录清理和丢弃原因。

运行日志不保存完整 Prompt、文档正文、附件、模型请求内容、Cookie、Authorization、API key、MCP token 或 OAuth 凭据。

### 4.2 业务审计 `audit ledger`

用于证明权限、审批、发布、复制、删除、取消、重试、外部调用和副作用。审计写入是业务状态转移的一部分，必须使用事务、幂等键、fingerprint 和不可变约束。

现有领域审计表继续保存领域专属字段；后续增加统一的审计事件外壳和事件关联 ID，不把所有领域数据压缩成一个无约束 JSON 表。

### 4.3 指标和 Trace

用于耗时、错误率、队列堆积、Provider 健康和跨服务调用链。Trace 可以采样，安全审计不能采样。Trace 不保存业务正文，也不替代业务审计。

## 5. LocalMind 内置采集架构

```text
业务代码 / Nest Logger / GraphQL / Worker / AI Runtime
                         │
                 LocalMindLogService
                         │
       ┌─────────────────┴─────────────────┐
       │                                   │
结构化 stdout 镜像                 持久化日志写入器
                                           │
                              PostgreSQL 日志表
                                           │
                              Admin Log Center
```

`LocalMindLogService` 是唯一的结构化日志入口，负责：

- 事件名和字段规范化；
- request/trace/actor/resource 上下文补全；
- 敏感字段清洗、截断和哈希；
- 写入 PostgreSQL；
- stdout JSON 镜像；
- 写入失败时进入持久化 spool；
- 补写、清理、归档和健康状态报告。

## 6. 持久化模型

新增 `localmind_log_events`，建议按 `occurred_at` 日或月分区。字段至少包括：

```text
id, occurred_at, ingested_at
instance_id, service, component, deployment_revision
severity, event_name, message_template, message_params
request_id, trace_id, span_id
actor_type, actor_id_hash
workspace_id, project_id, resource_type, resource_id
session_id, run_id, step_id, job_name, job_id
status, error_code, duration_ms
metadata, redaction_version, retention_class
```

日志事件应使用稳定的 `event_name`，例如：

```text
http.request.completed
graphql.request.failed
queue.job.started
queue.job.retried
copilot.run.completed
copilot.provider.request.failed
mcp.tool.execution.denied
log.ingestion.degraded
log.retention.completed
```

`metadata` 必须有 schema、最大字节数、最大键数和最大字符串长度。不可识别字段默认删除，而不是原样保存。

## 7. 可靠性和 spool

日志不能只放在内存队列里。PostgreSQL 暂时不可用时，LocalMind 应将结构化事件写入受保护的本地 spool 目录；恢复后由 Worker 批量补写。

spool 必须具备：

- 持久化目录，默认位于 LocalMind 受保护配置/数据目录；
- 文件轮转和容量上限；
- 每个批次的 checksum、创建时间和重试次数；
- 补写成功、补写失败和达到容量上限的状态事件；
- Admin 可见的 ingestion health；
- 不因普通运行日志写入失败而阻塞全部业务请求；
- 高风险业务审计写入失败时按业务契约 fail-closed。

Redis 不作为日志最终真相源。现有 Redis Compose 配置不能证明其具备审计级持久性，因此只能作为补写调度或通知辅助。

## 8. 关联 ID

LocalMind 应统一维护以下关联字段：

```text
requestId       一次入口请求或后台任务关联 ID
traceId/spanId  OpenTelemetry 调用链
workspaceId     服务端鉴权后的 Workspace
projectId       服务端鉴权后的 Project
runId/stepId    Agent Runtime
jobId           BullMQ 任务
auditEventId    业务审计事件
```

请求入口应支持 W3C `traceparent`，兼容现有 `x-cloud-trace-context`。队列、WebSocket、外部 HTTP、Redis 和 MCP 调用都应传播关联上下文。Workspace、Project 和 actor 信息必须来自服务端授权结果，不能直接信任客户端输入。

## 9. Admin Log Center

新增实例管理员可用的 Log Center，建议入口为 `/admin/observability/logs`，支持：

- 时间范围、severity、service、component、event name；
- request ID、trace ID、Workspace、Project、Run、Job；
- 成功、失败、拒绝、取消、重试和降级状态；
- 关键词和 error code；
- 事件详情、关联日志、关联审计和执行回执；
- 脱敏 NDJSON/CSV 导出；
- 导出动作自身写入审计；
- 清理、归档、spool 堵塞和数据库不可用状态。

运行日志默认只给实例管理员和受控运维角色。Workspace/Project 管理员只能查看授权范围内的业务审计，不能通过日志页面获得文档正文或 Prompt。

## 10. 保留、清理和归档

初始默认值建议：

| 数据                       | 默认保留   |
| -------------------------- | ---------- |
| 运行日志                   | 30 天      |
| 失败、安全和降级日志       | 90 天      |
| Trace                      | 14～30 天  |
| 普通业务审计               | 1 年       |
| 权限、审批、外部副作用审计 | 3～7 年    |
| AI 原始上下文              | 默认不保存 |

保留策略应由实例管理员在 Admin 配置。清理任务使用现有 Cron/Worker 体系，但每次清理、归档、失败和重试都要记录 LocalMind 日志及必要的审计事件。法务留置或管理员冻结时暂停自动删除。

## 11. Telemetry 和外部发送

产品 Telemetry 与 LocalMind 内置日志分开。私有部署默认不向 GA4 或其他外部服务发送日志或用户行为数据。若未来允许发送，必须：

- 由实例管理员显式开启；
- 显示外发目的地和字段范围；
- 与运行日志、审计日志隔离；
- 不包含 Prompt、正文、凭据和不必要的用户标识；
- 外部发送失败不影响本地日志和业务审计。

## 12. 已确认实施决策与补充约束

以下决策已经确认，实施时直接按此执行，不再把它们作为待选方案：

1. PostgreSQL 是日志真相源；stdout 只保留结构化兼容镜像，用于启动故障和容器故障排查。
2. Web、Electron、Android、iOS 和后端通过同一实例的受保护日志接口自动写入该实例。客户端不要求用户手动上传日志；Electron 可以保留本地文件作为短期离线 spool，但最终必须自动补写到实例。
3. 实例管理员可以查看实例内全部运行日志和业务审计。Workspace/Project 管理员仍只能按资源授权范围查看业务审计；管理身份不改变业务操作的原始授权结果。
4. API key、Token、Cookie、Authorization、密码、OAuth 凭据、MCP 凭据、完整 Prompt、文档正文、附件和模型原始请求/响应均禁止写入日志。脱敏器必须在所有 transport 之前执行，并对嵌套对象、错误对象、请求头和异常堆栈统一处理。
5. PostgreSQL 暂时不可用时，普通运行日志写入本地持久化 spool；spool 恢复后由 worker 批量幂等补写。每个事件必须有稳定 `event_id`，数据库唯一约束和补写状态机共同防止重复。高风险业务审计按业务契约 fail-closed，并返回可操作错误。
6. 默认保留策略随 LocalMind 提供，实例管理员可在 `/admin/observability/settings` 修改；配置变更、清理、归档、导出、冻结和解冻都写入审计。策略必须限制最小/最大值，避免误配置造成无限增长或立即删除。
7. 自托管默认禁止日志、审计、Trace、客户端日志和 Support Bundle 日志证据外发。业务调用只有明确允许的文档、Provider、MCP 或企业连接器请求可以按各自授权外发；任何外发都不得携带日志字段或凭据。
8. 本次实施采用一次性替换。完成后必须扫描仓库中的 `new Logger`、`console.*`、`@affine/debug`、Electron logger、错误边界和第三方 exporter，输出已接入清单与明确保留的例外；例外也必须遵守脱敏和外发策略。

### 12.1 多副本和容量边界

- spool 目录必须位于持久卷；多副本部署时每个副本使用稳定 `node_id`，持久卷不能被多个副本无协调地共享写入。需要共享存储时使用带租约/原子追加语义的实现，默认按副本独立 spool 并由实例内 worker 汇聚。
- spool 批次使用原子临时文件 + rename、checksum、文件锁或租约；容器替换、滚动升级和异常退出后可恢复未完成批次。达到容量上限时优先丢弃可采样的低级运行日志，并记录 `log.spool.capacity_reached`；审计事件不得静默丢弃。
- PostgreSQL 日志表按时间分区并建立 `event_id`、`occurred_at`、关联 ID、severity、event name 和租户范围索引。写入器使用有界批量、背压和数据库连接超时；查询、导出和 metadata 均有行数/字节上限。
- retention worker 必须在删除前锁定分区或批次范围，支持 dry-run、法务留置和失败重试；清理期间产生的证据写入仍可查询。

## 13. 实施阶段

1. 统一 `LocalMindLogService`、事件 schema、脱敏器和 correlation context；
2. 新增 Prisma 模型、迁移、分区/索引和 spool 补写 Worker；
3. 接入 GraphQL、HTTP、WebSocket、队列、Worker、AI Runtime、MCP 和企业连接器；
4. 建立统一审计事件关联外壳，逐步接入关键业务域；
5. 增加 Admin Log Center、查询授权、导出和 retention 配置；
6. 接入 OpenTelemetry correlation，并完成私有部署默认关闭外部 Telemetry 的配置；
7. 使用 Linux 容器验证数据库故障、进程重启、队列重试、spool 补写、权限隔离、清理和导出。

## 14. 验收标准

- 不配置外部日志平台，单实例 Compose 启动后即可在 Admin 查看持久化日志；
- PostgreSQL 短暂不可用后，spool 能补写且不重复；
- HTTP、GraphQL、WebSocket、Job、Worker、AI Run 和 MCP 日志可以按关联 ID 串联；
- 关键审批、权限和副作用审计与业务状态事务一致；
- 日志查询遵守实例、Workspace、Project 和资源权限；
- 导出结果经过脱敏，导出行为本身可审计；
- 日志清理、归档、失败、重试和 ingestion degraded 均有持久证据；
- 不会把 Prompt、文档正文、附件、API key、MCP token 或 OAuth 凭据写入运行日志；
- stdout 丢失不会导致 LocalMind 日志真相丢失。
