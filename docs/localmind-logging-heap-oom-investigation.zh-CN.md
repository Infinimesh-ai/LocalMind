# LocalMind 后端堆内存耗尽故障分析与修复方案

故障发生：2026-10-30。现场取证：2026-10-31、2026-11-01（只读）。本版重写：2026-11-01。时间均同时给出 UTC 与 America/Los_Angeles（下称 PT）。

状态：根因链已按源码、线上产物与本地实验核对。第 5.2—5.5 节中不依赖服务器决策的代码与部署配置修改已于 2026-11-01 在本地实施、通过聚焦测试并合入 `main`（附录 C）；尚未部署。线上服务已于 2026-10-31 23:20 PT 经用户授权重启恢复（附录 A），仍运行原实现，故障条件在部署前未消除。

本文面向负责 LocalMind 后端日志、前端权限请求和自托管部署的开发者。它保留前一版调查采集的全部现场证据，重新核对源码并补充本地实验，修正了部分归因和修复优先级。产品边界沿用[日志系统设计](localmind-logging-system-design.zh-CN.md)：PostgreSQL 是日志真相源，stdout 是兼容镜像，spool 是待补写证据；运行日志可按明确策略采样，业务审计不得静默丢弃。

## 1 结论摘要

服务不可用的直接原因已确认：Node.js 触发 V8 堆上限（`Reached heap limit … JavaScript heap out of memory`），进程停在异常退出路径，HTTP 不再响应，但容器未退出，`unless-stopped` 重启策略没有生效，服务中断约 43 小时直到人工重启。

内存耗尽不是单点缺陷，而是四级逐级放大：

```text
① 前端：资源列表把全部候选文档纳入权限订阅，每篇文档每 5 秒查询一次权限
     ↓ 峰值约 43 次/秒 getDocRolePermissions，占 GraphQL 请求 93.6%
② 后端日志：每个请求写 HTTP + GraphQL 两条日志，每条一个交互事务，与业务共用连接池
     ↓ 约 50 条/秒逐条事务；业务查询排队，权限查询中位耗时 1.8 秒
③ 数据库：千万行日志表、约 5 GB 随机键索引、shared_buffers 128 MiB、磁盘读等待约 80 ms；
   保留清理每小时扫描后失败，表只增不减
     ↓ 日志事务超时，大量写入转入 spool
④ spool 降级：每条失败日志做 3 次全目录 readdir + 逐文件 stat，全部挤在 4 线程 libuv 线程池
     ↓ 单次扫描耗时随“并发数 × 文件数”增长，扫描中的路径数组无法回收
   V8 堆耗尽
```

GC 本身没有失效：堆在故障期间多次大幅回落（第 2.5 节），说明这是短时间内“在途工作”无界堆积，而非永久泄漏。修复的关键是给每一级加上限，并优先削减第 ①②级的无效负载。

| 判断                                                          | 证据强度                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 后端因 V8 堆耗尽失去响应                                      | 已确认：GC 与 fatal 日志、HTTP 探针、原生调用栈                         |
| 资源列表从 2026-10-25 起对全部候选文档建立 5 秒轮询           | 已确认：源码、提交历史、线上 bundle                                     |
| 普通日志逐条交互事务、与业务共用 PrismaClient、入口无在途上限 | 已确认：线上 source map 与本地源码一致                                  |
| 日志写入是故障期数据库读 I/O 的主要来源                       | 已确认：`DataFileRead` 等待、读取块增量 99.8% 来自日志表                |
| 保留清理在本进程生命周期内七次失败，且每次先做大范围扫描      | 已确认：七条 Scheduler 错误与源码                                       |
| spool 容量检查的内存占用随“并发数 × 文件数”放大               | 已确认：线上实现与本地复现                                              |
| spool 扫描是 4 GB 堆的主要组成                                | 强推断：线上实测 157 秒扫描延迟反推出的保留量与故障堆同一量级；无堆快照 |
| stdout 镜像积压是主要组成                                     | 未确认：机制存在（第 3.5 节实验），但故障期 Docker 读取未见明显滞后     |
| 进程 OOM 后为何不退出                                         | 未查明：已排除“仅因 node 为 PID 1”的简单解释（第 3.6 节）               |
| 某一具体用户、标签页导致全部权限请求                          | 未确认：日志没有页面或会话关联字段                                      |

与前一版调查相比，本版的主要变化：

- 把前端轮询定位到具体提交和缺陷，并认定为首要流量源，而不只是“存在轮询实现”。
- 补充数据库层原因：随机 UUID 多索引写入、过小的 `shared_buffers`、服务端自生成 ID 的多余查重、清理失败导致表持续膨胀。
- 指出 spool 扫描与业务共享 libuv 线程池，影响面超出日志本身；并用线上延迟对内存量级做了闭环估算。
- 用实验确认 stdout 管道积压会进入 JS 堆，保留其为候选来源。
- 修复顺序调整为“先削减负载、再加上限、后改结构”，不采用“正常路径先落盘”的重型方案。

## 2 现场证据

### 2.1 时间线

| 事件                                 | UTC                  | PT                   |
| ------------------------------------ | -------------------- | -------------------- |
| 资源列表权限检查改动提交             | 10 月 26 日 04:18    | 10 月 25 日 21:18    |
| 最近一次成功的定时清理回执（启动前） | 10 月 30 日 02:05:17 | 10 月 29 日 19:05:17 |
| 故障进程启动                         | 10 月 30 日 03:24:32 | 10 月 29 日 20:24:32 |
| 第一轮清理报事务过期                 | 10 月 30 日 04:26:28 | 10 月 29 日 21:26:28 |
| 权限查询峰值分钟（2,565 次）         | 10 月 30 日 06:13    | 10 月 29 日 23:13    |
| 遗留 spool 最早事件                  | 10 月 30 日 10:44:04 | 10 月 30 日 03:44:04 |
| 遗留 spool 最新事件                  | 10 月 30 日 11:15:41 | 10 月 30 日 04:15:41 |
| OOM                                  | 10 月 30 日 11:21:12 | 10 月 30 日 04:21:12 |
| 人工重启恢复                         | 11 月 1 日 06:20:37  | 10 月 31 日 23:20:37 |

提交时间不等于线上部署时间；线上镜像 revision `63d6d43c7c` 包含该提交，部署时刻未取证。spool 时间取自文件内 `occurredAt`，只代表遗留文件的范围。

### 2.2 进程与容器状态（重启前）

- 容器 `localmind_affine_server` 运行中，重启计数 0，`OOMKilled=false`；主进程 `node ./dist/main.js`，RSS 约 5,145,584 KiB，持续占用约一个 CPU 核心。
- 回环请求 `http://127.0.0.1:3011/` 能建立连接，8 秒内无 HTTP 数据。PostgreSQL `pg_isready` 通过，Redis `PONG`。
- 主机磁盘使用约 35%，剩余约 1.2 TB；不是磁盘耗尽。
- 无 healthcheck、无内存硬上限、未设置 `NODE_OPTIONS`。镜像以 exec 形式 `CMD ["node", "./dist/main.js"]` 启动且无 init 进程，node 即容器 PID 1（spool 实际目录 `/tmp/localmind/logs/spool/1` 印证这一点）。
- 短时 GDB attach 得到的主线程栈包含 `abort`、`node::OOMErrorHandler`、`V8::FatalProcessOutOfMemory`、`Heap::CollectGarbage`，检查后已 detach。

崩溃前最后两次完整 GC：

