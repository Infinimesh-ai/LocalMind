# LocalMind Workspace 切换卡顿修复设计

状态：实施设计草案
适用范围：Web 与 Electron 共用的 Workspace 路由、应用壳、Workspace Engine 和
nbstore 云端连接
实测基线：2026-09-18，本地最新源码服务 `http://127.0.0.1:3011`

本文针对左侧栏切换 Workspace 时出现的整屏刷新感、数秒无响应、长时间
`Syncing...`，以及最终出现 `Network error: timeout after 15000ms` 的问题。

本文是修复设计，不是已完成的修复记录。当前结论来自浏览器实测、前端路由与作用域
生命周期代码、Workspace Engine/nbstore 连接实现和服务端请求日志。实施时仍应先完成
第 5 节的观测补强，以确认具体超时请求，不能仅靠延长超时时间掩盖问题。

## 1. 用户可见问题与实测证据

### 1.1 实测结果

从左侧栏的当前 Workspace 切换到“销售区”时：

- URL 在约 3.26 秒后变为目标 Workspace；目标内容约 3.46 秒后首次出现。
- 页面没有发生浏览器级硬刷新，实际是 SPA 路由切换。
- 切换时当前 Workspace 的 `FrameworkScope`、`WorkspaceLayout` 和
  `WorkbenchRoot` 被替换，整块应用 UI 进入 fallback，因此视觉上等同于整屏刷新。
- 目标内容出现后仍显示 `Syncing...`。
- 约 15 秒后出现 `Network error: timeout after 15000ms` 和 `Refetch`。
- 同期已完成的 GraphQL 请求大多在几十毫秒内结束，没有发现一个已完成但耗时 15 秒的
  GraphQL 请求。15 秒来自 nbstore/连接层的客户端超时上限，具体未完成请求尚缺少可定位的
  阶段、storage key 和安全化 URL 证据。
- 目标 Workspace 初始化还会读取多个可选内部文档。实测中的 404 均在约 8–32 毫秒内
  返回，不是本次 15 秒阻塞的直接来源，但增加了冷启动请求扇出和日志噪声。

### 1.2 影响

- 用户无法区分“正在切换”“本地内容已经可用但远端仍同步”和“切换失败”。
- 在本地开发服务也可能等待完整 15 秒，体感明显劣于普通 SPA 导航。
- 快速连续点击多个 Workspace 时，旧请求、路由状态和视图清理可能互相覆盖。
- 切回刚访问过的 Workspace 仍可能重新创建作用域、启动 engine 并同步，无法利用热缓存。

## 2. 根因分析

### 2.1 整个 Workspace 作用域随路由切换重建

入口：

- `packages/frontend/core/src/desktop/pages/workspace/index.tsx`

`WorkspacePage` 在 `workspaceId` 改变后调用 `workspacesService.open()`，等待
Workspace 实例，再创建新的 `FrameworkScope`。Workspace 未打开时返回空内容，root doc
未 ready 时渲染 `AppContainer` fallback；只有 ready 后才渲染
`WorkspaceLayout` 和 `WorkbenchRoot`。

因此左侧全局导航也位于会被替换的 Workspace 作用域内。即使路由没有硬刷新，用户仍会
看到完整应用壳退出并重新进入。

### 2.2 旧 Workspace 约一秒后被回收，切回时重复冷启动

入口：

- `packages/frontend/core/src/modules/workspace/services/repo.ts`
- `packages/frontend/core/src/modules/workspace/entities/workspace.ts`
- `packages/common/infra/src/utils/object-pool.ts`

Workspace repository 使用 `ObjectPool`。路由切换释放引用后，通用对象池每秒执行一次
GC；当前 `WorkspaceEntity.canGracefulStop` 始终允许停止，因此旧 scope 会被 dispose 并从池
中删除。用户稍后切回时需要重新创建 `WorkspaceScope`、启动 engine、读取 root doc 和恢复
连接。

这里不应直接修改通用 `ObjectPool` 的全局 GC 语义。修复应在 Workspace repository 层增加
有上限的 warm lease/LRU，并明确暂停、恢复和逐出行为。

