# Workspace / Project AI 会话与上下文管理执行记录

执行日期：2026-09-22。

状态：P0—P4 已完成源码实现和隔离环境聚焦验证；P5 的生成物与文档同步已完成，真实模型质量评测、完整浏览器矩阵、真实业务备份恢复和运行环境同步尚未执行。本文不代表业务实例已经部署。

对应契约：[Workspace / Project AI 会话与上下文管理实施方案](workspace-project-context-session-remediation.zh-CN.md)。

## 1. 范围与环境

- 工作树：包含用户已有的大量未提交改动，本次未覆盖、丢弃、提交或推送无关修改；没有可引用的新 commit。
- Linux 验证容器：`localmind_office_surface_verify`，固定基础镜像 `localmind-affine:dev-base`，源码挂载到 `/workspace`。
- PostgreSQL：一次性数据库 `localmind_context_session_e2e_20260922_1017`；全量应用 390 个 migration。
- Docker 磁盘检查：Images 28.68 GB、Containers 1.121 GB、Volumes 6.519 GB、Build Cache 3.586 GB；未重建镜像、未删除 volume。
- 未执行 `yarn localmind:sync:*`、部署、业务数据库迁移、commit、push 或 PR。

## 2. 实施结果

| 阶段                  | 状态                    | 结果                                                                                                                                                                     |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 基线与预检         | 源码完成                | 只读 preflight 覆盖迁移状态、旧私人 Project Memory、重复 AiContext、隔离记录、删除/整理/归档积压、Blob 引用和恢复屏障回执；生产实例未运行。                              |
| P1 授权与共享记忆     | 源码完成                | 会话先授权；Project 以 `projectId` 共享一份 Memory；贡献、冲突、来源资格、Owner/成员权限、项目和会话开关均使用持久 revision/CAS。                                        |
| P2 升级与上下文一致性 | 源码完成                | 迁移区分旧共享、私人和未知数据，Workspace AiContext 唯一约束、Project 引用版本提示与显式刷新已接入。                                                                     |
| P3 删除与长期证据     | 源码完成、隔离演练通过  | 持久删除任务、hold/retry/receipt、运行 payload 清理、规范化 Project Blob 引用与最终复查、签名私有归档、Admin 状态及启动前恢复屏障已实现。                                |
| P4 滚动整理           | 源码完成、mock 质量验证 | provider-neutral 结构化摘要、预算、长资料分段/覆盖、持久任务/事件、租约/重试/取消/CAS、聊天 UI、断线恢复及跨项目迟到隔离已实现。                                         |
| P5 集成上线           | 部分完成                | Prisma/GraphQL/i18n 生成、Compose 持久挂载、runtime 恢复 CLI 和文档已同步；真实 Project BYOK 模型评测、全浏览器矩阵、真实备份+对象存储恢复及业务部署未获授权或缺少凭据。 |

## 3. 关键实现证据

- 数据与迁移：`20260921010000`—`20260921150000` 迁移，覆盖共享 Memory 纠正、唯一上下文、checkpoint/compaction、Blob 引用、签名归档和恢复屏障。
- 删除：`copilot-session.ts` 使用 `requested / purging / retry_wait / failed / held / completed`，删除请求立即提升 `contextEpoch` 并拒绝读取；Project 共享 Memory 不随个人会话级联删除。
- Blob：`ai_session_project_blob_references` 记录真实引用；仅无会话、资源 revision、附件、Office artifact/revision/command 引用的 Blob 才能进入待删除，物理删除后再次事务复查。
- 归档：私有归档目录必须显式配置并强制为 `0700`，文件保持 `0600`；归档文件包含批次、计数、时间范围和脱敏条目，以版本化 HMAC 密钥签名。worker 使用条件租约抢占，系统回读并校验文件后，数据库触发器才允许对已签名的 audit 归档放行热审计删除。
- 恢复屏障：签名文件只含会话删除、Memory 隔离和 grant 撤权标识，不含正文。源码脚本和打包后的 `context-session-recovery-barrier` CLI 均支持 export/verify/apply；设置 `LOCALMIND_RECOVERY_BARRIER_FILE` 时，服务在加载 `AppModule` 和启动 worker/读取入口前校验并重放；回执保证幂等。
- 整理：结构化摘要拒绝伪造来源/回执，按保守预算拆分超长消息，保存来源覆盖和遗漏范围；Project Memory revision、上下文版本、session epoch、来源 ledger 和 checkpoint 指针共同参与发布 CAS。
- UI：聊天显示 queued/running/completed/failed/cancelled/stale，支持手动整理、取消、失败重试、token 证据和可审阅摘要；Admin 显示会话删除任务、保全/备份状态和签名归档批次。

