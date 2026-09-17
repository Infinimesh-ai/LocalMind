# LocalMind 代码检查问题讨论记录

日期：2026-09-17。

本记录保留只读检查时的问题分析，并记录随后完成的代码修复与聚焦验证。
本轮重点检查 MCP 直接资源、权限与同步链路；它不是全仓库完整审计结论。
问题 1、2、3 已实施修复；交付范围、验证命令及剩余边界见文末。

## 问题 1：普通文档实时广播缺少接收者权限检查

优先级：P1。状态：已修复，Linux 测试使用真实双账号、多连接 WebSocket 验证。

### 问题与后果

WebSocket 的“房间”是服务端对连接的分组，用于批量发送实时更新，不是产品中的聊天室。
工作区成员加入同步房间后，可以接收服务端向该分组发送的消息。

工作区同步权限 `Workspace.Sync` 不等于工作区内每篇文档的读取权限 `Doc.Read`。
当前普通文档广播直接向整个工作区房间发送更新，没有逐接收者检查文档读取权。

典型触发场景：

1. B 是工作区普通成员，拥有 `Workspace.Sync`，但没有文档 D 的读取权。
2. B 加入工作区同步房间。
3. A 或 MCP 修改 D，服务端将更新发送给整个房间。
4. B 的连接也收到 D 的更新载荷，即使界面不显示 D、读取接口拒绝打开 D。

这不意味着 B 立即获得全部历史正文，但更新中的新增文字、标题等可能泄露；如果载荷
包含完整初始文档，暴露范围会更大。撤销文档读取权后，只要连接仍在工作区房间，也可能
继续收到后续更新。前端隐藏内容不能弥补服务端已经把数据发送给无权限用户的问题。

### 代码原因与入口

主要代码位于
[`packages/backend/server/src/core/sync/gateway.ts`](../packages/backend/server/src/core/sync/gateway.ts)。

- `SyncSocketAdapter.join()` 检查 `Workspace.Sync`；`joinSpace()` 随后加入工作区的
  `sync-025` 或 `sync-026` 协议房间。
- `onLoadSpaceDoc()` 对具体读取请求检查 `Doc.Read`，但该检查不会覆盖主动推送。
- `broadcastDocUpdate()` 将客户端提交的普通文档更新直接广播到工作区协议房间。
- `onDocUpdatesPushed()` 将服务端普通文档更新直接广播到同类房间。
- MCP 的
  [`WorkspaceDocOutboxPublisher`](../packages/backend/server/src/core/doc/outbox.ts)
  通过 `doc.updates.pushed` 事件进入服务端广播路径。
- `broadcastDirectoryUpdate()` 已对目录更新逐接收者检查权限，可作为复用参考。
  普通文档广播目前没有同等保护。

### 修复思路

1. 统一客户端写入与服务端写入的广播授权逻辑，避免只修复一个入口。
2. 获取目标房间中的连接，从服务端认证上下文解析真实用户身份；按接收者的实时文档
   `Doc.Read` 权限过滤，同时核对用户有效状态及工作区访问状态。
3. 普通 Workspace 文档授权明确使用 `projectScope(null)`，不得借用 Project 授权
   扩大工作区广播范围。
4. 在实际广播阶段重新检查，不能只依赖加入房间时或原写入时的授权。MCP outbox
   可能延迟投递，写入后、投递前发生的撤权必须阻止后续内容发送。
5. 同时覆盖 `sync-025` 和 `sync-026`，保留现有编码、压缩及客户端写入时排除发送者
   的行为。Userspace 同步与目录专用权限规则应保持各自语义。
6. 单次广播内可按用户去重检查，减少同一用户多个连接产生的重复查询；不得跨广播
   长期缓存权限决定。性能优化不能退回工作区级无差别发送。

实施时还需明确授权检查与并发撤权的时序边界，避免将一次检查误称为对整个发送过程
的原子保护；已合法发送到客户端的数据无法通过后续撤权收回。

### 聚焦验收

- 同一工作区中，A 可读 D、B 不可读 D：A 正常接收，B 收不到 D 的更新载荷。
- B 加入同步房间后被撤销 D 的读取权：后续更新不再发送给 B。
- MCP 写入已提交，但 outbox 投递前 B 被撤权：投递时仍应过滤 B。
- 用户停用、工作区访问权撤销后，已有连接不能继续接收文档内容。
- 客户端写入、服务端写入及两种同步协议均覆盖上述场景。
- 有权限用户的多连接同步、发送者排除、目录权限过滤和 Userspace 同步没有回归。

修复代码时运行聚焦 Linux 容器验证，遵守固定镜像角色与最小验证范围，不因本问题默认
重建完整运行镜像。最初检查仅新增本文档；后续代码修复与验证见文末。

