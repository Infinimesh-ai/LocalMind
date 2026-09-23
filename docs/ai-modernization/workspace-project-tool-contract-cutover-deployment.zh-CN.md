# Workspace/Project AI 工具契约一次性切换部署手册

> 状态：部署方案，等待对应代码实现<br />
> 日期：2026-09-15<br />
> 对应设计：
> [Workspace/Project AI 写入授权与工具作用域重构方案](./workspace-project-ai-write-authorization-remediation.zh-CN.md)<br />
> 部署方式：一次性切换，不保留旧工具别名，不删除历史业务或审计数据

## 1. 目的

本手册用于部署“问题 3”的工具作用域重构：

- Workspace 会话只注册 `workspace_*` 模型可见工具；
- Project 会话只注册 `project_*` 模型可见工具；
- 删除 `doc_create`、`doc_read`、`doc_update`、`doc_update_meta` 等含糊旧名称的可执行
  能力；
- 同步升级 Agent Runtime、MCP delegation、tool snapshot、Schema 指纹、completion
  contract 和 checkpoint；
- 未终态旧契约任务在部署窗口内确定性收敛，不允许被新 worker 猜测恢复；
- 已完成历史记录继续保留原工具名，作为不可变审计证据；
- 保留 PostgreSQL、Redis、Blob、配置、Workspace 和 Project 原有数据。

这不是普通的“拉代码后重启”。旧工具名称已经持久化进入运行状态，部署必须处理正在
排队、运行、等待、重试或持有租约的旧任务，否则新 worker 会遇到以下问题：

- 冻结的 tool name 与新注册表不匹配；
- tool Schema fingerprint 与新名称对应的快照不匹配；
- completion contract 仍要求 `doc_read` / `doc_update`；
- checkpoint 恢复时找不到旧工具；
- 旧任务可能在切换后执行成另一个作用域的资源操作；
- MCP 查询、回调和 Agent Runtime 状态可能无法一致到达终态。

## 2. 部署不变量

整个部署过程必须遵守：

1. 只部署已经通过测试并位于 `main` 的明确提交；
2. 使用唯一生产 Compose 文件 `.docker/selfhost/compose.localmind.yml`；
3. 使用固定 runtime 镜像 `localmind-affine:local`；
4. 更新前创建非空 PostgreSQL 逻辑备份，并备份 Blob、配置和企业连接器目录；
5. 不执行 `git reset --hard`、`git clean -fd`、`docker compose down -v`；
6. 不删除 volume、bind mount、数据库目录、Blob 或历史 Agent Runtime/MCP 行；
7. 不原地改写历史终态 task 的 tool name、fingerprint 或 result；
8. 不用旧名称 alias、双写或 prompt 兼容层延长迁移；
9. 不让旧 worker 与新 worker 同时领取 Agent Runtime/MCP 任务；
10. migration、Compose、HTTP、日志和产品验收全部通过后才宣布完成；
11. 任何 secret、数据库连接串、MCP token、模型 key 和 `.env` 内容都不得出现在部署
    输出或报告中；
12. 预计 Docker 构建新增数据超过 30 GB 时停止并报告，不删除持久化数据换空间。

## 3. 发布产物必须先具备的能力

部署前，代码提交必须已经包含以下内容。缺少任一项时不得进入生产切换。

### 3.1 新工具契约

- Workspace 和 Project 模型可见工具采用明确前缀；
- ToolRuntime 按会话作用域注册互斥工具集合；
- 执行时再次校验会话类型、资源所有者和实时 ACL；
- 所有内置 prompt、工具说明、required-tool evidence 和结果投影已使用新名称；
- Project 显式发布工具独立存在，不允许普通 Workspace 工具隐式写回；
- 普通 Workspace 写入已移除 actor-only audience 门禁并保留实时 ACL。

### 3.2 新持久化契约版本

至少提升以下版本或等价的持久化版本标识：

- `localmind-tool-agent-request/v5` 的后继版本；
- tool-name snapshot 版本；
- tool capability/Schema fingerprint snapshot 版本；
- completion contract 版本；
- Project Agent Runtime command/tool contract 版本；
- 任何按工具名判断完成证据、conditional no-op 或 side effect 的版本。