## 4. A01—A40 结果

“通过”表示有聚焦自动化断言；“部分”不等于上线验收。

| 编号 | 状态             | 证据或限制                                                                                          |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------- |
| A01  | 通过             | Project session 元数据对其他用户拒绝，且 Memory/source/message 计数不变。                           |
| A02  | 通过             | 错误 Workspace/Project wrapper 被拒绝，服务端从持久会话解析作用域。                                 |
| A03  | 通过             | 发送、工具和整理发布前重查删除、成员、epoch、lease/CAS。                                            |
| A04  | 通过             | fork 保留合法文档历史，同时拒绝跨用户/Project 转移私人历史和附件。                                  |
| A05  | 通过             | 同 Project 成员共享召回，原始会话、附件和 checkpoint 仍按 owner/session 隔离。                      |
| A06  | 通过             | session 与 Project 不可变绑定，跨项目上下文和迟到结果被拒绝。                                       |
| A07  | 通过             | Owner 管理共享库与设置；管理权限不扩展为读取他人会话/附件。                                         |
| A08  | 通过             | 单贡献、多贡献、版本竞争和贡献撤回均按 contribution/version 判定。                                  |
| A09  | 通过             | 原生 Project 路径不依赖 Workspace 成员资格或 Workspace Profile。                                    |
| A10  | 通过             | 项目/会话 capture revision 在写入事务内重查；主动保存继续走来源/DLP。                               |
| A11  | 通过             | project factKey、共享 identity、配额和 conflict 状态有约束及聚焦测试。                              |
| A12  | 通过             | 删除屏障、event 幂等和版本检查阻止重放复活；不能撤回他人贡献。                                      |
| A13  | 通过             | 新成员、退出、账号删除和 Owner 变化保留合法项目资产及真实作者证据。                                 |
| A14  | 通过             | 前向迁移按 writer/contract/provenance 分桶，未知/私人记录保持隔离。                                 |
| A15  | 通过             | 合法多作者共享链保留，真正私人/越权来源不恢复活跃召回。                                             |
| A16  | 通过             | 私人附件、个人 Rule、Project Policy、共享资源和摘要边界分别校验。                                   |
| A17  | 通过             | frozen/current sequence 与显式 refresh 保留历史版本定位。                                           |
| A18  | 通过             | refresh expectedVersion、撤权/删除重查及摘要依赖失效有断言。                                        |
| A19  | 通过             | AiContext `sessionId` 唯一约束和升级去重阻止并发重复。                                              |
| A20  | 通过             | 删除立即拒绝读取；lease 接管、重试、hold 解除和迟到结果拒绝有断言。                                 |
| A21  | 通过             | 专属 Project Blob 被物理删除，共享 Blob、revision 和独立资源保留。                                  |
| A22  | 通过             | 会话清理不级联共享 Memory；共享内容仍走独立贡献/Owner 流程。                                        |
| A23  | 通过             | 领域写入使用事务证据；相同 audit eventId 不同 fingerprint 明确冲突。                                |
| A24  | 通过             | 归档回读、篡改检测、旧 key 验证、密钥轮换和 legal hold/freeze 已测试。                              |
| A25  | 通过             | 多次 checkpoint 保留目标、纠正、未完成项和近期原文。                                                |
| A26  | 通过             | CJK 保守预算、tool schema 保留和小窗口切分有单测；真实多模态模型未评测。                            |
| A27  | 通过             | 任务持久状态、取消、失败重试、lease takeover 和调用前 checkpoint 已测试。                           |
| A28  | 通过             | 输入前缀、epoch、依赖、pointer CAS 阻止资料变化或并发消息后的旧结果发布。                           |
| A29  | 通过             | checkpoint 绑定 Project Memory revision/来源，恢复时重新校验，不共享摘要正文。                      |
| A30  | 通过             | 超长单消息无中段丢失；Project doc range 读取和 coverage/omission 明确。                             |
| A31  | 通过             | 摘要作为不可信上下文，schema 不含审批/授权/伪造执行回执字段。                                       |
| A32  | 通过（隔离演练） | 自动化重建删除前会话形态，签名屏障先拒绝读取再恢复 purge，重复应用幂等；未做真实业务 `pg_restore`。 |
| A33  | 通过             | Project BYOK 缺失时失败，不回退 Workspace、用户或平台模型。                                         |
| A34  | 通过（自动化）   | 前端迟到结果、切 Project、轮询/重连和成员撤销隔离有测试；真实浏览器矩阵未跑。                       |
| A35  | 部分             | 新增 payload/归档/状态接口只暴露脱敏计数；尚未做完整运行日志/support bundle 全链路扫描。            |
| A36  | 未运行           | 缺少本任务明确授权且可用的真实 Project BYOK；未用 mock 冒充质量、成本或延迟评测。                   |
| A37  | 通过             | pending conflict 不召回，Owner 解决使用版本检查，贡献撤回不删除他人贡献。                           |
| A38  | 通过             | 旧私人 Memory/Rule/Summary 进入隔离与明确发布边界，不允许 Owner 代确认。                            |
| A39  | 通过             | Project Memory revision 传播使全部依赖 checkpoint 失效，通知不含他人会话正文。                      |
| A40  | 通过             | Project Memory 可共享；会话、附件、滚动摘要私有，敏感/不可共享来源被拒绝。                          |

