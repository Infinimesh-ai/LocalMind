# Workspace/Project AI 写入授权修复实施记录

> 日期：2026-09-16
> 范围：[已确认方案](workspace-project-ai-write-authorization-remediation.zh-CN.md)
> 交付范围：按用户本次补充指令，只修改代码并完成验证，不部署运行环境。

## 实现

- Workspace 正文、标题、目录、创建、优化单文档 Agent Runtime、直接/委托 MCP 和
  Office 单命令/批量写入移除 actor-only audience 门禁。实时 ACL、凭据上限、输入、
  版本、租约、取消、幂等和永久删除保护继续生效。
- `canPlaceDocumentCreatedByCurrentToolLease` 与创建回执挂载豁免已删除。
  同一既有文档可以跨会话按相同目录 ACL 挂载，创建回执只用于幂等及结果核对。
- 普通 Workspace Office 和独立文档更新请求在预览后直接排队，approval step 保存
  `user_request` 授权证据，执行阶段继续复核权限与版本。Project Office 审批保持原契约。
- Workspace 写入通过共享权限锁与领域事务保护实际持久化；广播在提交后发出。
  成功审计与领域写入同事务提交，不把回滚或 ACL 拒绝记为成功。
- `AiSharedWriteSourceCheck.policyVersion` 区分历史 `shared-write-source/v1` 与新增
  `workspace-live-acl/v1`。后者仅允许 `authorized_by_live_acl` 成功记录，不能用于 Project。
  来源保留完整指纹，展示快照超过预算时截断，避免来源审计大小成为新的写入门禁。
- 模型可见资源工具改为 `workspace_*` / `project_*`，注册与执行时均检查作用域。
  Project 标题/元数据工具为 `project_resource_update_meta`；显式发布工具继续独立存在。
  无副作用的通用工具保留原名；没有注册旧名称 alias。
- Project 来源隔离、导入复制权限、编辑租约、成员复核及显式 Workspace 发布保持不变。
  旧 Workspace 引用写回仍被拒绝。
- UI 的旧工具结果标记为 `legacy`，使用有界只读结果卡，保留原名称；Project 写入
  回执不生成错误的 Workspace 文档操作入口。

主要代码入口（均相对于仓库根目录）：

- 审计与迁移：`packages/backend/server/src/models/copilot-context.ts`、
  `packages/backend/server/schema.prisma`、新增的两项 `20260916*` migration。
- 实时写入授权：`packages/backend/server/src/core/doc/workspace-organization.ts`、
  `packages/backend/server/src/core/office/command-service.ts`、
  `packages/backend/server/src/plugins/copilot/tools/doc-write.ts`，及相邻 MCP、
  document-operation、Agent Runtime 和 Office command 入口。
- 工具隔离与旧契约：`packages/backend/server/src/plugins/copilot/runtime/tool-runtime.ts`、
  `packages/backend/server/src/models/common/copilot-tool-contract*.ts`、
  `packages/backend/server/src/plugins/copilot/tools/project-doc.ts`，及 completion/evidence、
  worker、native prompt 与快照。
- 结果兼容：`packages/frontend/core/src/blocksuite/ai/components/ai-message-content/stream-objects.ts`、
  `packages/frontend/core/src/blocksuite/ai/components/ai-tools/doc-write.ts`。
- 同步了 `agent-runtime`、`context-memory`、`project-ai-boundaries`、
  `project-native-resources` track 及用户/MCP 文档。

## 契约及旧任务处理

| 内容                                         | 新版本                                        |
| -------------------------------------------- | --------------------------------------------- |
| delegated tool-agent request                 | `localmind-tool-agent-request/v6`             |
| completion contract                          | `localmind-tool-agent-completion-contract/v4` |
| tool-name fingerprint input                  | `localmind-tool-agent-tools/v2`               |
| capability/Schema snapshot fingerprint input | `localmind-tool-capability-snapshot/v2`       |
| Project native resource command              | `version: 2`                                  |