```text
Mark-Compact 4037.2 -> 4030.2 MB，约 3638 ms
Mark-Compact 4045.9 -> 4038.8 MB，约 3439 ms
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

### 2.3 请求与日志构成

故障进程窗口（`03:24:36.640Z`—`11:21:12.486Z`）的 Docker 日志约 392.8 MB、962,324 行，按结构化事件统计：

| 结构化事件或 operation               |    数量 | 说明                                     |
| ------------------------------------ | ------: | ---------------------------------------- |
| `http.request.completed`             | 221,843 |                                          |
| `graphql.request.completed`          | 211,280 | 另有 18 条 `graphql.request.failed`      |
| ├ `getDocRolePermissions`            | 197,718 | 93.58%                                   |
| ├ `copilotWorkbenchConversationsGet` |   6,195 | 项目工作台三列会话，每 15 秒补偿刷新     |
| ├ `workspaceDirectory`               |   2,526 |                                          |
| ├ `copilotWorkbenchTaskPanelGet`     |   2,067 |                                          |
| └ `copilotWorkbenchProjectsGet`      |   2,065 |                                          |
| `logger.debug`                       |  58,726 | 主要是定时任务入队日志（第 3.2 节）      |
| `client.debug.affine:fetch`          |   9,782 | 客户端上传的 fetch 调试日志              |
| `POST /api/logs/batch`               |   9,660 | 客户端日志上传请求，本身也产生 HTTP 日志 |

按 `requestId` 关联，193,522 对 HTTP/GraphQL 完成日志属于权限查询，即至少 391,240 条（约 90.3%）完成日志由权限查询产生。权限查询按 `occurredAt` 的峰值为 06:13 的 2,565 次/分钟（约 42.8 次/秒），10:55、10:56 分别为 2,203、2,246 次；`durationMs` 中位数 1,792 ms、P95 10,036 ms、最大 18,209 ms。

另有 184,018 条 Nest `VERBOSE [job]` 文本行，来自任务执行器，不入库，但构成 stdout 负担。

### 2.4 数据库与 spool

崩溃前采样（来自[页面加载性能排查记录](localmind-page-loading-performance-investigation.zh-CN.md)，属故障期快照）：

- CPU I/O wait 约 60%—80%；`sda` 读平均等待约 79—80 ms、写约 36—38 ms，平均队列深度约 30。
- 144 个连接状态样本中 94 个是日志 SQL 等待 `DataFileRead`。
- 8.85 秒内读取块增量的 99.8% 来自 `localmind_log_events_2026` 与 `localmind_log_event_ids`，期间约 51 条/秒日志插入。
- `shared_buffers` 为 128 MiB（PostgreSQL 默认值）。
- 日志分区有 9 个索引；较大的有主键约 969 MB、事件名与时间约 834 MB、全局事件 ID 主键约 819 MB、event ID 约 814 MB。`EXPLAIN` 显示去重查询走索引，不是缺索引导致的全表扫描。

| 对象                        | 估计存活行 | 估计死行 | 表与索引大小 |
| --------------------------- | ---------: | -------: | -----------: |
| `localmind_log_events_2026` | 10,917,246 |  619,772 |     7,898 MB |
| `localmind_log_event_ids`   | 10,888,348 |  721,582 |     2,119 MB |

保留策略：运行日志 30 天、错误 90 天、审计 365 天，spool 上限 52,428,800 字节，未冻结、无法务留置。`LOCALMIND_LOG_SPOOL_DIR`、`LOCALMIND_DATA_DIR` 未设置。

遗留 spool：8,305 个 JSON 文件，正文共 4,329,519 字节（约 4.13 MiB，单文件 422—607 字节），全部 checksum 校验通过，无审计信封。其中 `log.ingestion.degraded` 4,031 个（reason 均为固定标签 `postgres_unavailable`，任何写库异常都会打这个标签）、HTTP 完成 2,151 个、GraphQL 完成 2,059 个（其中权限查询 2,024 个）。spool 正文只有数 MiB，4 GB 堆不是日志正文。

### 2.5 内存轨迹

`MonitorService` 每分钟记录的 `process.memoryUsage()`（共 476 条，单位 MiB）：

| UTC 10 月 30 日 | heapUsed |     RSS | external | 说明                    |
| --------------- | -------: | ------: | -------: | ----------------------- |
| 03:25           |    188.4 |   379.1 |      6.1 | 启动后                  |
| 05:30           |    191.5 |   724.3 |      7.3 | 权限查询高峰前          |
| 06:16           |    797.1 | 1,386.1 |     12.2 | 峰值分钟后短时上升      |
| 08:30           |    192.2 |   847.1 |      7.5 | 回落                    |
| 10:44           |    228.2 | 1,056.2 |      7.9 | 遗留 spool 最早事件附近 |
| 10:46           |    870.7 | 1,729.0 |     15.7 |                         |
| 10:47           |    341.5 | 1,719.7 |      8.7 |                         |
| 11:05           |  2,115.0 | 3,090.2 |     12.3 |                         |
| 11:09           |    225.4 | 3,613.5 |      8.8 | 堆大幅回落，RSS 未回落  |
| 11:15           |  2,451.1 | 3,653.8 |     11.3 |                         |
| 11:18           |  3,023.9 | 4,450.0 |     16.5 | 分钟采样最高值          |
| 11:20           |  2,771.5 | 4,449.9 |     12.0 | 最后一条采样            |
| 11:21:12        | 约 4,039 |       — |        — | V8 日志，最后一次 GC 后 |

external 全程最高约 24.2 MiB，说明 Buffer 正文不是主体。堆多次从 2 GiB 以上回落到 200 多 MiB，说明对象最终可回收，故障是“在途工作在数分钟内堆积到超过堆上限”。06:13 的流量峰值本身没有导致崩溃，崩溃发生在 10:44 之后日志开始持续降级落盘的阶段。

### 2.6 一条日志的实际耗时

通过 spool 文件名毫秒时间戳、归档 mtime 与 requestId 关联出 1,899 对原始/降级文件。其中一条权限查询完成日志：

| 节点                               | UTC          |     间隔 |
| ---------------------------------- | ------------ | -------: |
| `buildRecord()` 生成事件           | 11:13:44.307 |        — |
| 原始记录文件命名（写入并 rename）  | 11:16:17.501 | 153.2 秒 |
| 降级记录文件命名                   | 11:18:54.429 | 156.9 秒 |
| 同一 event ID 出现在 Docker stdout | 11:18:54.514 | 0.085 秒 |

后 156.9 秒没有任何数据库调用，只有一次 `append()`：一次全目录扫描加一次写文件与 rename。也就是说，故障末期单次 spool 扫描耗时约 2.5 分钟。最后一行的 0.085 秒说明 Docker 此时在及时读取 stdout。遗留的 2,059 条 GraphQL 记录中，从事件生成到原始文件命名的中位数约 40 秒、P95 约 253 秒（遗留文件有幸存者偏差）。

## 3 故障链逐级分析

### 3.1 第一级：资源列表把全部候选文档纳入 5 秒权限轮询

[GuardService](../packages/frontend/core/src/modules/permissions/services/guard.ts) 的机制：

- 任何 `can$('Doc_*', docId)` 订阅都会把 docId 加入 `observedDocs`。
- 非本地工作区每 5 秒对 `observedDocs` 中每篇文档发一次 `getDocRolePermissions`；窗口 `focus`、`online` 时再全量刷新一次。没有页面可见性判断，后台标签页照常轮询。
- 同一文档的定时刷新用 `exhaustMap` 防止重入，但不同文档之间没有总并发上限；失败使用 `backoffRetry({ count: Infinity })` 无限重试。
- `readableDocIds$()` 先用 `can()` 以 4 路并发逐篇检查，再对检查过的全部文档建立 `can$` 订阅。`can()` 直接调用 `loadDocPermission`，不经过 `exhaustMap` 去重。

提交 `f4a00b882a`（2026-10-25）在 [resource-explorer.tsx](../packages/frontend/core/src/components/native-files/resource-explorer.tsx) 中加入：

```ts
const readableDocs = useLiveData(useMemo(() => LiveData.from(guard.readableDocIds$(trash ? [] : docGroups.flatMap(group => group.items)), new Set<string>()), [guard, docGroups, trash]));
```

由此产生两个缺陷：

1. **轮询范围是全部候选文档，不是屏幕上可见的行。** 全部资源页一挂载，列表里的每篇文档都进入 5 秒轮询。42.8 次/秒相当于单个标签页约 214 篇文档；多个标签页或多名用户会线性叠加。
2. **列表数据每变一次就全量重查。** `useMemo` 依赖 `docGroups` 数组本身；文档元数据同步、排序、筛选等任何引起新数组的变化，都会重建 `readableDocIds$`，用 4 路并发重新检查全部文档，并重建全部订阅。

故障窗口内有 5 次 `GET /workspace/:id/all`（10:46—10:50 UTC）和对应 bundle 的加载记录，与权限查询高峰相符；侧栏文档节点、搜索与快速搜索也走同一权限链，因此不能把全部请求都归给该页面。项目工作台的 [ProjectRealtimeStore](../packages/frontend/core/src/modules/project-resources/realtime-store.ts) 每 15 秒刷新三列会话、项目列表和任务面板，04:30—04:34 每分钟稳定为 12:4:4 次，是次要的持续来源。

服务端对每次文档读写都实时检查 ACL，前端轮询只决定界面上的权限提示。降低列表行的刷新频率不会削弱服务端授权。

### 3.2 第二级：日志逐条事务且与业务共用连接池

[server.ts](../packages/backend/server/src/server.ts) 注册的 sink 对每个事件立即发起写入：

```ts
LocalMindLogService.registerSink(input => {
  void localMindLogs.write(input).catch(() => undefined);
});
```

[LocalMindLogService.write()](../packages/backend/server/src/base/logger/localmind-log-service.ts) 对一条记录调用 `persist()`：一个 Prisma 交互事务，依次执行 BEGIN、按 event ID 获取 advisory lock、在 4 个日志分区与归档表中查重、插入（触发器再写全局 ID 登记表）、COMMIT，至少 5 次数据库往返，期间独占一个连接。失败（包括等不到连接、事务超时）一律转入 `spoolRuntime()`。入口没有在途数量、字节或时间上限。

放大因素：

- **双层完成日志。** [timing.ts](../packages/backend/server/src/middleware/timing.ts) 在每个 HTTP 响应结束时写 `http.request.completed`，[logger-plugin.ts](../packages/backend/server/src/base/graphql/logger-plugin.ts) 再写 `graphql.request.completed`。一次权限查询对应两次事务。HTTP 日志记录的是 `req.path`，挂载点下的 GraphQL 请求显示为 `/`，无法区分来源。
- **debug 不受日志级别控制。** [AFFiNELogger.debug()](../packages/backend/server/src/base/logger/service.ts) 先 `emit` 入库，再交给 `ConsoleLogger` 判断级别；Nest 的 `Logger` 包装层不做级别判断。因此 [JobQueue.add()](../packages/backend/server/src/base/job/queue/queue.ts) 每次入队的 debug 都会入库：`notification.projectRealtime` 每秒一次（28,536 条），工单与通知任务每 5 秒各一次（约 5,710 条/种）。
- **日志上传自我放大。** 客户端每次 `POST /api/logs/batch` 都会产生一条服务端 HTTP 完成日志；客户端还会上传每次 fetch 的调试日志。

[PrismaFactory](../packages/backend/server/src/base/prisma/factory.ts) 只有一个全局 PrismaClient，日志事务与业务查询共用连接池。约 50 条/秒的逐条事务长期占用连接，业务查询需要排队；权限查询中位耗时 1.8 秒与此吻合，但未单独测量排队时间。业务变慢又让更多请求同时在途。

### 3.3 第三级：数据库写放大与保留清理失效

**每条日志的写入成本随表规模上升。** 日志分区的主键 `id`、`event_id`、`request_id` 索引和全局登记表主键都以随机 UUID 为键。每插入一行要在多个大索引中定位随机页，查重再探查 4 个分区和归档表。约 5 GB 的日志索引远大于 128 MiB 的 `shared_buffers`，这些随机页大多需要从约 80 ms 读等待的磁盘读取，这就是 `DataFileRead` 等待集中在日志 SQL 的原因。

**服务端自生成 ID 的查重是多余的。** `write()` 的 event ID 来自服务端 `randomUUID()`，首次写入不可能重复，advisory lock 与查重只对客户端提交的批次和 spool 回放有意义；全局登记表的触发器已能兜底拒绝重复。

**清理每小时制造一次 I/O 尖峰，却从不删除。** [cleanupRetention()](../packages/backend/server/src/base/logger/localmind-log-service.ts) 在单个默认 5 秒预算的交互事务里先取 advisory lock，再对过期条件做精确 `count()`，然后 `deleteMany()`：

| 错误日志 UTC | 到达 `deleteMany()` 时事务已持续 |
| ------------ | -------------------------------: |
| 04:26:28     |                       112,239 ms |
| 05:25:23     |                        47,410 ms |
| 06:26:14     |                        98,187 ms |
| 07:26:18     |                       102,169 ms |
| 08:25:30     |                        54,352 ms |
| 09:25:04     |                        28,287 ms |
| 10:24:55     |                        18,854 ms |

`count()` 需要逐行判断 `retention_class` 和 `severity`，无论走时间索引回表还是顺序扫描分区，都要读取大量过期行（具体行数未取证），耗时数十秒到近两分钟；事务早已过期，`deleteMany()` 被 Prisma 拒绝，一行都没删。每小时一次的大范围回表扫描与写入争抢同一块磁盘和缓存，而表因从不收缩，下一轮更慢。`scheduledRetentionCleanup()` 在 `try` 外调用清理，失败只留下 Scheduler 错误，没有持久的失败状态。

现有分区按年划分（[迁移](../packages/backend/server/migrations/20260913013000_localmind_log_partitions/migration.sql)），30 天窗口位于单个年分区内部，无法通过删除分区清理；混合保留等级与全局 ID 登记表也使直接 DROP 分区不可行。

### 3.4 第四级：spool 降级路径的“并发数 × 文件数”放大

[spool.ts](../packages/backend/server/src/base/logger/spool.ts) 的容量统计：

```ts
async list() {
  await mkdir(this.directory, { recursive: true, mode: 0o700 });
  return (await readdir(this.directory))
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => join(this.directory, name));
}