## 5. 验证命令与结果

已通过：

```sh
yarn workspace @affine/server prisma format --schema schema.prisma
yarn workspace @affine/server prisma generate --schema schema.prisma
yarn workspace @affine/server prisma validate --schema schema.prisma
yarn tsc -b packages/backend/server/tsconfig.json --pretty false
yarn workspace @affine/server typecheck:copilot
# Copilot test typecheck passed (76 files)
yarn workspace @affine/server build
yarn workspace @affine/graphql build
yarn tsc -b packages/common/graphql/tsconfig.json --pretty false
yarn workspace @affine/i18n build
yarn lint:ox <本专项修改的 TS/TSX 文件>
yarn prettier --ignore-unknown --check <本专项修改的源码与文档>
docker compose --env-file .docker/selfhost/.env.example \
  -f .docker/selfhost/compose.localmind.yml config --quiet
```

```sh
docker exec localmind_office_surface_verify sh -lc \
  'cd /workspace && yarn workspace @affine/server ava src/base/logger/__tests__/localmind-log-service.spec.ts --serial'
# 9 passed

docker exec localmind_office_surface_verify sh -lc \
  'cd /workspace && yarn workspace @affine/server ava src/__tests__/copilot/copilot-context-planner.spec.ts --serial --timeout=45s'
# 34 passed

yarn vitest run \
  packages/frontend/core/src/blocksuite/ai/runtime/chat/runtime.spec.ts \
  packages/frontend/core/src/blocksuite/ai/components/ai-chat-content/ai-context-compaction-status.spec.ts \
  packages/frontend/admin/src/modules/observability/index.spec.tsx
# 63 passed
```

隔离 PostgreSQL：

