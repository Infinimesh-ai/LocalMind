# MCP 直接资源工具实现与验证记录

日期：2026-09-17（UTC；开发机当地时间 2026-09-16）。基线：`6762e73e98`。

已按 [设计契约](mcp-direct-resource-tools-design.zh-CN.md) 实现。新增功能默认关闭，
本次未升级运行环境、签发凭据、提交真实日志、提交代码或推送远端。

## 实现结果

- MCP 服务版本为 `3.5.0`。新增 10 个独立授权的 Workspace 资源工具，保留原有
  3 个 AI 委托工具。工具发现与调用均检查实际 capability；资源入口不进入模型、
  BYOK、AI session、AgentRun 或委托回调流程。
- `LOCALMIND_MCP_RESOURCES_ENABLED` 默认关闭。关闭新业务入口后，已授权的
  `workspace_operation_get` 仍可核对既有结果。
- 旧客户端缺省能力、历史空能力和凭据轮换保持原来的委托能力集合；不自动扩权、
  撤销凭据或改写在途委托。设置界面分别显示资源与委托能力，独立勾选；写能力只
  提示授权操作查询，不暗中附加权限。现有 GraphQL 字符串数组契约无需变化。
- 资源应用服务复用实时 Workspace/文档/目录权限、DocWriter 和目录领域逻辑。
  内部目录创建及文档移动适配器共享相同领域方法，保留内部参数、会话及审计语义。
- 写入将正文、标题、根注册、目录位置、externalId、成功回执与事件置于同一事务。
  操作身份先持久化并预分配资源 ID；同键恢复、终态重放、不同请求冲突和业务标识
  墓碑由真实 PostgreSQL 唯一约束、外键、条件更新及不可变证据触发器保护。
- 权威读取合并 snapshot 与全部已提交 pending updates，避开缓存和读取时快照合并。
  HMAC 版本与正文来自同一快照；数据库内容锁覆盖 TypeScript 写入及 native 合并。
  原生合并遇到并发锁时返回可重试的数据库错误，避免反向锁序死锁。
- 提交后的同步通知与合并任务使用持久化 outbox，失败保留记录供后续重试。查询操作
  使用独立只读快照，不等待活动写事务、推进状态或触发恢复执行。
- 列表和关键词检索逐项执行实时权限过滤，绑定作用域的游标不承载明文路径。
  无索引时使用有界关键词降级，并标注覆盖范围；不调用 embedding。

主要代码入口：

| 范围                        | 文件                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 注册、协议及适配器          | `src/plugins/copilot/mcp/{provider,controller,capabilities,resource-schema,resources}.ts`                  |
| 领域、Markdown 与提交后事件 | `src/core/doc/{workspace-resource,resource-markdown,workspace-organization,transaction-context,outbox}.ts` |
| 身份与持久化                | `src/models/{mcp-resource-operation,workspace-doc-outbox,doc}.ts`                                          |
| 迁移                        | `migrations/20260917010000_mcp_direct_resources/migration.sql`                                             |
| 用户界面                    | `packages/frontend/core/src/desktop/dialogs/setting/workspace-setting/integration/mcp-server/`             |

前四项路径相对于 `packages/backend/server/`。已同步 AGENTS 导航、当前状态、文档地图、
中英文 MCP 接入说明及工具参考。使用的 active track 为 Agent Runtime 与 Project Native
Resources，Workspace 写入授权边界继续按现有 remediation 契约执行。

## Linux 聚焦验证

复用固定镜像 `localmind-affine:test`，没有构建新镜像或新增镜像 tag。测试源码复制到
隔离 runner 的 `/workspace`；使用独立 PostgreSQL/Redis 和网络，与运行环境无连接。

以下命令在隔离 runner 中通过。AVA 所需导入器通过
`NODE_OPTIONS=--import=/workspace/tools/cli/register.js` 设置。