### 2.3 一次切换可能重复刷新 Workspace 列表

入口：

- `packages/frontend/core/src/components/root-app-sidebar/workspaces.tsx`
- `packages/frontend/core/src/desktop/pages/workspace/index.tsx`

当前存在两处 `workspacesService.list.revalidate()`：

1. `SidebarWorkspaces` 挂载时刷新；由于侧栏跟随 Workspace scope 重挂载，切换时会再次触发。
2. Workspace 路由参数变化时再次刷新。

这两个刷新都不是打开已知目标 Workspace 的必要前置条件。它们会产生重复 GraphQL、状态
更新和重新渲染，并放大网络不稳定时的卡顿。

### 2.4 切换前先关闭其他 Workspace 的 workbench view

入口：

- `packages/frontend/core/src/components/root-app-sidebar/workspaces.tsx`

选择目标 Workspace 时，当前实现先遍历并关闭所有非目标 Workspace 的 workbench view，
随后才执行 `jumpToPage()`。这会增加同步状态写入和订阅通知，并导致失败时原工作上下文已被
清理。日志中同一目标路径短时间出现多次 `WorkbenchLocationChanged`，说明还需要检查视图
订阅是否重复传播；该现象是次要证据，尚不能单独认定为根因。

### 2.5 root ready 与远端同步状态耦合过重

入口：

- `packages/frontend/core/src/modules/workspace-engine/impls/cloud.ts`
- `packages/common/nbstore/src/impls/cloud/http.ts`
- `packages/common/nbstore/src/connection/connection.ts`

Web 已有 IndexedDB 本地存储，但当前切换体验没有清楚区分以下状态：

- 本地 root snapshot 可读；
- UI 已可交互；
- 远端连接已建立；
- 增量同步已完成；
- 可选内部文档不存在或仍在加载。

nbstore HTTP 与自动重连的默认关键超时为 15 秒。发生挂起时，完整应用 fallback 或
`Syncing...` 会持续到超时，之后才给出笼统错误。仅把 15 秒改成更长或更短都不能解决状态
耦合问题。

## 3. 修复目标与非目标

### 3.1 修复目标

- 切换 Workspace 时全局应用壳和左侧栏保持挂载，不再出现整屏退出/进入。
- 点击后 100 毫秒内显示目标高亮和明确的切换状态。
- 本地缓存可用时先展示可交互内容，远端同步作为非阻塞状态继续进行。
- 在短时间内切回最近 Workspace 时复用已打开的 scope/engine。
- 每次切换只产生必要的列表刷新、engine 启动和 root doc 请求。
- 快速连续切换使用 latest-wins 语义，旧切换不能覆盖新目标。
- 超时和重试能定位到具体阶段，并保持日志有界、脱敏。
- 缓存复用不能绕过实时 ACL、账户隔离或 Workspace 数据边界。

### 3.2 非目标

- 不通过单纯增加 15 秒超时解决问题。
- 不永久保留所有 Workspace scope、worker、socket 或文档对象。
- 不把多个 Workspace 的文档数据合并到同一作用域。
- 不为性能绕过 Workspace 权限检查、服务端 ACL 或会话校验。
- 不在本修复中重构全部 Workspace Engine 或同步协议。

## 4. 目标切换流程

```text
用户点击 Workspace B
        │
        ├─ 立即更新目标高亮，生成 switchId
        │
        ├─ 保持全局 Shell、侧栏和 Workspace A 内容可见
        │
        └─ Switch Coordinator 打开/恢复 B
                 │
                 ├─ 有 warm scope：resume
                 └─ 无 warm scope：open + local bootstrap
                              │
                       local root ready
                              │
             原子提交 active Workspace 与 Workbench
                              │
                    远端连接/同步在后台继续
                              │
                成功更新同步状态，失败显示内联错误
```

建议显式状态机：

```text
idle
  -> preparing(target, switchId)
  -> local-ready
  -> committed
  -> syncing
  -> ready

preparing/local-ready/syncing
  -> failed(retryable, phase)
  -> superseded
```