新版本必须拒绝旧名称进入新任务。不能只改运行时注册表而继续生成 v5 旧名称快照。

### 3.3 旧任务收敛逻辑

代码或正式数据库迁移必须提供一个可重复、可审计的收敛过程，用于：

- 识别受影响的旧契约非终态 Agent Run；
- 将 run 置为 `failed`，失败码建议为 `tool_contract_retired`；
- 将 pending/running/waiting step 置为 `failed` 或按领域约束置为 `skipped`；
- 清除 worker lease、lease expiry 和不再有效的等待租约；
- 追加对应 timeline 终态事件；
- 将关联 MCP delegation 从 `processing`/等待状态收敛为 `failed`；
- 保存有界、无敏感内容的失败结果和指纹；
- 取消不再需要的 pending callback delivery 或发送一次准确的终态失败通知；
- 保证重复运行不会重复追加冲突事件，也不会把终态任务再次修改。

不得仅执行类似 `UPDATE ai_agent_runs SET status='failed'` 的手工 SQL。Agent Run、step、
timeline、execution result、MCP request、callback、lease 和 fingerprint 之间存在一致性约束，
必须通过正式迁移或领域模型原子处理。

### 3.4 新 worker 的 fail-closed 防护

即使部署前盘点结果为零，新 worker 也必须：

- 遇到旧 request/tool contract 的非终态任务时拒绝执行；
- 使用稳定错误码收敛，而不是进入无限重试；
- 不把旧 `doc_*` 自动映射为 `workspace_doc_*` 或 `project_doc_*`；
- 不因名称缺失跳过实时 ACL；
- 不修改历史 completed/failed/cancelled 任务。

## 4. 受影响的持久化状态

部署盘点至少覆盖：

| 状态                  | 主要持久化位置                          | 风险                                                 |
| --------------------- | --------------------------------------- | ---------------------------------------------------- |
| Agent Run             | `ai_agent_runs`                         | 旧 workflow 正在 queued/running/waiting/持租约       |
| Agent Step            | `ai_agent_steps.output_summary/input`   | request 版本、工具快照、completion contract 含旧名称 |
| Timeline              | `ai_agent_timeline_events`              | 终态必须与 run/step 一致且序号不可冲突               |
| Execution Result      | `ai_agent_runtime_execution_results`    | 结果、side-effect 状态和指纹不可伪造或覆盖           |
| MCP Request           | `ai_mcp_delegation_requests`            | `processing`/等待状态与 Agent Run 必须共同终态化     |
| MCP Tool Call         | `ai_mcp_delegation_tool_calls`          | 已执行调用保留旧名称，未完成调用不能继续恢复         |
| MCP Callback          | `ai_mcp_delegation_callback_deliveries` | 避免旧成功通知、重复通知或永久 retry                 |
| Redis/BullMQ job      | Redis 队列                              | 数据库终态化后仍可能存在旧 job，worker 必须幂等忽略  |
| Project Agent Runtime | Project run/step command snapshot       | 旧 `doc_*` 不能被新 Project worker 继续解释          |

历史终态行不迁移名称。旧字符串继续存在于查询和审计中是预期行为，不代表旧工具仍可执行。

## 5. 发布前验证

### 5.1 代码与工作区

在构建机或部署服务器的仓库根目录运行：

```sh
pwd
git status --short --branch
git remote -v
git rev-parse HEAD
git rev-parse main
docker version
docker compose version
docker system df
docker ps -a --filter name=localmind
```

停止条件：

- 仓库或远端不正确；
- 工作区存在无法确认来源的修改；
- 当前提交不是获准部署的 `main` 提交；
- Docker 不可用；
- 预计新增 Docker 数据超过 30 GB；
- 对应修复测试尚未通过。

### 5.2 Compose 配置

```sh
docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  config --quiet
```

不得打印完整 `.env`。配置解析失败时停止。

### 5.3 只读任务盘点

以下 SQL 是只读盘点示例。实际执行时通过 Compose 的 PostgreSQL 服务运行，不输出
actor、credential、request 正文或工具参数。

统计非终态 Agent Run：

```sql
SELECT workflow, status, count(*)
FROM ai_agent_runs
WHERE status NOT IN ('completed', 'failed', 'cancelled')
GROUP BY workflow, status
ORDER BY workflow, status;
```