```sh
yarn workspace @affine/server prisma generate
yarn workspace @affine/server prisma migrate deploy
yarn workspace @affine/server ava --concurrency=1 --serial --timeout=2m \
  src/__tests__/copilot/copilot-mcp-resources.e2e.ts \
  src/__tests__/copilot/copilot-mcp-resources.spec.ts \
  src/__tests__/copilot/copilot-workspace-folder-tools.spec.ts \
  src/__tests__/copilot/copilot-mcp-delegation.e2e.ts \
  src/__tests__/copilot/direct-mcp-source-boundary.spec.ts \
  src/__tests__/copilot/mcp-tools.spec.ts
yarn workspace @affine/server ava --serial --timeout=2m \
  src/__tests__/copilot/copilot.spec.ts --match='*MCP*'
yarn workspace @affine/server ava --concurrency=1 --serial --timeout=2m \
  src/__tests__/copilot/copilot-external-mcp.spec.ts \
  src/__tests__/copilot/copilot-external-mcp-resolver.spec.ts \
  src/__tests__/copilot/copilot-enterprise-cli.spec.ts
```

结果分别为 **88、3、50 项通过，共 141 项**。其中新增资源端到端测试 24 项、
能力与 Markdown 单元测试 8 项。覆盖：

- HTTP endpoint/token 绑定、严格参数、工具子集、默认关闭、仅查询凭据、旧凭据轮换；
- 无 BYOK 且模型调用被禁止时的读写成功，以及 AI session/run/callback 数量不变；
- 真正 PostgreSQL 事务中的创建归档故障回滚、同键并发、externalId 竞争和墓碑；
- 文档与目录版本冲突、标题/正文竞争、超过 100 条 pending updates 的完整读取、
  native 快照写入互斥及合并前后版本稳定；
- 锁等待期间撤权、凭据撤销、用户停用、隐藏源位置导致整次移动拒绝；
- 两个独立子进程分别在提交前和提交后被 `SIGKILL`，原键恢复均只有一个真实文档；
- 活动重复调用与只读查询、跨 family 隔离、失去结果读取权后的统一拒绝；
- 回执不可改写、审计不可删除、错误 externalId 成功绑定被数据库拒绝、通知失败重试；
- 搜索过滤、降级覆盖、纯文本摘要、分页过期、正文边界及不支持结构的零写入；
- 原委托优化更新、tool-agent、附件、冻结能力、取消、签名回调，以及 Enterprise/
  SparkClaw 授权、动态工具调用、外部操作轮询和撤权取消路径。

外部服务路径使用测试服务或桩；未对真实 Enterprise/SparkClaw 账号执行操作。

## 旧库升级与 schema 核对

在一次性 `mcp_resources_upgrade` 数据库中先应用基线 370 个迁移，然后加载
[升级 fixture](../../packages/backend/server/src/__tests__/copilot/fixtures/mcp-resource-upgrade.fixture.sql)，
再应用当前第 371 个迁移，并执行
[升级验证 SQL](../../packages/backend/server/src/__tests__/copilot/fixtures/mcp-resource-upgrade.verify.sql)。

```sh
# 基线目录仅含旧 schema 和旧的 370 个迁移，数据库连接指向一次性测试库。
yarn workspace @affine/server prisma migrate deploy --schema /tmp/localmind-resource-upgrade/schema.prisma
psql "$MCP_UPGRADE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f src/__tests__/copilot/fixtures/mcp-resource-upgrade.fixture.sql
yarn workspace @affine/server prisma migrate deploy
psql "$MCP_UPGRADE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f src/__tests__/copilot/fixtures/mcp-resource-upgrade.verify.sql
```

验证 SQL 完整比较显式旧凭据与在途委托行，确认均未变化；历史空能力固化为旧三项，
没有撤销凭据，也没有伪造资源操作。升级和验证均通过。

另执行 `prisma migrate diff --from-url <一次性测试库> --to-schema-datamodel schema.prisma --script`。
新增 MCP/outbox 模型无 schema 差异；outbox 外键的 `onUpdate: NoAction` 已显式对齐。
全库 diff 仍包含仓库既有的自定义外键、索引和此次升级证据临时表；未执行该 diff，
也未借此改动既有数据库结构。Prisma Client 通过正式生成命令更新。