所有异步完成回调都必须校验 `switchId`；过期任务只能清理自己的临时 lease，不能修改当前
路由、active workspace 或错误状态。

## 5. 分阶段实施方案

### P0：补齐切换链路观测

先增加统一的 `workspaceSwitchId` 和性能标记：

| 标记                                | 含义                            |
| ----------------------------------- | ------------------------------- |
| `workspace-switch-click`            | 用户选择目标 Workspace          |
| `workspace-switch-route-committed`  | SPA 路由确认目标 ID             |
| `workspace-switch-open-start`       | repository 开始 open/resume     |
| `workspace-switch-engine-start`     | engine 开始启动或恢复           |
| `workspace-switch-local-root-ready` | 本地 root snapshot 可供 UI 使用 |
| `workspace-switch-ui-committed`     | 目标主区域可交互                |
| `workspace-switch-remote-connected` | 远端连接建立                    |
| `workspace-switch-sync-ready`       | 当前同步完成                    |
| `workspace-switch-failed`           | 失败，附带受控阶段与错误类型    |

nbstore 超时错误至少记录以下有界字段：

- `switchId`、阶段、耗时、Workspace ID 的不可逆摘要；
- storage 类型、操作类型和归一化路由模板；
- 是否命中本地缓存、是否重试、是否被更新切换取消；
- HTTP 状态或超时类型。

不得记录 token、cookie、完整查询参数、文档正文、模型凭据或未经清洗的 URL。前端性能事件
与服务端请求使用同一个关联 ID，但不把该 ID 作为授权依据。

验收：一次失败能明确回答“哪个阶段、哪个存储操作、等待多久、是否有本地可用内容”。在
此之前不要假定 15 秒一定来自某个具体端点。

### P1：移除重复刷新并修正交互事务

1. 删除 `SidebarWorkspaces` 的挂载即 `revalidate()` 行为。
2. 路由变化时仅在目标 metadata 缺失、列表过期或服务端主动失效时刷新。
3. 给 Workspace 列表刷新增加 in-flight 合并；同一账户和服务端下只保留一个请求。
4. 点击后立即更新目标高亮，显示“正在切换”，并暂时防止对同一目标的重复提交。
5. 不在目标打开前关闭其他 Workspace view。成功提交目标后再按产品策略暂停旧 view；失败时
   保持原 Workspace 可用。
6. 快速 A → B → C 时取消或标记 A/B 的未提交工作为 superseded，只允许 C 提交。

建议将选择、打开、提交和失败恢复集中到单一 Switch Coordinator，避免组件、路由 effect
和 repository 分别维护一套切换状态。

### P2：稳定全局应用壳

将不依赖当前 Workspace scope 的 UI 提升到稳定的 session/global scope：

- Root app shell；
- 左侧 Workspace 列表；
- 账户、服务端、通知等全局入口；
- 切换进度和全局错误容器。

只有 Workspace 主区域、Workspace 专属命令和 workbench 保持在目标
`FrameworkScope` 内。侧栏需要的 Workspace 列表从 session 级 service 读取；active ID 从
路由/协调器读取，不反向依赖即将被 dispose 的 Workspace scope。

过渡期若无法一次完成 scope 拆分，至少做到：

- fallback 只覆盖主内容区，不卸载侧栏；
- 新 Workspace local root ready 前保留旧内容或稳定 skeleton；
- 不返回整页 `null`；
- fallback 有固定尺寸，避免布局跳动。

### P2：增加有上限的 Workspace 热缓存

在 Workspace repository 内增加专用 warm cache，不改变通用 `ObjectPool`：

- 默认保留最近 2–3 个 Workspace，或保留 60–120 秒，以先满足任一上限为准；
- 内存压力、登出、切换服务端/账户、权限撤销时立即逐出；
- suspend 时断开不必要的 awareness/实时订阅，停止高频后台任务；
- 保留安全的 IndexedDB 句柄、root snapshot 和可恢复的 engine 状态；
- resume 时重新检查会话和实时 ACL，再恢复远端连接；
- 有待提交本地写入时，必须按既有同步契约 flush 或保留可靠队列，不能在逐出时静默丢失。