```sh
DATABASE_URL=postgresql://.../localmind_context_session_e2e_20260922_1017 \
  yarn workspace @affine/server prisma migrate deploy
# 390 migrations applied

yarn workspace @affine/server ava \
  src/__tests__/copilot/context-session-retention.e2e.ts --serial --timeout=45s
# 1 passed：独立签名归档、回读后热删除、篡改拒绝

yarn workspace @affine/server ava \
  src/__tests__/copilot/project-context.e2e.ts --serial \
  --match='signed recovery barrier blocks restored session content before cleanup resumes' \
  --timeout=45s
# 1 passed

yarn workspace @affine/server ava \
  src/__tests__/copilot/project-context.e2e.ts --serial \
  --match='session deletion hold revokes access immediately and resumes after the hold is released' \
  --timeout=45s
# 1 passed，含 GraphQL 无正文状态查询

yarn r packages/backend/server/scripts/context-session-remediation-preflight.ts
# 15 个专项 migration 均 finished；重复上下文、私人写入、积压按无正文计数输出

yarn r packages/backend/server/scripts/context-session-recovery-barrier.ts \
  export --file /tmp/context-session-barrier-20260922.json
yarn r packages/backend/server/scripts/context-session-recovery-barrier.ts \
  verify --file /tmp/context-session-barrier-20260922.json
yarn r packages/backend/server/scripts/context-session-recovery-barrier.ts \
  apply --file /tmp/context-session-barrier-20260922.json
# 三种模式退出码均为 0；apply 写入幂等回执

# yarn workspace @affine/server build 后，在 Linux 容器中把已验证的 Linux native
# addon 与 dist/main.js 按生产 package 阶段并置，再执行相同的 CLI：
SERVER_FLAVOR=script node ./dist/main.js \
  context-session-recovery-barrier export --file /tmp/context-session-barrier.json
SERVER_FLAVOR=script node ./dist/main.js \
  context-session-recovery-barrier verify --file /tmp/context-session-barrier.json
SERVER_FLAVOR=script node ./dist/main.js \
  context-session-recovery-barrier apply --file /tmp/context-session-barrier.json
# export / verify / apply 均退出 0；屏障含 1 个已删除 session，apply=true

LOCALMIND_RECOVERY_BARRIER_FILE=/tmp/context-session-startup-barrier.json \
  timeout 15s yarn r packages/backend/server/src/index.ts
# 服务正常进入运行态后由 timeout 停止；随后对同一屏障执行 apply 返回 applied=false，
# 证明 AppModule、读取入口和 worker 启动前已完成幂等重放
```

已知验证限制：直接在 macOS 主机运行 server AVA 时，仓库的 TypeScript ESM prelude 未加载内部 runner，出现 `ERR_MODULE_NOT_FOUND`；同一测试在规定 Linux 源码容器通过。早先完整 `project-context.e2e.ts` 运行中，行为断言完成后 AVA 曾因既有开放句柄无法退出；本次新增的三个聚焦 E2E 均正常退出为 0。该开放句柄不计作断言通过，也不隐去。

## 6. 运维配置与恢复顺序

签名归档要求以下服务端变量，密钥不得写入仓库或数据库：

```dotenv
LOCALMIND_AUDIT_ARCHIVE_DIR=/var/lib/localmind/audit-archive
LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_VERSION=2026-09
LOCALMIND_AUDIT_ARCHIVE_KEYS={"2026-09":"至少32字符的独立随机密钥"}
```

轮换时先在 `LOCALMIND_AUDIT_ARCHIVE_KEYS` 保留旧版本，再切换 active version；旧归档校验完成且超过保留期后才能移除旧 key。

Compose 将审计归档以读写方式挂载到主服务，将恢复屏障以只读方式挂载到主服务，
并只允许一次性 migration 容器写入恢复屏障目录。备份后使用打包镜像中的 CLI 生成
并校验屏障；目录必须位于数据库、Blob 与配置备份之外的受控故障域：

```sh
docker compose --env-file .docker/selfhost/.env \
  -f .docker/selfhost/compose.localmind.yml \
  run --rm --no-deps affine_migration \
  sh -lc 'SERVER_FLAVOR=script node ./dist/main.js context-session-recovery-barrier export --file /var/lib/localmind/recovery-barrier/context-session-barrier.json'
```

恢复时完成 migration 后、开放任何读取或 worker 前，设置相同 keyring 和：

```dotenv
LOCALMIND_RECOVERY_BARRIER_FILE=/var/lib/localmind/recovery-barrier/context-session-barrier.json
```

服务启动会先验证并重放屏障；签名、fingerprint、keyVersion 或 schema 不匹配会 fail closed。之后才允许删除 worker 继续物理清理。

## 7. 剩余上线关卡

1. 在获得真实 Project BYOK 授权后执行 A36 摘要质量、成本与延迟评测。
2. 用真实业务备份和匹配的对象存储副本完成隔离恢复，验证屏障文件位于备份故障域之外。
3. 完成桌面/窄屏、明暗主题、键盘、断网/重连和多标签页的真实浏览器矩阵。
4. 对日志、审计、队列、Redis、support bundle 和对象存储做一次全链路正文/凭据扫描。
5. 另获部署授权后按维护窗口执行同步、观察和回滚证据收集；本次未改业务运行环境。