## 静态检查及界面验证

以下检查通过：

```sh
yarn tsc -b packages/backend/server packages/frontend/core --pretty false
yarn workspace @affine/server typecheck:copilot --file src/__tests__/copilot/copilot-mcp-resources.e2e.ts
yarn workspace @affine/server typecheck:copilot --file src/__tests__/copilot/fixtures/mcp-resource-process.ts
yarn vitest run packages/frontend/core/src/desktop/dialogs/setting/workspace-setting/integration/mcp-server/capabilities.spec.ts
yarn workspace @affine/i18n build
yarn lint:ox <本次修改的 TypeScript 文件>
yarn prettier --ignore-unknown --check <本次修改的文件>
git diff --check
```

前端能力测试 **5 项通过**。中英文文本及 i18n 生成产物同步更新；未手改生成类型。

使用实际凭据弹窗与组件库搭建仓库外的隔离预览，以模拟创建响应验证四种组合：
1280×960 中文浅色、英文深色；390×844 中文深色、英文浅色。浏览器检查及截图均完成。
断言 13 项能力、旧三项默认选择、点击标签选择、查询提示不自动授权、提交中禁用、
重复提交抑制、成功展示、无横向溢出及无页面错误。既有设置页加载、空和错误分支保持
原实现；本次没有运行完整生产设置页的网络端到端测试。

本地预览与截图位于 `/Users/dev2/.codex/tmp/localmind-mcp-ui/`，未加入产品构建。

## 既有失败与剩余限制

完整 `copilot.spec.ts` 有 13 项失败。将隔离 runner 中改动的后端代码替换成
`6762e73e98` 基线后，重新运行该套件得到相同 13 项失败，再恢复当前实现。
失败涉及上下文文件/记忆断言、provider 查找、tool bridge 元数据、cron、图像路由、
订阅策略、prompt 模型/预算和 action diagnostics；部分依赖未配置的 BYOK。
这些不是本次新增回归，未扩展范围修复。不能将本次聚焦通过描述为全仓测试通过。

首期正文仅支持通过无损语义往返检查的 Markdown 子集，包括普通段落、标题、列表及
已验证的行内格式。当前 native 解析器的代码块往返存在换行漂移，因而代码块正文为
只读，创建或替换时拒绝；图片、HTML、表格、嵌入及其他不支持结构也不允许损失性写入。
Office、Project、附件、删除及恢复工具仍不属于本期范围。

直接读写有 1 MiB UTF-8 正文限制；权威 Yjs 读取有 32 MiB/10,000 条记录预算。
未进行大规模容量或生产负载测试。数据库锁触发器和 outbox 的实际负载影响需在受控
启用时观察；native addon 本身没有修改或重编译。

Docker 磁盘在验证结束前为：镜像 57.77 GB、容器 13.13 GB、volume 3.472 GB、构建缓存
2.913 GB。Docker VM 的可写磁盘空间不足曾导致临时 PostgreSQL 初始化失败，改用专用
宿主机临时目录绑定后完成验证。没有删除任何 volume、运行服务数据或无关镜像。

后续部署须另行安排备份、固定镜像构建/运行同步、迁移、新功能开关和显式凭据授权。
本次没有执行 `localmind:sync:*`，也没有更改现有用户工作流或本机日志 skill。

本次创建的三个测试容器及专用网络已移除，临时界面预览已停止；未删除 volume。
验证日志保留在 `/Users/dev2/.codex/tmp/localmind-mcp-resources-validation/`，临时数据库
绑定目录仍保留，便于追溯。

## 后续：过时断言修复

按用户要求，仅修复 `copilot.spec.ts` 的四类过时断言，未调整生产逻辑或其余测试 fixture：