缓存 key 至少包含 server、account、workspace、flavour 和 doc scope。普通 Workspace、
Project、公开分享和 document-scoped 模式不得复用同一实例。

### P2：拆分本地可用与远端同步 readiness

UI 提交条件调整为“目标身份已确认且本地 root 可读”，远端同步状态独立显示：

- `本地内容可用，正在同步`；
- `离线，显示本地内容`；
- `同步延迟，可重试`；
- `无本地内容且无法连接`。

可选内部文档应并行、惰性加载。确认不存在后可以按 storage revision 做短时 negative cache，
避免每次切换重复 404；确需创建时使用幂等初始化。可选文档失败不能阻塞 root 内容。

超时应按阶段配置：

- 本地 IndexedDB 读取使用短时 watchdog 并报告损坏/阻塞；
- root 远端 bootstrap 可保留较长网络超时，但不能阻塞已有本地内容；
- Workspace 列表和轻量 metadata 使用更短超时和请求合并；
- 重试使用退避和抖动，不对已 superseded 的切换继续重试。

### P3：收敛 Workbench 与路由通知

- 检查 `WorkbenchLocationChanged` 的订阅数量和 effect 依赖，保证一次已提交切换只发出一个
  语义事件。
- 保留每个 Workspace 的最近 workbench tabs/位置；恢复时校验文档仍存在且仍有权限。
- location 持久化与 telemetry 去重，不因 rerender 重复写入。
- Workspace 打开失败时不修改已提交的旧 location。

## 6. 建议改动入口

