# Qwen 运行时修复实施记录（2026-09-16）

状态：部分代码已实施，未发布，尚未通过完整方案验收。对应方案是
[qwen38-runtime-remediation.zh-CN.md](./qwen38-runtime-remediation.zh-CN.md)。
用户已明确暂不执行最后的真实工作日志提交与目录验收。

本记录使用 Agent Runtime、Registries 以及 Workspace/Project 写入授权契约作为边界。
未修改生产配置，未提交 Git，未更新运行镜像，未向 LocalMind 提交工作日志。

## 已实施范围

- P1：在仓库 vendor 中修复 llm_adapter 0.2.11 / llm_runtime 0.2.7，保留来源、许可证和版本锁定。
  Chat 空 ID 不覆盖真实身份，支持参数先于身份到达；Responses 归并 item、index 与 call ID。
  身份冲突、非对象参数、失败/不完整终态和异常 EOF 不派发工具；成功终态前暂存调用。
  增加调用数量、参数字节数及 SSE 总量限制；读取嵌套 usage，避免重复终态重复计量。
- P2 配置：Workspace、Project 和新 Project 审计支持可空 apiStyle。存量 null 保留原 Responses 语义。
  数据库检查协议与 Provider 的组合。Workspace configRevision 仅随配置变化推进；迟到探测及失败结果不能覆盖新版本。
  GraphQL 使用既有生成命令生成。Admin 增加协议选择；Electron 加密存储和本地 lease 保留协议。
  Provider/model 定义共用协议解析；Workspace profile ID 带配置版本，本地 profile ID 绑定 lease 身份。
  连接探测选择保存的 Chat 或 Responses 路径。管理端明确标注普通连接测试尚未验证结构化规划与工具执行能力。
- P3 部分：启用生产 schema feature 时，在 native 候选路由返回成功前验证 JSON Schema。
  MCP 保留严格六字段、分支语义及授权文档目标检查；最多两次结构化调用，每次 native 候选最多一个。
  移除额外文本 renderer 和自动借用分支字段的兜底。暂时性错误有 250ms 退避。
  每次规划尝试前后检查取消、凭据有效性及 Workspace.Copilot 权限。失败结果保留终态记录，不入工具执行队列。
- P4 部分：删除整段请求的否定语句提前返回；显式正文、引用块及代码围栏不参与动作识别。
  “保存日志，不要发送消息”仍要求文档保存证据；“恢复索引”不产生恢复目录要求。
  新任务使用请求 v7 / 完成契约 v5；保留旧契约读取，旧记录未改写。

## 验证与环境

- 在隔离 PostgreSQL 数据库 `localmind_qwen_runtime_20260916` 全量应用迁移并生成 Prisma Client。
  没有修改运行服务数据库。GraphQL schema/client 使用仓库生成流程生成。
- Linux 固定测试镜像 `localmind-affine:test`：adapter 171 项、runtime 26 项通过（共 197 项）。
  包含 Schema 不合法对象、身份归并、失败终态、资源上限等回归。
- 同一固定镜像、Rust 1.97.1 和根 Cargo.lock 下，`cargo build --locked -p affine_server_native` 成功（dev profile，6 分 27 秒）。新生成的 N-API 模块通过 4 个 Chat/Responses 成功及失败合成场景，成功时回调一次、参数完整并续跑回答 OK，失败时回调零次。测试源码位于 `packages/backend/native/tests/qwen-runtime-smoke.cjs`。
- Admin 与 Electron：3 个测试文件、9 项测试通过，包括省略协议时保留原加密配置及 lease 协议。
- 后端 TypeScript、聚焦 lint 与格式检查通过；后端 BYOK、Project BYOK、连接探测、完成契约和 MCP 委托共 110 项回归通过。另行验证本地 lease 轮换后的 Provider 身份隔离，1 项通过。

关键命令（工作目录为仓库根目录，AVA 在测试容器的 server 包目录运行）：

```sh
cargo test -p llm_adapter -p llm_runtime --lib --no-default-features --features ureq-client,schema
cargo build --locked -p affine_server_native
node packages/backend/native/tests/qwen-runtime-smoke.cjs /validation/server-native.node
yarn tsc -p packages/backend/server/tsconfig.json --noEmit
yarn vitest run packages/frontend/admin/src/modules/ai/project-byok.spec.tsx packages/frontend/admin/src/modules/ai/workspace-byok.spec.tsx packages/frontend/apps/electron/test/main/byok-storage.spec.ts
# 使用隔离 DATABASE_URL、REDIS_SERVER_HOST=test_redis 和仓库 CLI import hook：
yarn test src/__tests__/copilot/tool-agent-completion.spec.ts src/__tests__/copilot/byok.spec.ts src/__tests__/copilot/byok-probe.spec.ts src/__tests__/copilot/project-global-byok.spec.ts src/__tests__/copilot/copilot-mcp-delegation.e2e.ts
git diff --check
```

未重建镜像。最初 Linux 编译因 Docker 虚拟机磁盘耗尽失败；仅清除了本任务的临时编译输出，随后在同一固定测试镜像中将输出绑定到宿主机临时目录，完成测试。
Docker 虚拟机约 59GB，检查时可用空间为 0；宿主机尚有空间。没有删除镜像、volume 或持久化服务数据。
独立 Rust 单元测试 workspace 使用相同 vendor 源码及生产 features；随后另行使用根 Cargo.lock 编译并加载 Linux N-API 模块。新增 N-API 编译输出约 2.3GB，位于宿主机临时目录，不占用 Docker 虚拟机层。尚未构建 release runtime 镜像。

## 发布前仍须完成

以下是未完成工作，不得以当前通过的测试替代：

1. 三阶段能力探测：生产协议构造器及 native 解析器上的文本、规划 Schema、内存回声闭环；四请求预算、取消、分阶段 UI 和配置版本绑定的持久化能力结果。目前只有普通连接探测。
2. native HTTP 的即时取消/剩余截止时间传递；逐次规划尝试的持久化模型、协议、版本、耗时、类别及 usage 证据。现有宿主取消检查不能中断已经进入 native 的 HTTP 调用。
3. 存储层将未知 usage 与已知零区分。解析层已保留未知，但已有 BYOK usage event 数值存储仍使用默认零。
4. 严格规划意图描述、同目标资源的保存/目录/顺序约束，以及授权最终读取核验。目前仅修复正文否定污染，不能视为 P4 完整交付。
5. 真实旧版本数据 fixture 升级、release runtime 打包、Admin 浏览器交互检查及真实 Qwen 合成验收。
6. 完成上述门槛后，按既有流程备份、暂停 worker、执行旧契约退场并部署固定 runtime 镜像，再配置 Qwen Chat。当前未做任何生产切换。

用户暂缓的真实工作日志提交不作为本轮待执行操作；其他发布门槛没有因此取消。