- Tool bridge 精确检查补入的 `toolCallId`，同时确认调用者 options 未被修改。
- Cron 预期补齐 Project 索引、Project agent、MCP 回调和外部 MCP 轮询四项任务，保留参数、jobId、顺序及次数检查。
- 图像路由上下文预期补齐 `sessionId`、`projectId`，保持精确比较。
- 成功和失败两组 action diagnostics 预期均补齐 `waiting_for_location` 状态及对应投影差异。

复用 `localmind-affine:test`，在隔离 PostgreSQL/Redis 中运行：

```sh
docker exec -w /workspace \
  -e NODE_OPTIONS=--import=/workspace/tools/cli/register.js \
  localmind_mcp_assertions_runner \
  yarn workspace @affine/server ava --serial --timeout=2m \
  src/__tests__/copilot/copilot.spec.ts \
  --match="tool bridge should execute with parsed zod args and preserve callback response metadata" \
  --match="should handle copilot cron jobs correctly" \
  --match="capability policy host should select image routes with image output type" \
  --match="resolver action runs should expose recent sanitized workspace scoped diagnostics"
```

结果：**4 项通过**。文件级 oxlint、Prettier 和 `git diff --check` 通过。
原 13 项失败中的其余 9 项本轮未修改、未重跑，不据此宣称完整套件通过。
没有重建镜像、同步运行服务或修改真实模型配置。
验证日志：`/Users/dev2/.codex/tmp/localmind-mcp-resources-validation/localmind-assertions-validation.log`。

## 后续：本地日志 HTTP 实测与 skill 兼容性

仅在 Docker 内部隔离网络 `localmind_log_local_test` 启动当前源码，未调用任何远端
LocalMind MCP，也未调用 `delegate_to_localmind`。现有 3011 服务未同步、未重启。
复用 `localmind-affine:test`，使用专用 `mcp_log_local` 测试数据库，并应用全部迁移。

服务通过 `yarn r packages/backend/server/src/__tests__/copilot/fixtures/local-log-http.ts`
运行仓库外临时脚本的容器副本。它使用真实 AppModule、MCP controller、权限和数据库，
以测试 bootstrap 替换邮件和后台队列；因此本次验证的是源码 HTTP 资源接口，不是完整
生产 worker/索引/UI 部署验收。生成专用资源凭据，仅授权 10 项 `workspace_*` 工具。
模型运行入口设置为拒绝调用，Docker internal 网络阻止出站访问。客户端在同一容器
通过 `http://127.0.0.1:3010/api/workspaces/<workspaceId>/mcp` 发出真实 HTTP 请求。
内部网络未向宿主机开放预期的 3014 端口，所以没有将其描述为宿主机可访问地址。

使用现有 skill 的本地目标解析器和四章节模板，将本任务的有据摘要保存为测试日志。
本地成员配置有效，团队时区为 `Asia/Shanghai`，解析日期为 `2026-09-17`。
验证结果：

- 逐层创建部门、成员、月份目录，文档创建与月份归档成功。
- 文档 ID：`V_tuEPlAe-tnPEBJiZZRE`。
- 操作 ID：`931c68bc-6c0d-4997-b1cd-ecbd43d1b78f`。
- 读回文字和四章节一致；Markdown 导出规范化列表符号及空行，不是字节完全一致。
- 同键重试返回相同 documentId 和 operationId；externalId 查询只有一篇文档。
- `workspace_operation_get` 返回成功回执。
- 数据库共 4 个直接操作（三个目录与一个文档），AI session、AgentRun、MCP delegation
  均为 0。没有真实远端日志提交。

结果证据：`/Users/dev2/.codex/tmp/localmind-mcp-resources-validation/localmind-local-log-result.json`。

现有 `/Users/dev2/.codex/skills/localmind-team-daily-log/SKILL.md` 仍要求首个调用为
`delegate_to_localmind`；其幂等脚本也针对委托请求正文。因此现有 skill 原样不能完成
“Codex 总结后直接调用资源接口”的新路径。本次仅检查，没有修改个人 skill。