async bytes() {
  let total = 0;
  for (const file of await this.list()) total += (await stat(file)).size;
  return total;
}
```

一条非关键日志进入 `spoolRuntime()` 后会执行 3 次 `bytes()`：预检查一次，`append(record)` 内一次，`append(log.ingestion.degraded)` 内再一次；并写出两个文件。每次 `bytes()` 都新建完整路径数组，然后逐个 `await stat()`，数组在遍历结束前一直存活。

问题不只在内存：

- `fs.promises` 的 `readdir`、`stat`、`writeFile`、`rename` 都在 libuv 线程池中执行，默认只有 4 个线程，仓库未设置 `UV_THREADPOOL_SIZE`。K 个并发扫描各需 F 次 stat，单次扫描的完成时间约为 K × F ÷ 线程池吞吐。文件数和在途数同时上升，扫描时间按二者乘积增长，保留的数组数量也随之增长，形成正反馈。
- 同一线程池还承担本地文件存储读写、`dns.lookup`（包括出站访问模型服务时的域名解析）、zlib 和部分 crypto 操作。扫描挤占线程池时，这些与日志无关的业务也会排队。这一影响由机制推出，未在线上单独测量。

**量级估算。** 本地复现（第 4.1 节）中，64 路扫描 8,305 个文件共 53 万次 stat 用时 10.8 秒，约 4.9 万次/秒；GC 后每路约保留 2.9 MiB。线上末期单次扫描约 157 秒（第 2.6 节），反推并发扫描数约 157 × 49,000 ÷ 8,305 ≈ 930 路，对应保留约 2.6 GiB，与故障堆处于同一量级。该估算基于 arm64 本地吞吐和近似文件数，只证明“该机制足以解释数 GB 堆”，不能给出各类对象的准确占比。

补写也受同一问题影响：`flushSpool()` 每 15 秒先列出完整目录再取前 100 个，逐条单独事务写回，理论上限约 6.7 条/秒，远低于故障期新增速度。

### 3.5 stdout 镜像可能积压在 JS 堆中

`mirror()` 用 `process.stdout.write()` 输出每条已持久化或已落盘的记录，忽略返回值。本地实验（第 4.2 节）表明：容器内 stdout 是管道，读取方停顿时 Node 不会阻塞写入，而是在内存中排队；排队的是 JS 字符串，计入 `heapUsed` 而非 `external`。写入 10 万条不同的约 500 字节记录，排队约 49 MiB，GC 后堆增加约 60 MiB。

因此不能用 external 较低来排除 stdout 积压。不过第 2.6 节显示故障末期 Docker 读取延迟只有 85 ms，现有证据不支持 stdout 是主要来源；它是必须加上限的次要风险。

### 3.6 进程 OOM 后为何没有退出（未查明）

Docker 重启策略只在进程退出后生效，本次进程停在 `abort` 路径且占用一个核心，导致中断约 43 小时。node 作为 PID 1 时，内核会忽略它发给自己的默认处理信号（包括 `abort()` 的 SIGABRT），这是一个自然的怀疑方向。本地实验（第 4.3 节）结果：

| 条件                                   | 结果                  |
| -------------------------------------- | --------------------- |
| node 为 PID 1，纯 JS OOM               | 退出码 133（SIGTRAP） |
| `--init`，纯 JS OOM                    | 退出码 134（SIGABRT） |
| node 为 PID 1，已加载 Prisma 与 native | 退出码 133            |
| `--init`，已加载 Prisma 与 native      | 退出码 134            |

PID 1 改变了退出路径（SIGABRT 被忽略后由 glibc 兜底指令终止），但四种情况都正常退出，没有复现卡住。本地是 arm64，线上 glibc 的兜底指令和信号行为可能不同；线上 core 路由为 Apport 管道，5 GB 进程的 core 转储也可能阻塞退出。这两点都需要在 x64、相同内核配置下复现。无论原因如何，都不能依赖进程自行退出来恢复。

### 3.7 其他已确认缺陷

以下问题未证明是本次 OOM 的原因，修复时一并处理：

| 位置                     | 缺陷                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `archiveRetention()`     | 运行日志一律按 30 天归档，未区分 error/fatal 的 90 天保留期，错误日志会提前移出在线范围               |
| spool 目录               | 默认位于容器 `/tmp`，未挂载持久卷，替换容器会丢失；目录名用进程 PID，非容器部署重启后旧目录不会被补写 |
| `append()` 容量检查      | 检查与写入之间没有预留，并发调用可同时通过；`.tmp` 文件不计入容量                                     |
| `bytes()` 与补写删除并发 | 列举后文件被补写删除时 `stat` 抛错，可能导致原日志落盘失败                                            |
| spool 补写锁             | 60 秒按目录 mtime 判定过期，长任务不续租，释放时不校验所有者                                          |
| 降级记录                 | 每条失败日志额外写一个降级文件，故障越严重文件越多                                                    |
| 输入大小                 | 脱敏有字符串、深度、键数限制，但没有单条事件序列化总字节上限                                          |

## 4 本地实验

所有实验都在本地一次性容器或现有开发容器的独立子进程中运行，不连接线上，不导入 AppModule，未重建或新增镜像 tag，实验容器和临时目录已删除。

### 4.1 spool 容量检查的内存放大

条件：容器 `localmind_hot_backend`（`localmind-affine:dev-base`，Node v22.23.3；线上为 v22.22.3），用 `transpileModule` 加载与线上 hash 一致的 `spool.ts`，在随机临时目录创建 8,305 个 521 字节文件，分别以 1、32、64 路并发调用 `bytes()`；每 20 ms 采样 `heapUsed`，每 300 ms 强制 GC 后采样。

| 并发 |      耗时 | 起始堆 MiB | 采样峰值 MiB | 运行中 GC 后最大 MiB | 结束 GC 后 MiB |
| ---- | --------: | ---------: | -----------: | -------------------: | -------------: |
| 1    |    387 ms |       22.5 |         30.5 |                 24.5 |           22.5 |
| 32   |  3,886 ms |       22.5 |        133.6 |                115.8 |           22.6 |
| 64   | 10,823 ms |       22.6 |        216.8 |                206.6 |           20.0 |

结论：GC 后仍保留的内存与并发数近似成正比，结束后完全回落，属于在途工作保留而非泄漏。

复现命令（只在本地 Linux 开发容器运行；若超时或 OOM，只清理本次创建的 `localmind-heap-spool-probe-*` 目录）：

```sh
docker exec -i localmind_hot_backend \
  timeout 50s node --expose-gc --max-old-space-size=256 --input-type=module <<'JS'
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire('/workspace/package.json');
const ts = require('typescript');
const source = await fs.readFile(
  '/workspace/packages/backend/server/src/base/logger/spool.ts', 'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { LocalMindLogSpool } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
const dir = await fs.mkdtemp(join(tmpdir(), 'localmind-heap-spool-probe-'));
const spool = new LocalMindLogSpool(dir);
const MiB = 1024 * 1024;

try {
  for (let offset = 0; offset < 8305; offset += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 8305 - offset) }, () =>
      fs.writeFile(join(dir, Date.now() + '-' + randomUUID() + '.json'), 'x'.repeat(521))
    ));
  }
  for (const concurrency of [1, 32, 64]) {
    global.gc();
    const base = process.memoryUsage().heapUsed;
    let peak = base;
    let retainedPeak = base;
    const started = Date.now();
    const sample = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 20);
    const retained = setInterval(() => {
      global.gc();
      retainedPeak = Math.max(retainedPeak, process.memoryUsage().heapUsed);
    }, 300);
    try {
      const values = await Promise.all(
        Array.from({ length: concurrency }, () => spool.bytes())
      );
      clearInterval(sample);
      clearInterval(retained);
      global.gc();
      console.log(JSON.stringify({
        concurrency, completed: values.length, elapsedMs: Date.now() - started,
        baseHeapMiB: +(base / MiB).toFixed(1),
        peakHeapMiB: +(peak / MiB).toFixed(1),
        peakAfterGcMiB: +(retainedPeak / MiB).toFixed(1),
        endAfterGcMiB: +(process.memoryUsage().heapUsed / MiB).toFixed(1),
        allSizesEqual: values.every(n => n === 8305 * 521)
      }));
    } finally {
      clearInterval(sample);
      clearInterval(retained);
    }
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
JS
```

### 4.2 stdout 管道积压的位置

在开发容器内把 node 的 stdout 接到 3 秒后才开始读取的管道，同步写入 10 万条不同的 JSON 字符串（每条约 500 字节），强制 GC 后测量：

```sh
docker exec localmind_hot_backend sh -c 'node --expose-gc -e "const M=1048576;gc();const b=process.memoryUsage();for(let i=0;i<100000;i++)process.stdout.write(JSON.stringify({i,x:\"y\".repeat(500)})+\"\\n\");gc();const a=process.memoryUsage();process.stderr.write(JSON.stringify({queuedMiB:(process.stdout.writableLength/M).toFixed(1),heapDeltaMiB:((a.heapUsed-b.heapUsed)/M).toFixed(1),externalDeltaMiB:((a.external-b.external)/M).toFixed(1)})+\"\\n\");process.exit(0)" | (sleep 3; cat >/dev/null)'
```

结果：`writableLength` 约 49.4 MiB，`heapUsed` 增加约 59.6 MiB，`external` 无变化。管道写入在读取方停顿时会无界排队，且占用 JS 堆。

### 4.3 PID 1 下的 OOM 退出

以 `localmind-affine:dev-base` 分别运行 `node --max-old-space-size=32|48` 的持续分配脚本，比较不加与加 `--init` 两种方式；第二组额外加载 Prisma Client（连接不可达地址）与 `server-native.node` 后再分配。结果见第 3.6 节表格。本地为 arm64 Docker Desktop，不能代表线上 x64 主机。

## 5 修复方案

### 5.1 原则

1. **先削减无效负载，再加上限，最后改结构。** 第 ①②级产生了约 90% 的日志，削减它们成本最低、收益最大；但上限必须独立存在，不能依赖流量永远正常。
2. **每个环节都有上限：** 准入数量与字节、在途写入、spool 文件数与字节、补写速率、stdout 排队、清理批次与时长。超限时的行为必须事先定义并可观测。
3. **运行日志与审计分开。** 运行日志按策略采样或丢弃，并留下有界的丢弃计数；`writeAudit()` 保持现有“写入失败即落 spool 并向调用方报错”的语义，不进入运行日志的丢弃路径。
4. **不削弱授权。** 前端只调整界面权限提示的刷新范围和频率；服务端对每次读写的实时 ACL 检查不变，不扩大权限缓存，不混用不同 Project 与 Workspace 的授权结果。

### 5.2 P0：止血

| #   | 修改                                                                                                                                                                                                                     | 位置                                         | 预期效果                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------- |
| 1   | 资源列表只用一次性检查过滤可读文档，不把全部候选转为持续订阅；只有已渲染的行和已打开的文档建立 `can$` 订阅。`useMemo` 改为按排序后的 ID 集合判断是否变化                                                                 | `resource-explorer.tsx`、`guard.ts`          | 轮询数从“全部候选”降到“屏幕可见行”            |
| 2   | `GuardService` 轮询：页面不可见时暂停、恢复可见时刷新一次；当前打开的文档保持 5 秒，列表行改为 30—60 秒；所有文档权限请求共享全局并发上限（如 4）；`can()` 与定时刷新按 docId 合并在途请求；失败重试设次数上限           | `guard.ts`                                   | 后台标签页零请求，突发请求有界                |
| 3   | HTTP 完成日志对成功的 `/graphql` 请求和 `/api/logs/batch` 不再入库（由 GraphQL 日志覆盖，失败与慢请求保留）；路径改用挂载前的原始路径，不含查询参数                                                                      | `timing.ts`                                  | 去掉一半请求日志                              |
| 4   | 成功且不慢的 GraphQL 完成日志按 operation 每分钟汇总为一条（次数、P50/P95/最大耗时），失败与慢请求逐条保留                                                                                                               | `logger-plugin.ts`                           | 高频成功请求从逐条变为每分钟每 operation 一条 |
| 5   | `debug`、`verbose` 默认不入库，需显式配置开启；去掉定时任务每次入队的 debug，改为异常时记录                                                                                                                              | `base/logger/service.ts`、`base/job/queue/*` | 去掉约 6 万条/8 小时的 debug 行               |
| 6   | spool 改为启动时扫描一次，此后在内存维护已提交字节数、文件数与在途预留；`append()` 不再扫描目录。补写用 `opendir` 流式读取前 N 个文件，不再列出整个目录                                                                  | `spool.ts`、`flushSpool()`                   | 单条降级成本与积压规模无关，不再挤占线程池    |
| 7   | 去掉逐条 `log.ingestion.degraded` 文件，改为进入降级、恢复时各记一条，期间按时间窗口记录失败与丢弃计数                                                                                                                   | `spoolRuntime()`                             | spool 文件数减半，降级报告本身有界            |
| 8   | 入口准入：维护全局在途记录数和字节数（起点如 1,000 条、4 MiB）；超限时 info/debug 运行日志直接丢弃并计数，error/fatal 仍尝试落盘。写库连续失败或超时达到阈值时熔断，熔断期间运行日志直接落 spool，按退避间隔放行单个探测 | `LocalMindLogService.write()`                | 数据库再慢，内存与在途任务也有固定上限        |
| 9   | stdout 镜像检查 `writableLength`，超过上限（如 8 MiB）时停止镜像并计数，恢复后输出一条汇总                                                                                                                               | `mirror()`                                   | 堆中 stdout 排队有界                          |

第 1、2 项是前端改动，第 3—9 项是后端改动，两组可以分别发布和回滚。第 8 项是唯一真正的内存兜底，即使其他各项暂缓也应先做。第 3—5 项改变了逐条入库的范围（例如成功请求不再能按 requestId 逐条查询），实施时需同步更新[日志系统设计](localmind-logging-system-design.zh-CN.md)中的运行日志采样策略。

### 5.3 P1：写入路径与清理重构

1. **内存小批量写库。** 准入后的运行日志进入有界内存队列，每 200 ms 或 100 条或 256 KiB 合成一批，复用 `persistRuntimeBatch()` 写入，同时最多 1 个批次在途。客户端 `writeBatch()` 与 spool 补写走同一调度器。普通 `emit()` 不承诺持久化；客户端批量接口只对已提交数据库或已写入 spool 的 event ID 返回 accepted。
2. **服务端自生成 ID 跳过查重。** 记录区分“服务端首次生成”和“客户端提交或回放”；前者直接插入，由全局登记表触发器兜底，后者保留 advisory lock 与查重。
3. **日志使用独立的小连接池。** 单独的 PrismaClient，`connection_limit` 设为 1—2，与业务池隔离。独立连接池不能隔离磁盘，因此批次速率仍受第 1 项约束。
4. **保留清理改为分批推进。** 去掉执行路径上的 `count()`；每批按 `occurred_at` 范围选出至多数千行主键并删除，单独事务、单独提交，批大小根据实测耗时自动缩小；用 `pg_try_advisory_lock` 抢占，抢不到就跳过本轮；每轮设总行数和总时长上限；持久保存进度、最近成功、最近失败与下次重试时间；批次之间重新检查冻结与留置状态。dry-run 若需要精确总数，单独执行并限时。
5. **首次积压清理单独执行。** 线上当前积压的过期行可能达数百万，第一次清理应在低峰期手动触发并观察 I/O，完成后由定时任务维持。删除后的空间由 autovacuum 复用，不执行 `VACUUM FULL`。
6. **修正 `archiveRetention()`** 与 `cleanupRetention()` 使用相同的保留分类，error/fatal 按 90 天处理。
7. **索引审查。** 用 `pg_stat_user_indexes.idx_scan` 统计日志分区各索引的实际使用次数，对照管理端日志查询的条件，移除确实未被使用的索引（通过迁移），减少每行写入成本。

### 5.4 P2：部署与运维

1. **调整 PostgreSQL 内存。** `shared_buffers` 从默认 128 MiB 提高到主机内存的约 25%，并相应设置 `effective_cache_size`；需要重启数据库，应安排维护窗口。
2. **spool 持久卷。** 在 Compose 中为后端挂载持久卷并设置 `LOCALMIND_LOG_SPOOL_DIR`，目录标识改为稳定的节点 ID，不用进程 PID。切换前先完整保留并校验现有 spool 文件。
3. **进程退出与恢复。** 容器加 `init: true`，使 node 不再是 PID 1；Node 启动参数加 `--report-on-fatalerror --report-directory=<持久卷>`，下次故障可留下 JS 栈、各堆空间大小与 libuv 句柄数；增加短超时的应用存活检查，由外部看门狗在连续失败后重启容器，设置冷却时间与次数上限。存活检查（事件循环能否响应）与就绪检查（业务数据库是否可用）分开，避免数据库短暂变慢时反复重启。
4. **明确资源上限。** 设置 `--max-old-space-size` 与容器内存上限，二者之间留出余量给 native 与 RSS，使故障表现可预测；这只能缩短失败时间，不能替代第 5.2 节的上限。
5. **Docker 日志轮转。** 若 json-file 驱动未配置 `max-size`、`max-file`，应补充配置。故障进程 8 小时产生约 393 MB 容器日志。

### 5.5 P3：后续优化

- 批量权限查询接口（单次上限如 100 篇，逐篇实时授权），或基于现有实时通道推送撤权事件，进一步取代列表轮询。需同步 GraphQL schema、operation 与全部消费者。
- 日志表按月分区，并按保留等级拆分，使过期运行日志可以按分区移除；需要同步设计全局 ID 登记、归档去重、未来分区预创建和默认分区中的旧数据迁移。
- 请求来源关联：在请求入口记录规范化路由和有限枚举的客户端来源（资源列表、侧栏、搜索等），不记录 GraphQL variables、文档内容或凭据，不用 request ID 或文档 ID 做指标标签。
- 日志健康指标：在途数与字节数、批次耗时、spool 文件数与字节数、最老积压年龄、补写速率、丢弃计数与原因、清理进度。读取这些指标不能依赖写入同一张日志表。

### 5.6 不采用或不能单独采用的做法

| 做法                                  | 原因                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 正常路径先写 spool 批文件再入库       | 运行日志允许采样，没有必要承担先落盘的成本；当前瓶颈正是磁盘，先落盘会再增加一倍写入。spool 只作为熔断和失败时的缓冲 |
| 只调大 `--max-old-space-size`         | 只推迟 OOM，增长没有上限，GC 停顿更长                                                                                |
| 定时 `global.gc()`                    | 在途对象仍可达，GC 释放不了，实验已证明                                                                              |
| 只加 `UV_THREADPOOL_SIZE`             | 只是把 K × F 的放大往后推，扫描工作量本身不变                                                                        |
| 只限制执行并发、等待队列不设限        | 等待中的闭包和记录照样累积                                                                                           |
| 只放大 spool 容量                     | 目录更大，旧实现的每次扫描更慢                                                                                       |
| 只加 Prisma 超时或连接数              | 长事务更多，与业务争抢磁盘更严重                                                                                     |
| 把日志移到 worker thread 或换 logger  | 线程间队列和下游写入仍然无界，也得不到 LocalMind 的审计与幂等语义                                                    |
| 删除 spool、TRUNCATE 日志表、关闭审计 | 破坏证据与审计契约                                                                                                   |
| 立即 `VACUUM FULL` 或删除年分区       | 长时间锁表、额外磁盘占用和数据保留风险                                                                               |
| 取消前端权限刷新                      | 界面会长时间显示已撤销的权限；应缩小范围、降低频率，而不是取消                                                       |

## 6 验收

修复后至少验证以下场景，内存类验收同时记录准入队列计数、`heapUsed`、GC 后保留量、RSS、external、事件循环延迟与最老任务年龄：

| 场景                                       | 必须满足                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 全部资源页挂载 200 篇以上文档、单标签页    | 稳定状态权限请求数与可见行数相关，与候选总数无关；标签页隐藏后为零；撤权后打开的文档在 5 秒内反映 |
| 列表数据频繁变化                           | 不触发全量重查，权限请求并发不超过上限                                                            |
| 约 43 次/秒权限请求的持续负载，至少 8 小时 | 日志入库行数较修复前下降一个数量级，堆在固定范围内波动，业务延迟无退化                            |
| 数据库变慢但未断开                         | 熔断在业务连接被占满前生效，运行日志按策略落盘或丢弃并有计数                                      |
| 数据库不可用 30 分钟                       | 内存不随时间增长，spool 不超过上限，审计写入明确失败，恢复后补写速度高于新增速度                  |
| 1 万个以上遗留 spool 文件                  | 单条追加耗时与文件数无关；启动恢复扫描一次完成；可读取旧格式文件                                  |
| stdout 读取方停顿                          | `writableLength` 不超过上限，有停止镜像的计数，不影响持久化结果                                   |
| 并发追加与补写删除、磁盘满、权限错误       | 容量计数正确，未落盘的事件不返回 accepted，删除不导致静默丢失                                     |
| 千万行合成日志、含数百万过期行             | 清理每批在预算内提交并持续推进；冻结在下一批前生效；全局登记表与归档关联正确                      |
| error/fatal 日志                           | 归档与清理都按 90 天保留                                                                          |
| OOM 注入（x64，生产镜像，`init: true`）    | 进程在秒级退出并被重启；生成 fatal 诊断报告                                                       |

## 7 未决问题与下次取证

1. **4 GB 堆的逐对象构成。** 原进程已结束，未找到 heap snapshot 或 core，只能给出机制和量级。应在隔离 Linux 环境用第 3 节的负载复现，采集堆快照，按构造器、数量、retained size 与引用链分析。不要在接近堆上限的线上进程上临时生成快照。
2. **进程不退出的原因。** 在 x64、与线上相同的 glibc、内核和 Apport 配置下，用生产镜像复现 OOM；分别测试 PID 1 与 `--init`、有无 core 转储。
3. **10:44 前后触发持续降级的事件。** 遗留 spool 从 10:44 开始，此前的降级文件可能已被补写删除。需要查找该时段数据库侧的慢查询或锁等待记录，判断是否与清理、autovacuum 或磁盘有关。
4. **权限请求的客户端构成。** 当前日志无法区分用户、标签页和页面；第 5.5 节的来源关联上线前，只能按机制推断。
5. **线程池挤占对业务的实际影响。** 需在复现环境同时测量文件存储读写和出站 DNS 解析的延迟。

## 附录 A 临时恢复记录

2026-10-31 用户要求先恢复服务。重启前确认原进程 PID 2931487 仍在、回环 HTTP 5 秒超时、磁盘约 1.2 TB 可用，随后在服务器创建仅当前用户可读的备份目录：

```text
/home/localmind/incident-backups/heap-oom-recovery-20261101T062007Z
```

其中保存容器状态摘要、最后 4,000 行带时间戳日志及 `log-spool-before-restart.tar.gz`。压缩包含全部 8,305 个 JSON 文件（原始 4,329,519 字节，压缩后 1,266,058 字节），SHA-256：

```text
cf9dfc810edd467539f715ae748490440df008a3ef94c4f0b7d27d06b1188b8c
```

执行（`--time` 已弃用，今后用 `--timeout`）：

```sh
ssh localmind 'docker restart --time 20 localmind_affine_server'
```

容器于 `2026-11-01T06:20:37.914Z` 启动，沿用原容器、挂载与镜像，未做 Compose 重建、迁移或镜像构建，未删除数据库日志、spool、Redis 或业务文件。

| 检查                              | 结果                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| 公网首页                          | HTTP 200，约 591 ms                                          |
| 回环与公网 GraphQL `serverConfig` | HTTP 200，约 314 ms／200 ms，无 GraphQL errors               |
| 容器内存                          | 544.1 MiB（故障时约 5.017 GiB），后两次采样 457.9、491.5 MiB |
| 主机可用内存                      | 约 9.4 GiB（重启前约 4.7 GiB）                               |
| spool 补写                        | 文件数 8,305 → 8,156 → 8,005 → 7,877（间隔约 20 秒）         |
| 启动后日志                        | 无新的 heap out of memory；有个别 HTTP 错误                  |

这只证明服务入口恢复、旧积压在消费，不代表缺陷已修复。2026-11-01 只读复查时新进程 PID 1972844，RSS 约 870 MiB。

## 附录 B 产物核对与取证边界

线上镜像角色 `localmind-affine:local`，镜像 ID `sha256:6a9bfb5e9b35f0178c9975e9d9ee59a00e724dc94fd4d387b2667ddc56ecb6cf`，revision label 与线上仓库 HEAD 均为 `63d6d43c7ccb47fb087e8d6d171830b5b75dfe1e`。从运行容器 `/app/dist/main.js.map` 提取以下源文件，按 UTF-8 内容计算 SHA-256，与本地 `f169de6a09` 工作区一致：

| 相对 `packages/backend/server/`            | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `src/server.ts`                            | `c2d98ce28a6f774bc2434d9947ae0270aa01aecf17a2ee9b9f25309425964ab3` |
| `src/base/logger/localmind-log-service.ts` | `e56edf6a9eb93489854c2c02c8354e1c6697a18890958fa3baa89cb46a50ca4e` |
| `src/base/logger/spool.ts`                 | `48eb4c2e197e0c3709e11d07289bfa7f1c9f59b9b0e4de6931c48d20989401a3` |
| `src/base/logger/service.ts`               | `aefd445cecafa8407ed3674e69439aaeb56dd70b1013511288f9b35459c37d72` |
| `src/base/prisma/factory.ts`               | `8d7ac18d77621090fb4074259ecb9f18d202e2be74e6dde152f915756cc0b08d` |
| `src/base/graphql/logger-plugin.ts`        | `235d2ccb011c2ef2e421e653b2ce7aa81e9782ca522fe7221a2b8b54e158c44a` |
| `src/middleware/timing.ts`                 | `251d43a5cb6bd4dd45775a2944d06c0e2bca6650a44c4c4500086a2c1ce6525d` |
| `src/core/project/realtime.ts`             | `49defa043b11cd7e7e92855686ba5d5968fd85c7cc557bc465681bd1c2f9a55a` |
| `src/plugins/copilot/work-order-jobs.ts`   | `afa7d49653ebb2ccd2a5c8ee183d29cfe9096500cdac9490a3189d26318f5b68` |
| `src/core/notification/job.ts`             | `72fe601cc8c07a4c661cff2baaff835668ba11094b6e9e4394dae888d0dcf08f` |
| `src/base/job/queue/queue.ts`              | `5ec0f6bd43eadfbbfeb4b30cfffd1d00c9e425f8b4e2d61372f60d77e0f15032` |
| `src/core/observability/controller.ts`     | `28e1e22d7ba67a75bf728dcb4a87ad66e9f9a3457e305bc2771bbc6a8439223d` |
| `src/core/monitor/service.ts`              | `7828f1e4bc37941f61458dbde2a14b01e89b1262144676adccfb51c3fc1d57b4` |
| `src/base/job/queue/executor.ts`           | `fb9e7a198df15f67867cb5b0352cc7cf4a6664a3830e28a6ed9eca0715625da3` |

前端产物（`/app/static/js/`，无 source map，核对的是编译后行为）：

| 文件                | SHA-256                                                            | 核对内容                                    |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `index.da6b0b6d.js` | `bf71aca3c221d3b14d065b121cfed8aead794959c1a27a1f7decfbce90472bf7` | GuardService 5 秒刷新、订阅维护、侧栏与搜索 |
| `5628.108558d0.js`  | `1764cdf90168a09ae0b1f658d40b2c9ed610d4abb681c3796cff3f391f92c857` | 资源列表把文档组集合交给 readableDocIds     |
| `1604.05914188.js`  | `fd90a4c89065d41071b8b6e7d44bfe5feaf03169e79f137ad0c141e2ac4a3482` | ProjectRealtimeStore 15 秒补偿刷新          |
| `9254.c9ca7229.js`  | `8e21e85350f3f309d7d169cb87ca2bfb5c0fb7d10cfdceffd6a8cd11281e3d3f` | 工作台三列会话与任务面板                    |

取证边界：

- 线上读取通过 `ssh localmind` 完成：容器状态、限时 HTTP 请求、Docker 日志与 `/proc`；数据库查询使用 `default_transaction_read_only=on` 和 8 秒 `statement_timeout`，只读策略、回执和统计视图。
- 初次排查的短时 GDB attach 会短暂暂停进程，不是零扰动；未调用目标进程函数或注入代码。2026-11-01 的复查未重启、未发信号、未连接 inspector、未生成快照。
- 统计采用流式 JSON 解析，以 Docker 时间限定旧进程窗口、以 `occurredAt` 计算速率、以 `requestId` 关联两层日志；P95 取排序后的下取整索引。只输出聚合值与脱敏样例，本文不含 Workspace ID、event ID、request ID 或用户标识。
- 已检查 `/var/crash`、`/var/lib/systemd/coredump`、`/var/lib/apport/coredump`、主机与容器 `/tmp`、线上仓库、事故备份和容器 `/app`，均未发现 heap snapshot、core 或诊断报告；这只覆盖已检查的位置。本地仓库已有的 `packages/backend/server/core`（10 月 28 日生成）早于故障，与本次无关。
- 代码修复实施时遵守 [Docker 开发约束](localmind-docker-development-constraints.md)和[验证策略](ai-modernization/validation.md)。

## 附录 C 本地实施记录（2026-11-01）

本节记录第 5 节中可在代码与仓库配置内完成的部分。代码已合入 `main`，未部署到任何服务器，未修改线上数据库或配置；运行规则同步写入[日志系统设计](localmind-logging-system-design.zh-CN.md)第 12.2 节，部署项写入[部署文档](localmind-deployment.zh-CN.md)。

### C.1 已实施

| 项         | 内容                                                                                                                                                                                             | 主要位置                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| P0-1、2    | 列表、侧栏、搜索候选改入 60 秒刷新池，打开的文档保持 5 秒；页面隐藏暂停；并发合并、全局 4 并发；重试有上限；候选集合不变时不重查                                                                 | `frontend/core/src/modules/permissions/services/guard.ts`、`components/native-files/resource-explorer.tsx` |
| P0-3、4    | 成功的 `/graphql`、`/api/logs/batch`、`/info` 不写 HTTP 完成日志；成功且不慢的 GraphQL 请求按 operation 每分钟汇总                                                                               | `backend/server/src/middleware/timing.ts`、`base/graphql/logger-plugin.ts`                                 |
| P0-5       | debug 默认不入库；高频定时任务入队不写 debug                                                                                                                                                     | `base/logger/localmind-log-service.ts`、`base/job/queue/queue.ts` 及三个定时任务                           |
| P0-6—9     | spool 内存计数与容量预留；降级状态转换与窗口汇总；在途准入上限与熔断；stdout 队列上限                                                                                                            | `base/logger/spool.ts`、`localmind-log-service.ts`                                                         |
| P1-1、2    | 有界内存队列批量写库，单批在途；服务端生成 ID 首次写入跳过查重；spool 按 100 条一个事务回放，损坏文件隔离                                                                                        | `localmind-log-service.ts`、`spool.ts`                                                                     |
| P1-3       | 日志写入、回放与清理使用独立小连接池（默认 3）                                                                                                                                                   | `base/logger/localmind-log-database.ts`                                                                    |
| P1-4       | 保留清理改为非阻塞锁、游标前进、自适应批量、每轮时长与行数上限，进度写入新表 `localmind_log_retention_runs`                                                                                      | `localmind-log-service.ts`、迁移 `20261101100000_localmind_log_retention_runs`                             |
| P1-6       | 归档按 error/fatal 的失败保留期判断；dry-run 与存在性检查不再全表计数                                                                                                                            | `localmind-log-service.ts`                                                                                 |
| P2-2       | spool 目录改用稳定的 `LOCALMIND_NODE_ID`（默认 `primary`），首次回放迁入旧版按进程 ID 命名的目录；Compose 挂载持久卷                                                                             | `localmind-log-service.ts`、`.docker/selfhost/compose.localmind.yml`                                       |
| P2-1、3、5 | Compose：`init: true`、`/info` 存活检查、容器日志轮转、`POSTGRES_SHARED_BUFFERS` 等变量（默认值不变）；镜像启动参数加入不含环境变量的致命错误诊断报告；新增主机看门狗脚本                        | `compose.localmind.yml`、`Dockerfile.localmind`、`.docker/selfhost/localmind-watchdog.sh`                  |
| P3（部分） | 新增 `workspace.docsPermissions(docIds)`，每次最多 100 篇，逐篇执行与单篇查询相同的实时 ACL；前端列表池使用批量查询，旧服务端自动退回逐篇；Admin 接收状态返回熔断、队列、窗口计数与最近 5 轮清理 | `core/workspaces/resolvers/doc.ts`、`common/graphql`、`stores/guard.ts`、`spoolStatus()`                   |

实现中的取舍：

- 列表行没有按“屏幕上实际渲染的行”订阅，那需要接入列表虚拟化。改为 60 秒刷新池加批量查询后，约 214 篇文档的全部资源页稳定状态约为每分钟 3 次请求（每次最多 100 篇），修复前约每秒 43 次。
- 熔断把“写库成功但耗时超过 2 秒”与失败同样计入，避免数据库持续变慢时继续逐条写库。
- 批量权限查询对数据库中不存在记录的文档返回 `missing`，由客户端改用单篇查询，因为单篇查询会顺带修复文档所有者，批量路径不复制这一写操作。
- 批量查询失败时不退回逐篇查询（除非服务端明确不支持该字段），避免服务端过载时请求量放大。
- `writeAudit()` 的写入路径与 fail-closed 语义未改动。
- Compose 中 PostgreSQL 参数的默认值与 PostgreSQL 自身默认值相同；是否调大以及取值由运维按主机内存决定。

### C.2 验证

均在复用的本地 Linux 容器 `localmind_stream_fix_test`（`localmind-affine:dev-base`，源码挂载本仓库）中执行，未构建或重建镜像。数据库测试使用在本地 `localmind_stream_fix_db`（PostgreSQL 16）上新建、用后删除的一次性数据库。

| 命令或检查                                                                                                                      | 结果                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 一次性数据库上 `prisma migrate deploy`（全部迁移，含新迁移）                                                                    | 成功；`prisma migrate diff` 对新表无差异                                                |
| `yarn workspace @affine/server test` 日志相关 5 个文件与 `core/observability/__tests__/resolver.spec.ts`（一次性数据库）        | 39 项通过                                                                               |
| `yarn workspace @affine/server e2e src/__tests__/e2e/doc/docs-permissions.spec.ts src/__tests__/e2e/doc/resolver.spec.ts`       | 11 项通过                                                                               |
| `yarn vitest run` 权限、资源列表、快速操作、文档搜索、快速搜索、Admin 可观测性相关 20 个文件                                    | 113 项通过                                                                              |
| `yarn lint:ox`、`yarn eslint`、`yarn prettier --check`（改动文件）；`docker compose config`；看门狗脚本以替身 `docker` 命令演练 | 通过                                                                                    |
| `tsc -b` 后端、前端核心与 Admin 项目                                                                                            | 5 个错误，均在未改动文件（`document-editor.spec.tsx`、Admin BYOK 相关文件），属既有基线 |

新增测试覆盖：批量写入的分批与单批在途、准入超限丢弃、熔断与探测、窗口汇总、stdout 上限、debug 过滤、HTTP 与 GraphQL 日志过滤；真实数据库上的分批删除与 ID 登记同步、行数上限的 `partial`、锁竞争让出、冻结后停止、dry-run 上限与归档保留分类、spool 批量回放与损坏文件隔离及旧目录迁入、首次写入批量入库；批量权限查询与单篇结果一致、超过 100 篇拒绝、非成员拒绝；前端批量分块、`missing` 回退、批量刷新撤权、旧服务端回退与瞬时失败不放大。

本地热启动实例 `localmind_hot_backend` 挂载同一源码，nodemon 已自动重载并正常启动，并重新生成了 `schema.gql`。该实例的数据库未应用新迁移，其每小时清理会因缺少 `localmind_log_retention_runs` 表而失败并记录错误，不影响其他功能；按[部署约束](localmind-docker-development-constraints.md)同步运行环境时一并处理。

### C.3 未实施，需服务器侧决策或数据

- 部署本次代码：需要构建 `localmind-affine:local` 镜像、执行新迁移并替换容器；替换容器前先保留并校验当前 spool（第 3.7 节）。
- `POSTGRES_SHARED_BUFFERS` 等数据库参数的取值与重启时机。
- 是否在主机上启用 `localmind-watchdog.sh`，以及 cron 或 systemd timer 的配置。
- 线上首次积压清理的执行时机（低峰期手动触发 `cleanupLocalmindLogRetention` 并观察 I/O）。
- 日志索引精简：需要线上 `pg_stat_user_indexes` 的使用统计后再决定。
- 日志表按月、按保留等级分区：涉及千万行数据迁移与锁表，需单独设计迁移窗口。
- 请求来源关联字段与按可见行订阅的列表虚拟化：属于后续优化。
- 第 6 节中的长时间负载、数据库长时间不可用与 x64 生产镜像 OOM 退出等验收，以及第 7 节的未决问题。

## 参考

- [LocalMind 实例内置日志系统设计](localmind-logging-system-design.zh-CN.md)
- [LocalMind 页面加载性能排查记录](localmind-page-loading-performance-investigation.zh-CN.md)
- [Node.js：A note on process I/O](https://nodejs.org/api/process.html#a-note-on-process-io)
- [Node.js：Don't Block the Event Loop（worker pool）](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Prisma ORM v6 Transactions](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)
- [PostgreSQL 16 Resource Consumption](https://www.postgresql.org/docs/16/runtime-config-resource.html)
- [PostgreSQL 16 Routine Vacuuming](https://www.postgresql.org/docs/16/routine-vacuuming.html)
- [PostgreSQL 16 Table Partitioning](https://www.postgresql.org/docs/16/ddl-partitioning.html)
- [Docker：Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [Docker：Run multiple processes / `--init`](https://docs.docker.com/reference/cli/docker/container/run/#init)