统计 LocalMind tool-agent request 版本：

```sql
SELECT
  step.output_summary #>> '{localMindToolAgentRequest,version}' AS contract_version,
  run.status,
  count(*)
FROM ai_agent_runs run
JOIN ai_agent_steps step ON step.run_id = run.id
WHERE run.workflow = 'agent_runtime_localmind_tool_agent'
  AND run.status NOT IN ('completed', 'failed', 'cancelled')
GROUP BY contract_version, run.status
ORDER BY contract_version, run.status;
```

统计未终态 MCP 请求：

```sql
SELECT status, count(*)
FROM ai_mcp_delegation_requests
WHERE status IN ('processing', 'waiting_approval', 'waiting_for_location')
GROUP BY status
ORDER BY status;
```

统计尚未完成的旧名称 MCP tool call：

```sql
SELECT tool_name, count(*)
FROM ai_mcp_delegation_tool_calls
WHERE completed_at IS NULL
  AND tool_name IN (
    'doc_create',
    'doc_read',
    'doc_update',
    'doc_update_meta',
    'doc_keyword_search',
    'doc_semantic_search',
    'doc_trash',
    'doc_restore',
    'doc_delete_permanently'
  )
GROUP BY tool_name
ORDER BY tool_name;
```

还应由发布代码提供结构化 dry-run，按主键关联检查 run、step、MCP request、tool call、
callback 和 lease，输出数量与指纹摘要，不输出正文或参数。纯 SQL 文本搜索只能辅助盘点，
不能替代正式收敛逻辑。

### 5.4 盘点决策

- 受影响非终态任务为 0：继续部署；新 worker 的 fail-closed 防护仍必须存在。
- 受影响非终态任务大于 0：记录数量，告知任务会以 `tool_contract_retired` 失败，进入
  计划停机窗口后执行正式收敛。
- 存在无法归类的 workflow、未知 request 版本或状态不一致：停止部署，先修复迁移逻辑。
- 不允许为了让数量变成 0 而删除数据库行、Redis volume 或整个队列。

## 6. 备份

### 6.1 PostgreSQL 逻辑备份

在仓库根目录执行：

```sh
mkdir -p backups
LOCALMIND_TOOL_CUTOVER_BACKUP="backups/localmind-tool-cutover-$(date -u +%Y%m%dT%H%M%SZ).sql"
docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$LOCALMIND_TOOL_CUTOVER_BACKUP"
test -s "$LOCALMIND_TOOL_CUTOVER_BACKUP"
```

记录备份文件的绝对路径、字节数和 SHA-256，不输出备份内容。

### 6.2 文件与配置备份

确认服务器备份系统已经覆盖：

- `.docker/selfhost/.env`；
- `UPLOAD_LOCATION`；
- `CONFIG_LOCATION`；
- `DB_DATA_LOCATION`，仅作灾备，不能替代一致的 `pg_dump`；
- `ENTERPRISE_CLI_DATA_LOCATION`；
- 启用 ISCP 时的 `iscp_state` volume。

备份失败、文件为空或无法确认恢复路径时停止。

## 7. 构建与离线验证

### 7.1 测试镜像

优先复用 `localmind-affine:test`，在隔离 PostgreSQL/Redis 中运行：

- 工具注册矩阵测试；
- 新旧 contract parser 和 fail-closed 测试；
- 未终态任务收敛的 migration/model 测试；
- Agent Runtime lease/checkpoint/retry 测试；
- MCP completion evidence、查询、取消和 callback 测试；
- Workspace 实时 ACL 与 Project 边界测试；
- 真实备份恢复后的升级演练；
- Prisma migration 全量和旧版本升级验证；
- TypeScript、oxlint、Prettier 和 `git diff --check`。

### 7.2 Runtime 镜像

本次变更涉及 worker 恢复和运行时工具契约，属于里程碑部署，需要构建固定 runtime 镜像：

```sh
docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  build affine
```

记录：

- 构建提交 SHA；
- 构建前后 `docker system df`；
- `docker image inspect localmind-affine:local --format '{{.Id}}'`；
- 构建命令和退出码。

构建失败不影响旧运行实例；保留旧容器和数据，不清库、不删 volume。

## 8. 一次性切换窗口

### 8.1 停止任务领取