适配应保留总结、脱敏、日期、标题及模板规则，改用逐层 folder_list/folder_create、
externalId/documentId 定位、doc_create 或 read + expectedVersion + doc_update，最后
operation_get/read 核对；不同操作和请求内容应生成独立幂等键，禁止失败后转 delegate。
旧文档应分页精确匹配标题以避免重复，不能将有界关键词搜索无结果视为不存在。

旧 skill 的两项更强约定还需明确处理：直接接口不暴露持久化位置 index，也不提供重排，
所以不能证明或修复补交日志的日期顺序；move_document 会收敛到一个目标位置，与旧规则
“保留其他位置”不同，不能作为无条件归档步骤。已有正确归档的文档只更新正文即可。
当前可以验证内容保存及目标目录；完整日期排序仍应报告未验证，或另行扩展排序能力。

没有重建镜像、改动运行配置或修改个人 skill；本地测试凭据在验证结束后撤销。

## 后续：直接日志 skill、用户与连接配置验证

经用户明确授权，已更新个人 skill
`/Users/dev2/.codex/skills/localmind-team-daily-log/`，保留自动触发、成员身份、时区和模板。
改动包括 SKILL、policy、连接说明、UI 依赖声明、直接 MCP 客户端、每日提交脚本及 v3
幂等键脚本。删除强制委托流程及远端连接器依赖；客户端不允许 delegate，并在 localOnly
配置下于发出请求前拒绝远端地址。没有调用远端 LocalMind。

原 skill 和成员配置备份：
`/Users/dev2/.codex/tmp/localmind-skill-direct-backup-20260916205130/`。

本地源码测试服务保留运行在 `http://127.0.0.1:3014`，复用 `localmind-affine:test`，未重建
镜像。容器为 `localmind_skill_local_runner`、`localmind_skill_local_postgres`、
`localmind_skill_local_redis`；数据库为独立的 `mcp_skill_local`。现有 3011 服务未修改。
服务仍使用测试 bootstrap（邮件及后台队列桩），不是生产 UI/worker 部署；不要将测试
bootstrap 重跑作为生产重启操作，它会重置专用测试库。

通过 AuthService 创建本地测试用户 `codex-local-daily-log@example.test`，为其创建独立
Workspace 和 MCP 凭据，仅授权 doc_list/read/create/update、folder_list/create、
operation_get 七项能力，未授权 delegate。

- 用户 ID：`77b8df63-c62b-416d-91c5-f0ed8cf03abc`。
- Workspace：`4491bf8b-4504-4951-b4d1-e8a5ad682139`。
- 连接文件：`~/.config/localmind/team-daily-local.connection.json`。
- 成员配置只新增 connectionFile，其他字段与备份逐项一致。
- Bearer token 与账号密码分别存储于独立的 0600 文件，没有写入 skill 或仓库。
- 此配置供 skill 的 HTTP 脚本使用，不修改 Codex 全局 MCP 服务器列表。

运行新增脚本的真实 HTTP 验证：

```sh
node /Users/dev2/.codex/skills/localmind-team-daily-log/scripts/direct-resource.mjs
node /Users/dev2/.codex/skills/localmind-team-daily-log/scripts/submit-daily-log.mjs \
  --content-file /Users/dev2/.codex/tmp/localmind-skill-daily-log.md
node /Users/dev2/.codex/tmp/localmind-skill-forward-test.mjs
```

测试日志 `2026-09-17｜member-01｜工作日志` 已保存至配置的部门/成员/月目录，文档 ID
`JnUb5PD3kwkxqG75rOMpB`。新建回执为 `acd7f829-bd06-4c7f-94ae-4fbc2c3ccbaa`，更新回执为
`74e624d6-5073-49f8-9b00-c74da84c3d8f`。

验证通过：新建及归档、同键重放、读回无变化、带版本更新、旧版本拒绝、未读回合并的
覆盖拒绝、delegate 本地拒绝、远端 URL 请求前拒绝。externalId 下始终只有一篇文档。
数据库中三个目录创建、一次文档创建、一次更新为五项成功；故意提交旧版本产生一项
预期失败回执。模型调用计数、AI session、AgentRun、MCP delegation 均为 0。

