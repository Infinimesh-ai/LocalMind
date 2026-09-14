# LocalMind 完整日志系统 Goal 指令

以下指令供后续启动实现任务使用。本文件本身不启动 goal，也不代替用户执行实现。

```text
请创建并执行一个 goal：一次性替换 LocalMind 全部日志入口，搭建公司自部署单实例内置的完整日志、业务审计、客户端汇聚、故障 spool、Admin 可观测性和保留管理系统。

先检查 git status 并保留所有已有用户改动。必须先读取 AGENTS.md，以及 docs/ai-modernization/README.md、branch-differences.md、document-map.md、current-state.md、next-goals.md、validation.md、相关 tracks 文档；同时读取以下本次设计与部署模型：
- docs/localmind-logging-system-design.zh-CN.md
- docs/localmind-enterprise-deployment-model.zh-CN.md
- docs/localmind-docker-development-constraints.md
- docs/localmind-mcp.md
- docs/localmind-deployment.zh-CN.md
- docs/localmind-deployment-ai.zh-CN.md

以上日志设计文档中的“已确认实施决策与补充约束”是本 goal 的产品契约。公司使用一个自部署 LocalMind 实例：Web、Electron、Android、iOS 和后端日志全部自动写入同一实例，无需手动上传；PostgreSQL 是日志真相源，stdout 仅作结构化兼容镜像。实例管理员可查看全部运行日志和业务审计。业务调用只有明确允许的文档、Provider、MCP 或企业连接器请求可以按其授权外发；日志、审计、Trace、客户端日志和 Support Bundle 日志证据默认永不外发。API key、Token、Cookie、Authorization、密码、OAuth/MCP 凭据、完整 Prompt、文档正文、附件及模型原始请求/响应禁止进入日志。

完成真正可运行的垂直切片，不停在设计、字段、脚手架、只读诊断值或 mock。实现细节按现有代码边界和 source-of-truth 文档保守决定，不重新讨论已经确认的产品选择。

必须实现：
1. 统一后端 `LocalMindLogService` 与结构化事件 schema。复用现有 logger、request/trace context、GraphQL plugin、OpenTelemetry correlation、队列 requestId 和领域审计模型；统一事件名、severity、status、关联 ID、actor/resource 上下文、错误码和 metadata 限制。所有写入入口先经过同一脱敏、截断和哈希层，禁止绕过写入器。
2. 新增 Prisma 日志模型及迁移（包括 `localmind_log_events`、必要的 audit envelope、event_id 唯一约束、时间分区/索引、retention class 和 ingestion 状态）。高风险审计写入与业务状态转移保持事务、幂等键、fingerprint、不可变证据和 fail-closed 语义；普通运行日志写入失败不能阻塞业务请求。
3. 实现 PostgreSQL 不可用时的本地持久化 spool 与补写 worker：持久卷、稳定 node_id、批次 checksum、原子 rename、文件锁/租约、轮转、重试和容量上限；恢复后按 event_id 幂等补写，进程崩溃、滚动升级和容器替换后可恢复。容量达到上限时按策略丢弃可采样低级运行日志并写入 `log.spool.capacity_reached`，审计不得静默丢弃；Admin 可查看 ingestion health、积压和失败原因。
4. 一次性接入全仓日志入口：Nest `Logger`/Winston、后端 `console.*`、`@affine/debug`、Electron logger、BlockSuite/common 共享代码、Web/Admin/mobile 错误边界、HTTP/GraphQL/WS、Redis、BullMQ worker、AI Runtime、MCP、Provider、企业连接器、启动/关闭和未捕获异常。保留必要的进程启动故障 stdout 镜像，但也要走脱敏和结构化格式。完成后用 `rg` 扫描并输出全部接入清单及有意例外清单，确认没有静默 `catch {}` 或 `.catch(console.error)` 遗留。
5. 实现客户端 transport：Web、Electron、Android、iOS 使用实例认证和受保护批量接口自动上传结构化日志；离线或网络失败时使用有界本地队列，恢复后幂等补写。Electron 可保留本地文件但不能要求人工上传。客户端不得信任自己提交的 actor/workspace/project 字段，服务端按会话和授权上下文重建；客户端日志默认不含文档正文、Prompt、凭据和完整网络 payload。
6. 实现统一查询/导出 API 和实例管理员 Admin 页面，入口建议 `/admin/observability/logs` 与 `/admin/observability/settings`。Log Center 支持时间、severity、service、component、event name、request/trace/workspace/project/run/job、状态、关键词和 error code 筛选，查看关联日志、审计和执行回执；NDJSON/CSV 导出有脱敏、行数/字节上限，导出动作本身审计。Settings 提供默认保留策略、采样、spool 容量、级别、法务留置/冻结和外部 Telemetry 开关，限制可配置范围并记录变更。所有异步界面覆盖 loading、empty、error、success、disabled、重复提交和权限拒绝。
7. 实现 retention/archive worker：运行日志默认 30 天，失败/安全/降级日志 90 天，Trace 14–30 天，普通业务审计 1 年，权限/审批/外部副作用审计 3–7 年；管理员可调整受限范围。支持 dry-run、分区/批次删除、归档、失败重试、法务留置和冻结/解冻；清理、归档、失败、重试和 ingestion degraded 均留下可查询日志及必要审计。
8. 自托管默认关闭 GA4、Sentry、OpenTelemetry exporter、官方 telemetry endpoint 等日志/行为外发路径。检查并修正 `packages/frontend/core/src/modules/telemetry/services/telemetry.ts`、`packages/frontend/core/src/modules/cloud/constant.ts`、`packages/common/nbstore/src/telemetry/manager.ts` 及所有 exporter/初始化分支：self-hosted 不能因 HTTP、WS 或稳定 channel 配置而外发。若保留未来可选外发，必须由实例管理员显式开启、展示目的地和字段范围，与内部日志隔离且失败不影响本地日志。
9. 统一关联传播：requestId、traceId/spanId、workspaceId、projectId、sessionId、runId/stepId、jobId、auditEventId 在 HTTP、GraphQL、WebSocket、Redis、队列、MCP、Provider 和企业连接器之间传播；支持 W3C traceparent 和现有 x-cloud-trace-context。Workspace/Project/actor 只能来自服务端授权结果。日志查询按实例管理员、Workspace/Project 资源权限执行，不能借日志页面越权读取文档正文或 Prompt。
10. 补充关键领域审计关联：登录/权限拒绝、审批、复制/发布、删除、取消、重试、外部副作用、AI run/step、MCP tool、Provider request、support bundle、配置修改和管理员导出/清理都要产生持久、幂等、不可变或可追溯证据；HTTP/GraphQL/WS/Job/Worker/AI/MCP 运行日志必须能按关联 ID 串联。

按设计文档的实施阶段推进并持续记录证据，但以全部验收标准通过作为完成标准。必须提供：后端模型/服务/worker/API、GraphQL schema 与生成物、客户端 transport、Admin UI、i18n/权限、Prisma 迁移和必要文档同步；不要手工伪造生成文件。

验证必须包括：
- `yarn prettier --ignore-unknown --check`、相关 oxlint/eslint、typecheck、git diff --check；
- 后端日志脱敏、event_id 幂等、审计事务、权限拒绝、查询过滤、导出上限、retention/freeze、spool 重启/损坏/容量/补写、数据库短暂不可用和并发写入聚焦测试；
- GraphQL/客户端/Admin 的 loading、empty、error、权限和重复提交测试；
- 全仓 `rg` 扫描 Logger、console、debug、异常边界和 exporter，并对每个结果分类；
- 空 PostgreSQL 数据库全量迁移，以及从当前真实备份恢复后的升级验证；
- Linux 容器内验证 Web/Electron（可用 transport 模拟）、worker、多副本 node_id、进程重启和日志查询；
- 明确证明 self-hosted 不向 GA4、Sentry、OpenTelemetry/官方 telemetry 或其他日志平台发出请求；
- 必要时使用真实浏览器检查 Admin 日志列表、详情、筛选、导出和设置页面的桌面/窄屏、浅色/深色主题。

遵守 docs/localmind-docker-development-constraints.md：优先复用 `localmind-affine:test`，运行时里程碑才使用 `localmind-affine:local`，不创建新 tag；重建前检查 `docker system df`，不得删除 volume、持久化服务数据或无关镜像。只有完成同平台 Linux 验证、数据库备份和所需同步后，才按仓库既有脚本同步运行环境；不要直接写生产表、手工复制容器文件或把 stdout 当真相源。

保留用户和其他任务已有改动。没有明确授权不要创建子代理、commit、push、创建 PR、远端发布或删除持久化数据。遇到问题继续推进并准确记录阻塞、例外和未验证项，不把计划或部分实现宣称为完成。

最终交付必须包含：改动文件和架构说明、日志入口全仓接入清单与有意例外、Prisma/GraphQL 迁移证据、脱敏和外发阻断证据、spool/幂等/多副本证据、权限与审计矩阵、Admin 浏览器证据、精确验证命令和结果、备份与升级记录、固定镜像和磁盘状态、运行地址、剩余风险。仅当整个实现和验收实际完成后才将 goal 标记为 complete。
```