## 问题 2：分页排序与游标比较不一致

优先级：P2。状态：已修复，Linux 测试使用 PostgreSQL 持久化资源验证分页与旧游标失效。

### 问题与后果

文件夹列表排序使用 `localeCompare()`，游标筛选却使用字符串 `>`。前者采用语言排序
规则，后者采用 UTF-16 编码单元顺序，两者对大小写字母、下划线等合法 ID 字符的顺序
可能不同。文档列表在更新时间相同时，也存在同样的 ID 比较问题。

游标相当于上一页结束位置的书签。排序与书签筛选规则不一致，会导致调用方连续翻到
末页后仍遗漏资源，而接口没有报错。数据库内容不会因此被删除，但资源盘点、自动归档
等调用可能据此误判资源不存在。

此前纯内存复现中，`localeCompare()` 将示例 ID 排为 `_、-、a、A、b、B`；每页读取
一项并使用当前游标筛选逻辑，实际只读到 `_、a、b`，遗漏 `-、A、B`。

### 修复方法

主要修改入口为
[`WorkspaceResourceService`](../packages/backend/server/src/core/doc/workspace-resource.ts)
的 `listFolders()` 和 `list()`。

1. 对不透明资源 ID 统一采用确定的字符编码顺序，不使用受语言环境影响的
   `localeCompare()`。排序比较函数可使用 `a < b ? -1 : a > b ? 1 : 0`，与游标中的
   `>` 保持同一比较语义；如果仓库已有等价辅助函数，优先复用。
2. 文件夹列表按 ID 升序排列，下一页仅保留 ID 严格大于游标 ID 的候选项。
3. 文档列表保留更新时间倒序；更新时间相同时按 ID 编码顺序升序。下一页条件保持为
   “更新时间小于游标时间，或时间相同且 ID 大于游标 ID”，确保与排序构成同一全序。
4. 保留原有 ACL、过滤条件、扫描预算和目录版本检查。修复不修改资源 ID、数据库
   结构或文档内容，也不通过扩大扫描权限弥补分页遗漏。
5. 为受影响游标增加排序版本标识，并纳入服务端签发及校验范围。旧排序生成的游标
   不得静默沿用新排序继续翻页；应明确返回可识别的失效结果，并要求从第一页重启。
   具体错误码须与公开 MCP Schema 和客户端说明一致；不必为排序变化重新分配资源 ID。

这里修复的是静态候选集中的比较不一致，不意味着跨多个请求自动获得数据库快照。
翻页期间发生资源修改或权限变化时，仍遵守现有目录版本与实时 ACL 契约。

### 聚焦验收

- 使用包含大小写字母、数字、`_`、`-` 及共同前缀的固定 ID 集合，连续读取所有页面，
  验证结果与预期集合相同、顺序一致、没有遗漏或重复。
- 分别覆盖每页一项、多项、刚好整页、空结果及最后一页，确保游标正常终止。
- 文档列表同时覆盖相同更新时间及不同更新时间，验证时间与 ID 的组合排序。
- 覆盖按父目录、指定文件夹和 externalId 过滤，以及扫描预算耗尽时的继续翻页。
- 验证旧排序游标被明确拒绝，客户端从第一页重新获取后能完整遍历。
- 原有游标作用域绑定、目录版本失效和权限过滤检查继续有效，不返回不可读资源。

以上为原始修复要求，实施与验证结果见文末。

## 问题 3：画布模式读取来源错误

优先级：P2。状态：已修复，Linux 测试验证真实属性、版本与并发事务。

### 问题与后果

MCP 直接资源服务可能将画布识别为普通页面，使原本针对画布的正文替换限制失效。
典型场景是用户将普通页面切换为画布模式，但内容仍只有兼容 Markdown 的文字笔记：

1. 前端保存画布模式。
2. MCP 读取接口错误返回 `documentType: 'page'`。
3. 若内容通过 Markdown 结构检查，还可能返回 `contentWritable: true`。
4. 调用方提交正文替换，后端未按画布类型拒绝该请求。

这会导致资源类型信息错误，以及本应受限的画布正文替换被允许。但不能据此断言所有
画布都能被覆盖或图形一定丢失：独立的结构检查仍会拒绝无法安全往返 Markdown 的
图形、复杂块等内容。最明确的触发对象是结构兼容 Markdown 的画布。

### 代码原因与入口

- 前端
  [`DocsStore.setDocPrimaryModeSetting()`](../packages/frontend/core/src/modules/doc/stores/docs.ts)
  将模式保存到 `docProperties.primaryMode`。