当前 Compose 中 Agent Runtime/MCP worker 与主服务位于 `affine` 服务。为避免旧 worker
在盘点和收敛之间继续领取任务，停止主服务但保持 PostgreSQL、Redis、Blob 和配置：

```sh
docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  stop affine
```

不要执行 `down -v`。确认 `localmind_affine_server` 已停止，PostgreSQL 和 Redis 仍运行。

停止后重新执行第 5.3 节盘点，使用这一次结果作为切换基线。

### 8.2 执行正式收敛

通过发布产物提供的 migration/predeploy 逻辑或专用、可重复的维护命令执行 dry-run：

```text
mode=dry-run
expected_contract=<旧契约版本集合>
target_contract=<新契约版本>
```

核对 dry-run 数量与停服后的 SQL 基线一致，再执行 apply。正式命令名称必须由实现提交
提供，本手册不虚构尚不存在的脚本。

apply 必须在数据库事务和条件更新保护下完成，并输出：

- 扫描任务数；
- 实际收敛 run/request 数；
- 已经终态、因此跳过的数量；
- 并发条件不匹配数量；
- 新增 timeline/result/callback 数量；
- 结果摘要指纹。

输出不得包含 requestText、文档正文、工具参数、凭据或 secret。任何不一致都停止启动新
服务并保留现场。

### 8.3 运行数据迁移

启动 PostgreSQL、Redis 和 migration job，确认 schema/数据迁移成功后才启动主服务。
可以使用 Compose 正常依赖流程：

```sh
docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  up -d
```

`affine_migration` 必须退出码为 0。旧 Redis job 即使仍存在，也必须因数据库任务已终态而
被新 worker 幂等忽略；不得通过清空整个 Redis volume 处理旧 job。

## 9. 部署后技术验证

### 9.1 Compose、migration 和 HTTP

```sh
docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  ps --all

curl -fsS -o /dev/null http://127.0.0.1:3011/

docker compose \
  --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  logs --tail=300 affine affine_migration postgres redis sparkclaw_adapter
```

使用实际 `PORT` 替换 `3011`。必须满足：

- `localmind_affine_server` 正常运行；
- PostgreSQL、Redis、adapter 正常或 healthy；
- migration job 退出码为 0；
- HTTP 返回成功；
- 不存在 migration error、panic、restart loop、持续数据库/Redis 错误；
- 不存在旧 contract 无限重试或反复领取同一终态任务。

### 9.2 数据一致性

重新执行只读盘点并确认：

- 旧契约受影响的非终态 Agent Run 为 0；
- 旧契约受影响的 MCP request 不再处于 processing/等待状态；
- worker lease 已释放；
- 对应 step、timeline、MCP result 和 callback 状态一致；
- 历史终态 tool call 仍存在且内容未被改名；
- Workspace、Project、文档、目录、Office、Blob 和配置计数没有异常下降。

### 9.3 新工具快照

创建隔离测试任务并检查持久化证据：

- Workspace 任务的 `allowedToolNames` 只包含 `workspace_*` 及无作用域冲突的通用工具；
- Project 任务只包含 `project_*` 及允许的通用工具；
- 新 request version、tool snapshot version 和 completion contract version 正确；
- Schema fingerprint 与当前注册工具一致；
- 新 task、step、checkpoint 和 tool call 不出现旧含糊名称；
- Workspace/Project 相互调用返回稳定的作用域错误，不执行任何副作用。

## 10. 产品验收

至少使用隔离的多人 Workspace 和测试 Project 完成：

### 10.1 Workspace

- 读取、更新既有文档；
- 创建文档并挂入文件夹；
- 将跨任务既有文档挂入文件夹；
- 创建、重命名、移动、回收和恢复文件夹；
- 使用原 documentId 挂载 `2026-09-14｜member-02｜工作日志`；
- 验证普通授权写入不需要网页二次确认；
- 撤回 `Doc.Update` 或目录 `canOrganize` 后再次执行，确认实时 ACL 拒绝且零副作用。

### 10.2 Project

- Project 会话创建、读取、更新和移动原生资源；
- 确认模型只看到 `project_*` 工具；
- 确认 Workspace 工具不能直接操作 Project resourceId；
- 显式发布仍要求准确目标和目标实时 ACL；
- 导入仍检查来源复制/分享权限；
- Project 内部保存不会隐式修改 Workspace 副本。