`packages/backend/server/scripts/retire-tool-contracts.ts` 默认只读盘点。
`--apply` 必须设置 `LOCALMIND_WORKERS_PAUSED=1`，并在备份、暂停所有 worker 后运行。
它锁定关联 request/run，复核当前状态，原子终止受影响非终态任务与步骤、释放 worker/
等待/Project 编辑租约、追加 timeline，并终止关联 MCP request、取消待发送的旧回调。
输出只有数量，不输出任务正文或凭据。

原始输入、tool call、checkpoint、已存在 execution result、终态历史与其指纹保持不变。
不为未执行任务伪造 worker lease 或 execution result；停止时尚未确认结果的调用保持
`unconfirmed`，不宣称其副作用已回滚。重复执行收敛命令不重复追加终态事件。
新 worker 和恢复入口直接拒绝旧契约，错误码为 `tool_contract_retired`。

新增 Project 终态约束迁移只接受准确匹配 run、actor、Project、时间、worker attempt、
workflow 和失败原因的不可变退役事件；事件必须声明没有执行新操作、保留原 checkpoint。
普通执行仍要求 execution result。测试验证缺少维护回执不能直接把任务改成退役失败。
Office 的内部 sourceType 保持兼容，模型可见工具名独立改为显式作用域名称。

## 验证环境

- 固定镜像：`localmind-affine:test`，复用 `localmind_project_native_runner`。
- 隔离 PostgreSQL/Redis：`localmind_affine_test_postgres`、`localmind_affine_test_redis`。
  行为测试使用 `affine_write_remediation` 与全新 `affine_write_clean_final`，
  没有在业务库运行测试或清理数据。
- Native 使用同一固定 test 镜像，在 `localmind_write_remediation_build` 内构建。
  Docker 虚拟盘最初因编译产物占满，后将本次源码快照、Cargo/Rustup 和编译临时目录
  放到宿主机挂载目录，仅移除本次失败编译产生的 runner `target`。未删除 volume。
- Native 精确命令：

  ```sh
  docker exec -w /workspace \
    -e CARGO_BUILD_JOBS=2 \
    -e CARGO_PROFILE_RELEASE_LTO=false \
    -e CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
    localmind_write_remediation_build \
    yarn workspace @affine/server-native build
  ```

  Linux arm64 release 构建成功，addon 加载成功。没有重建 `dev-base`、`test` 或 `local` 镜像。

- 收尾时 `docker system df`：Images 57.47 GB、Containers 12.82 GB、
  Local Volumes 3.472 GB、Build Cache 2.913 GB。Docker 虚拟盘 59 GiB，
  `df` 可用栏为 0（100%）；隔离 PostgreSQL 数据目录位于宿主机，仍有 158 GiB 可用。
  已删除本次复制进 runner 的临时源码 tar，不清理无关镜像、容器或 volume。
  后续重建前需要先解决 Docker 虚拟盘空间问题。

## 验证结果

本次验证覆盖：

- 多人 Workspace 的正文、标题、目录和既有文档跨会话挂载；来源预算超限不再误拒绝。
- MCP 凭据能力上限、执行时权限撤回、权限锁、取消、重试和 lease 交接。
- Office 单命令/批量更新以及 Project Office 继续需要审批。
- Project 原生资源、工具作用域隔离、旧命令/旧快照拒绝。
- 旧任务退役的事务、幂等、不可变原输入/回执/checkpoint、回调取消与维护事件约束。
- 新工具名的 native prompt/Schema 快照、会话历史回显及前端 legacy 只读结果卡。

聚焦后端 AVA 主回归 301 个用例通过，加上独立历史回显/MCP 边界 2 个用例，
共 303 个用例通过。主回归包含 native provider 的 46 个用例，未重复计数。
前端组件测试 11 个用例通过。全仓 `yarn typecheck`（含 70 个 Copilot 测试文件）、
本次修改文件的 ESLint、oxlint、Prettier 和 `git diff --check` 通过。
新增前端只读回执用例后补跑 frontend/core 类型检查也通过。