- [`DocPropertiesStore`](../packages/frontend/core/src/modules/doc/stores/doc-properties.ts)
  从当前属性表读取配置，同时兼容根文档中的旧版属性来源；当前非空属性覆盖旧版值。
- 后端
  [`WorkspaceResourceService.load()`](../packages/backend/server/src/core/doc/workspace-resource.ts)
  却通过根文档页面元数据的 `page.mode` 判断类型。当前前端模式写入入口不设置该字段，
  后端通常读到 `undefined` 并判为普通页面。
- `read()` 中根据 `documentType === 'edgeless'` 强制设置只读的逻辑因此不能正确生效。
  普通页面和画布都可能包含 `affine:page` 根块，不能仅凭该块判断模式。

### 修复方法

1. 从真实的 `docProperties.primaryMode` 获取模式，与前端保持一致，兼容旧版属性来源、
   新旧属性优先级及缺省值。优先复用现有属性读取能力，不增加第二套模式存储。
2. 列表、元数据描述、正文读取及写入检查复用同一套模式解析逻辑。画布返回正确的
   `documentType`，读取时明确 `contentWritable: false`；正文替换按现有公开契约拒绝。
3. 写入时在事务内重新读取权威模式状态，不信任客户端此前取得的 `contentWritable`。
   用户在读取之后切换模式时，不能继续按旧类型条件执行正文替换。
4. 将决定模式的相关状态纳入并发保护：核对当前属性表及旧版属性的读写路径，使用
   一致的锁顺序保护检查到写入之间的状态，并使有效模式变化影响文档版本校验或触发
   明确的类型拒绝。仅仅“在事务内读一次”并不能保证并发安全；Web、同步及 MCP 路径
   必须遵守相容的锁与版本规则，不能让锁内检查完成后模式变化仍被忽略。
5. 保留现有 Markdown 无损往返和结构检查。普通页面通过类型检查，不代表其中的表格、
   嵌入块或其他复杂内容都适合直接替换。

此修复限定 MCP 直接正文替换的类型边界，不禁止用户在产品界面编辑画布，也不据此
新增标题修改、页面与画布切换等操作的限制。

### 聚焦验收

- 普通页面返回正确类型，兼容 Markdown 的内容继续正常读写。
- 将兼容 Markdown 的页面切换为画布后，即使只有文字，也返回画布类型并拒绝正文替换。
- 带图形、复杂块的画布继续受类型和结构检查保护，拒绝请求不产生正文副作用。
- MCP 读取之后、提交更新之前切换模式：旧请求因版本或类型条件被拒绝。
- 并发模式切换与正文写入遵守确定的事务顺序，不发生检查与实际写入状态不一致。
- 当前属性、仅有旧版属性、两者并存以及缺省模式均与前端解析行为一致。
- 列表、正文读取和写入判断类型一致；既有标题修改及前端画布编辑没有无关回归。

以上为原始修复要求，实施与验证结果见文末。

## 2026-09-17 修复与验收记录

### 实施内容

- `core/sync/gateway.ts`：客户端与服务端/outbox 的 Workspace 更新统一进入
  `broadcastWorkspaceDocUpdate()`。按服务端认证身份检查有效用户、`Workspace.Sync`、
  `projectScope(null)` 下的 `Doc.Read`；同次投递按用户去重。目录额外保留完整表权限，
  两种协议的编码、压缩、发送者排除和 Userspace 路径保持既有行为。
- `core/doc/workspace-resource.ts`：文件夹和同更新时间的文档统一按 ID 编码单元排序；
  加密认证游标增加 `sortVersion: 2`，缺少版本或版本不符返回既有公开错误 `cursor_stale`。
  类型和文档版本使用真实属性解析得到的有效页面/画布模式。
- `core/doc/workspace-organization.ts`：复用既有存储加载和属性表 ID 规则读取
  `docProperties.primaryMode`，兼容旧版根文档属性、非空覆盖、删除标记及缺省页面模式。
  正文事务依次持有根文档、正文、属性表的既有 PostgreSQL 内容锁，模式写入复用同一锁。
  原有存储层已让 Web 同步、服务端更新和 native 快照写入遵守这些内容锁，无须新增锁服务、
  数据表或迁移。
- `plugins/copilot/mcp/resources.ts`：文档列表使用既有 `observe()` 的 Repeatable Read
  只读快照，读取全部已提交更新且不压缩快照，不在遍历多篇正文时持有“属性表→下一篇正文”
  的反向锁序。单次请求的一致快照不延伸为跨页快照。
- 对应回归测试位于 `__tests__/sync/gateway.spec.ts` 和
  `__tests__/copilot/copilot-mcp-resources.e2e.ts`；公开客户端说明与直接资源产品契约已同步。