| 文件/模块                                                               | 建议职责                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/frontend/core/src/components/root-app-sidebar/workspaces.tsx` | 删除挂载刷新；点击只发起一次切换；不提前关闭其他 view      |
| `packages/frontend/core/src/desktop/pages/workspace/index.tsx`          | 去除整页空白 fallback；将 UI commit 与远端 sync 解耦       |
| `packages/frontend/core/src/modules/workspace/services/repo.ts`         | Workspace 专用 warm lease/LRU、resume/suspend、逐出        |
| `packages/frontend/core/src/modules/workspace/entities/workspace.ts`    | 明确可暂停、可逐出和未同步写入条件                         |
| `packages/frontend/core/src/modules/workspace-engine/impls/cloud.ts`    | 拆分 local/remote readiness；可选文档并行与 negative cache |
| `packages/common/nbstore/src/impls/cloud/http.ts`                       | 结构化、脱敏的阶段与超时证据；支持取消信号                 |
| `packages/common/nbstore/src/connection/connection.ts`                  | latest-wins 取消、分阶段超时和后台重连状态                 |
| Workbench location/state 模块                                           | 位置事件去重、按 Workspace 保存和延后清理                  |

不建议为此修改 `packages/common/infra/src/utils/object-pool.ts` 的全局默认行为。其他模块也在
使用该基础设施，扩大 GC 周期可能造成无关资源泄漏。

## 7. 验证方案

### 7.1 单元测试

- 已知 Workspace 点击后只调用一次导航/切换入口。
- 普通切换不触发 Workspace 列表 `revalidate()`；metadata 缺失时只触发一次。
- 打开目标失败时不关闭原 Workspace view。
- A → B → C 快速切换只有 C 能 commit，A/B 资源被正确释放。
- A → B → A 在 warm TTL 内复用 A 的 engine；超过 TTL 或容量后正确逐出。
- 登出、切换账户/服务端和 ACL 拒绝会强制逐出缓存。
- 可选内部文档 404 不阻塞 root ready，并按预期命中 negative cache。
- suspend/evict 前存在未同步写入时不会静默丢失。

### 7.2 集成测试

覆盖以下矩阵：

| 场景                            | 预期                                                 |
| ------------------------------- | ---------------------------------------------------- |
| 热缓存 A → B                    | Shell 不卸载，B 快速可交互，后台同步                 |
| A → B → A（1 秒、10 秒、60 秒） | TTL 内复用，超限后安全冷开                           |
| 第一次打开冷 Workspace          | 稳定 skeleton，仅主内容区等待                        |
| root 远端请求挂起 15 秒         | 有本地内容时继续可用；无本地内容时给出阶段化错误     |
| 可选内部文档返回 404            | 不阻塞，后续切换不重复请求风暴                       |
| 离线 → 在线                     | 先显示本地内容，网络恢复后同步                       |
| 权限在缓存期间被撤销            | resume 被拒绝，清除目标缓存，不泄露旧内容            |
| 快速 A → B → C → A              | latest-wins，URL、active ID、scope 和 workbench 一致 |
| 目标打开失败                    | 原 Workspace 保持可操作，可单独重试目标              |

### 7.3 浏览器性能与行为门槛

以下为本地自托管基线的初始验收值，合入前用 CI/目标机器样本校准，但不能删除行为门槛：

- 点击到目标高亮：p95 小于 100 毫秒。
- 热 Workspace 点击到可交互：p95 小于 500 毫秒。
- 冷 Workspace 在本地服务点击到首次可交互：p95 小于 1.5 秒。
- 切换期间浏览器 `performance.timeOrigin` 不变，证明没有硬刷新。
- 全局 Shell/侧栏不卸载；整页空白不能持续超过一个 animation frame。
- 正常切换的 Workspace 列表刷新为 0 次；确需补 metadata 时最多 1 次。
- 单个目标一次切换最多创建 1 个 engine；TTL 内切回不得再次创建。
- 15 秒网络超时不能阻塞 Shell；3 秒后应显示“同步延迟”，最终错误只影响失败阶段。
- 缓存容量和 TTL 到达上限后，worker、socket、订阅与 scope 均可观测地释放。

建议在 Playwright 测试中读取应用性能标记，并同时断言 DOM shell identity、URL、active
Workspace、可交互主区域和网络请求数量。只测截图或只测 URL 都不足以证明修复。

## 8. 安全与一致性约束

- warm cache 只能改善生命周期，不能成为权限缓存。每次 resume 都按当前用户和服务端会话
  重新确认 ACL。
- 目标 Workspace 提交必须原子更新 route、active workspace、FrameworkScope 和
  workbench；禁止 UI 显示 B 但写操作仍落到 A。
- 所有写操作继续以资源所属 Workspace 和实时 ACL 为准；切换关联 ID 不参与授权。
- 服务端、账户或身份发生变化时，不允许跨边界复用 IndexedDB namespace 或 engine。
- 失败和遥测不得包含 token、cookie、完整 URL、文档正文或其他 Workspace 的数据。
- 缓存逐出必须处理本地未提交操作、订阅、worker、socket 和 object URL，避免数据丢失与资源
  泄漏。

## 9. 发布与回滚

建议使用 `workspace_switch_v2` 功能开关分阶段发布：

1. 仅发布 P0 观测，确认 15 秒失败的具体阶段和请求类型。
2. 发布重复刷新移除、latest-wins 和非破坏性失败恢复。
3. 发布稳定 Shell 和 local-ready 提交。
4. 小比例启用 warm cache，观察内存、worker、socket、失败率和 ACL 拒绝。
5. 达到第 7 节门槛后扩大范围，并保留至少一个版本的旧路径回滚能力。

回滚开关应停止创建新的 warm lease，并安全释放已有缓存；不能直接丢弃未同步写入。该修复
预计不需要数据库迁移或 GraphQL schema 变更。若观测数据要持久化到服务端，应复用现有有界
遥测/日志入口，不新增包含用户正文的表。

## 10. 完成定义

只有同时满足以下条件才可标记修复完成：

- 已定位并修复实测中的 15 秒超时来源，或证明它只影响非阻塞后台同步。
- 左侧栏切换不再卸载全局 Shell，也没有整页空白。
- 重复列表刷新、重复 engine 初始化和重复 location 事件已由测试限制。
- warm cache 有容量、TTL、内存压力和身份边界，且逐出无资源泄漏。
- 离线、权限撤销、快速连续切换、目标失败和未同步写入均有自动化覆盖。
- 第 7.3 节性能门槛在目标 Web 与 Electron 环境通过。
- 发布说明记录开关、观测结果、回滚方式和剩余风险。