验证命令：

```sh
docker exec -w /workspace \
  -e DATABASE_URL=postgresql://affine:affine@test_postgres:5432/affine_write_clean_final \
  -e REDIS_SERVER_HOST=test_redis \
  -e NODE_OPTIONS=--import=file:///workspace/tools/cli/register.js \
  localmind_project_native_runner yarn workspace @affine/server test \
  src/__tests__/models/copilot-context.spec.ts \
  src/__tests__/copilot/document-operation.e2e.ts \
  src/__tests__/copilot/copilot-mcp-delegation.e2e.ts \
  src/__tests__/copilot/copilot-office-agent-command.spec.ts \
  src/__tests__/copilot/copilot-office-runtime.spec.ts \
  src/__tests__/copilot/copilot-workspace-folder-tools.spec.ts \
  src/__tests__/copilot/direct-mcp-source-boundary.spec.ts \
  src/__tests__/copilot/host-services.spec.ts \
  src/__tests__/copilot/native-provider.spec.ts \
  src/__tests__/copilot/project-office.e2e.ts \
  src/__tests__/copilot/project-session.e2e.ts \
  src/__tests__/copilot/tool-agent-budget.spec.ts \
  src/__tests__/copilot/tool-agent-completion.spec.ts \
  src/__tests__/copilot/tool-call-loop.spec.ts \
  src/__tests__/storage/office-ai-native-e2e.spec.ts \
  src/__tests__/storage/office-command-batch.spec.ts \
  src/__tests__/storage/office-docx-command.spec.ts --concurrency=1 --serial

yarn vitest run packages/frontend/core/src/blocksuite/ai/components/ai-message-content/stream-objects.spec.ts
yarn typecheck
yarn lint:ox <本次修改的 TypeScript 文件>
yarn eslint --report-unused-disable-directives-severity=off <本次修改的 TypeScript 文件>
yarn prettier --ignore-unknown --check <本次修改的代码和文档>
git diff --check
```

同一 AVA 环境另运行 `copilot.e2e.ts` 的 `should preserve persisted assistant render trace*`
及 `copilot.spec.ts` 的 `MCP credentials stay bound*`，2 个用例通过。
只读退役 CLI 在隔离升级库执行成功，没有改动历史任务。

已完成迁移验证：

- 空数据库全量应用 369 条迁移成功。
- 审计升级 fixture：先应用前 367 条迁移，使用
  `workspace-write-authorization-upgrade.smoke.ts seed` 保存四种旧 reason，应用新增迁移，
  再运行 `verify`；旧判定、来源、时间与指纹均保留，历史 UPDATE 被拒绝，新 ACL
  审计成功，非法 policy/Project/allowed 组合被数据库约束拒绝。
- 为验证真实旧数据升级，读取本机数据库逻辑备份并恢复到隔离库，从 318 条升级至
  369 条迁移成功。8 条历史 Agent Run 的所有原有字段保持相同，仅增加旧版本缺少的新列。
  本机旧库尚无来源审计表，因此专用 367→368 fixture 单独覆盖审计保留，
  继续升级至 369 后再次验证通过。
- 逻辑备份为 `backups/localmind-write-authorization-20260916.dump`，1,216,560 字节，
  SHA-256：`c907bf8655964f8ab1ada8a11e0eecc85792164aeee16761ee9a7f5900b811cb`。
  原库只做备份和只读检查，未迁移或修改业务数据。

## 未执行的发布验收

初次代码交付未执行运行同步、生产旧任务收敛、镜像发布或 Git 远端操作。
用户随后另行授权将本次修复提交并推送到 `origin/main`，仍不部署运行环境。
没有通过线上账号重挂 `2026-09-14｜member-02｜工作日志`，也不宣称线上故障已消失。
既有原 documentId 跨会话挂载已由隔离多人 Workspace 测试覆盖。
正式部署仍需按部署手册选择准确环境，备份、暂停 worker、盘点/apply、发布后复验。