上述实现与测试路径均相对于 `packages/backend/server/src/`。

### 覆盖与结果

最终一轮 **84 项测试全部通过**：资源 E2E 35 项、资源 Schema/Markdown 8 项、
同步网关 25 项、目录服务 10 项、目录权限模型 6 项。

- 真实 WebSocket 覆盖 `sync-025`、`sync-026` 和客户端、服务端、持久 outbox 三种入口。
  验证无权用户、加入后撤权、outbox 入队后撤权、用户停用、工作区成员停用均不接收载荷；
  Project 单独授予的读取权不扩大 Workspace 广播范围。覆盖多连接、伪造客户端身份字段、
  发送者排除、目录权限和原有 Userspace 测试。
- PostgreSQL 固定资源 ID 包含大小写、数字、`_`、`-` 和共同前缀。每页 1、5、6、12、100
  项遍历验证集合、顺序、去重和终止；覆盖同时间/不同时间、空结果、目录/externalId 过滤、
  200 候选扫描预算后的空页续读、旧排序游标拒绝及实际密文篡改拒绝。
- 当前属性、仅旧属性、非空覆盖、空字符串、null、删除行和缺省模式验证通过；列表与读取
  类型一致，画布正文请求拒绝且正文不变，标题仍可修改。新旧属性分别覆盖模式事务先提交和
  正文事务先提交，使用真实数据库锁和显式并发屏障验证，不依赖任意 sleep 推测先后顺序。
- 后端 TypeScript 项目及资源 E2E 文件类型检查通过；6 个修改的 TypeScript 文件的
  `yarn lint:ox`、全部 9 个本轮文件的 Prettier 检查、`git diff --check` 均通过，无冲突标记。

### 验证环境和命令

复用固定镜像 `localmind-affine:test`，新增隔离 runner `localmind_code_review_runner`；
从已有测试容器复用 Linux native addon，复制当前源码并按当前 schema 生成 Prisma Client。
使用独立数据库 `code_review_20260917`，成功从零应用仓库现有 371 个迁移。未重建任何镜像，
未同步运行环境，未修改已有数据库或删除 volume。此次没有 schema/native 源码变化。
测试结束后停止本轮 runner，保留独立测试数据库及容器以供复现；复跑前先启动该 runner。
验证结束时 `docker system df`：Images 58.4 GB、Containers 13.76 GB、
Local Volumes 3.472 GB、Build Cache 2.913 GB；没有清理镜像、缓存或 volume。

```sh
docker exec localmind_code_review_runner yarn workspace @affine/server prisma generate
docker exec localmind_code_review_runner yarn workspace @affine/server prisma migrate deploy
docker exec localmind_code_review_runner yarn workspace @affine/server ava \
  --concurrency=1 --serial --timeout=2m \
  src/__tests__/copilot/copilot-mcp-resources.e2e.ts \
  src/__tests__/copilot/copilot-mcp-resources.spec.ts \
  src/__tests__/sync/gateway.spec.ts \
  src/core/doc/__tests__/workspace-organization.spec.ts \
  src/__tests__/models/workspace-directory-grant.spec.ts
docker exec localmind_code_review_runner yarn tsc -b \
  packages/backend/server/tsconfig.json --pretty false
docker exec localmind_code_review_runner yarn workspace @affine/server \
  typecheck:copilot --file src/__tests__/copilot/copilot-mcp-resources.e2e.ts
```

runner 中设置 `NODE_OPTIONS=--import=/workspace/tools/cli/register.js`。
遵守的 active contract 为
[直接资源产品契约](ai-modernization/mcp-direct-resource-tools-design.zh-CN.md)，
验证遵守 [AI 验证规则](ai-modernization/validation.md) 和
[Docker 约束](localmind-docker-development-constraints.md)。

### 兼容性与边界

- 客户端遇到 `cursor_stale` 必须丢弃游标并从第一页重启；本次版本凭据加入模式后，旧凭据
  应重新读取。正文版本冲突后使用新版本、新幂等键重新提交，不复用已记录失败的请求键。
- 广播权限检查与网络发送不具备原子性；检查之后并发发生的撤权不能收回已经发送的数据。
  未声称已发送的 CRDT 更新可远程撤销，未提供跨请求的分页快照。
- 本轮为源码与 Linux 聚焦验证；未部署至用户运行环境，未做多节点 Redis Socket.IO
  广播压测或浏览器手工验收。生产规模下逐接收者 ACL 检查的延迟仍需独立测量。
- 保留工作区原有文档改动；未执行 commit、push、远端操作或运行环境同步。