Skill Creator 验证器、JavaScript 语法检查、格式检查通过。行为结果保留于
`/Users/dev2/.codex/tmp/localmind-skill-validation.json`。直接工具缺少日期排序能力的限制
仍然保留，skill 明确报告“内容已保存，日期排序未完成”，未伪造排序成功。

## 后续：2026-09-17 编辑器日志可写性修复

现有编辑器日志被直接 MCP 判为 `unsupported_document_structure`：正文、层级和
行内格式可以往返，但编辑器默认属性及四个块元数据字段在 Markdown 重建时缺失，
严格属性比较因此拒绝更新。本轮沿用直接资源设计契约修复服务端，不改变能力授权、
ACL、版本、事务、回执或 outbox 边界。

- `src/core/doc/resource-markdown.ts` 按块类型规范化明确默认值，只排除四个经过
  类型检查且由更新路径维护的创建/修改元数据字段；未知属性、评论、非默认状态
  和原有有损 Markdown 类型仍拒绝。
- 原生匹配器对部分文本分段及默认属性的比较会将未修改条目当成改写。原生更新
  先作用于内存副本，再在同级块中按正文语义优先对齐未修改块，只把实际属性与
  子节点变化应用到原文档。保留未修改块的 ID、`Y.Text` 对象和创建/修改记录；
  维护修改/新增块的记录，不补造旧块缺失的创建历史。
- `src/core/doc/writer.ts` 增加内部增量准备回调，直接资源服务在既有锁及事务内
  使用上述更新方式；其他调用保持原生默认路径。无需数据库迁移、GraphQL 生成、
  Rust 改动或前端改动。
- 回归 fixture 使用合成的四章节日志，覆盖括号标题、粗体、链接后的普通文字、
  嵌套列表、插入/删除、空正文、勾选状态、旧元数据缺失、非默认状态拒绝、回读、
  幂等重放和版本冲突。分页 fixture 改为合并到已初始化的 CRDT，避免独立快照
  与后台合并冲突；outbox 断言允许后台清理已有事件，检查是否出现新增事件。

复用 `localmind_code_review_runner` 和固定镜像 `localmind-affine:test`，使用独立
`code_review_20260917` 数据库；未重建镜像或启动完整运行时。容器已有
`NODE_OPTIONS=--import=/workspace/tools/cli/register.js`。

```sh
docker exec localmind_code_review_runner yarn workspace @affine/server ava \
  --concurrency=1 --serial --timeout=2m \
  src/__tests__/copilot/copilot-mcp-resources.spec.ts \
  src/__tests__/copilot/copilot-mcp-resources.e2e.ts
docker exec localmind_code_review_runner yarn tsc \
  -b packages/backend/server/tsconfig.json --pretty false
docker exec localmind_code_review_runner yarn workspace @affine/server \
  typecheck:copilot --file src/__tests__/copilot/copilot-mcp-resources.spec.ts
docker exec localmind_code_review_runner yarn workspace @affine/server \
  typecheck:copilot --file src/__tests__/copilot/copilot-mcp-resources.e2e.ts
```

结果：58 项测试通过（21 项单元、37 项集成）；后端及两个测试文件类型检查、变更
TypeScript 的 oxlint、变更文件 Prettier 和 `git diff --check` 通过。

另在容器内用真实日志只读副本离线应用完整合并稿：更新前后均可写，正文与目标
一致，38 个原有块全部保留，34 个未修改正文块仍使用原 ID，原有创建记录保留。
统计说明按合并稿修改；没有把真实日志内容加入测试 fixture 或仓库。

本轮未 commit、push、部署或更新线上日志。上线后仍需重新读取最新正文及版本，
再合并、提交并核对回执。测试容器验证后停止，独立测试数据库保留供复现。
现有 Markdown 子集限制仍适用；Docker 虚拟磁盘观察到约 59 GB 已用满，本轮未
重建镜像、清理其他任务资源或删除数据卷，后续镜像构建前需先处理空间问题。