### 10.3 MCP 与恢复

- 新 MCP 委托创建新契约 Agent Run；
- 查询、取消和终态通知正常；
- 普通可逆 Workspace 写入无需用户在 LocalMind 网页再次确认；
- 凭据 scope 或实时 ACL 撤回后正确拒绝；
- 人工注入的旧 contract 测试 fixture 被确定性 fail-closed，不无限重试；
- Redis 中重复 job 不重复执行副作用。

## 11. 观察窗口

部署后至少在一个完整任务执行周期内观察：

- `tool_contract_retired`、unsupported contract 和 tool-not-found 数量；
- Agent Run queued/running/waiting 数量是否持续积压；
- MCP request 是否长期停留在 `processing`；
- callback 是否持续 retry；
- worker lease 是否过期后无法收敛；
- Workspace/Project scope mismatch；
- ACL 拒绝是否来自真实权限，而不是 actor-only audience；
- 文档、目录和 Office 副作用是否存在重复提交。

出现以下任一情况立即停止新 AI 任务入口并进入故障处理：

- 新任务仍生成旧工具名；
- 同一 task 重复产生副作用；
- Project 工具操作 Workspace 资源或反向越界；
- migration/约束错误；
- 大量任务卡在 processing/running/waiting；
- 历史终态记录被改写；
- 用户无实时 ACL 仍能成功写入。

## 12. 回退边界

### 12.1 构建或迁移前失败

- 保持旧服务和旧数据；
- 修复构建/配置问题后重新验证；
- 不需要恢复数据库。

### 12.2 已停服但尚未 apply 收敛

- 可以重新启动旧镜像；
- 停机期间没有改变任务状态；
- 重新启动前确认没有运行新 migration。

### 12.3 已完成旧任务收敛

被置为 `tool_contract_retired` 的任务已经是明确终态，不应通过代码回退重新激活。即使回滚
应用代码，也保留这些终态和审计；需要用户重新提交任务。

### 12.4 migration 已执行或新任务已运行

不得只切回旧镜像并继续使用新 schema/新 contract 数据。回退必须同时评估：

- 数据库 migration 的向后兼容性；
- 新工具名任务和新 completion contract；
- 已产生的 Workspace/Project 副作用；
- Blob/配置与数据库的一致性；
- PostgreSQL 备份恢复点。

只有发生无法在线修复的数据一致性故障时才考虑完整恢复备份。恢复会丢失备份之后的合法
业务数据，必须由用户明确决定并协调停机窗口。任何回退都不得自动删除 volume。

## 13. 完成报告

部署报告至少包含：

```text
branch: main
commit: <sha>
design: workspace-project-ai-write-authorization-remediation
old_contracts: <版本列表>
new_contract: <版本>
preflight_nonterminal_count: <数量>
retired_run_count: <数量>
retired_mcp_request_count: <数量>
legacy_aliases_enabled: false
compose_file: .docker/selfhost/compose.localmind.yml
image: localmind-affine:local (<image-id>)
migration: passed | failed
containers: <状态摘要>
http_check: <URL 与结果>
workspace_acceptance: passed | failed
project_acceptance: passed | failed
mcp_acceptance: passed | failed
backup: <路径或备份标识>
docker_disk_before_after: <摘要>
remaining_risks: <none 或具体风险>
```

报告不能包含 secret、用户正文、完整工具参数、数据库连接串、MCP token 或模型凭据。

## 14. 完成条件

只有同时满足以下条件，问题 3 的部署才完成：

- 新旧 contract 已一次性切换，不存在运行时旧名称 alias；
- 所有受影响旧契约非终态任务已经安全终态化；
- 历史终态记录和业务数据完整保留；
- 新任务只持久化显式 Workspace/Project 工具名；
- Workspace/Project 注册和执行作用域互斥；
- MCP、Agent Runtime、checkpoint、completion evidence 和 callback 状态一致；
- Compose、migration、HTTP、日志和数据库一致性检查通过；
- Workspace、Project、MCP 真实验收通过；
- 备份有效，未删除任何 volume 或持久化目录；
- 完整部署报告已保存且不含敏感信息。
