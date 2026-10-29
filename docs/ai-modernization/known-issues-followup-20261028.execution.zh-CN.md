# 已知问题复核与修复记录（2026-10-28）

## 产品规则

MCP 不负责日志目录按日期重排；需要调整时由用户在界面手动完成。日志写入仍须核对正文和目标目录。本机 LocalMind 日志技能已同步此规则，不再把日期排序作为未完成的 MCP 交付项。

## 已修复与验证

- Common Office 汇报测试使用完整 `IntersectionObserverEntry` 数据，不再使用不安全的强转。Linux 容器中 `yarn tsc -b packages/common/office --pretty false` 通过，相关 Vitest 5 项通过；本轮没有执行 monorepo 全仓类型构建。
- 自动生成会话标题的数据库状态与约束统一为 `running` 和 `auto`。原先的 `generating`／`generated` 均不符合迁移中的检查约束，导致标题生成失败。隔离 PostgreSQL 上生成、已有标题、空对话及失败等场景通过，并断言持久状态。
- 修正 Copilot 套件中的旧夹具：索引测试使用排队回执的请求 ID 并有界等待；会话顺序使用确定时间；授权场景使用真实会话；模型策略测试使用显式路由夹具；未配置 BYOK 的旧查找检查明确验证拒绝。完整 `copilot.spec.ts`、context planner 和根登记测试共 109 项通过。
- context planner v9 只将完全没有正文、附件、流对象、参数和响应格式的空用户轮次视为无内容保留，避免误报无法整理；还要求保留轮次中的附件、流对象和响应格式，丢失时仍失败。v7 与 v8 配置、行为和指纹保留；本地热启动实例短暂注册了只含空轮次修复的 v8，补充载荷检查时版本冲突导致后端启动失败，改用 v9 并复核就绪。v7 指纹与修改前逐字节一致。
- native Markdown 代码块导出不再无条件增加换行，代码中含反引号时使用足够长的围栏。Rust 库 101 项测试、使用最终 addon 的 MCP 资源测试 34 项、隔离数据库中的代码块创建／读取／版本更新／幂等重放通过。无损语义检查及不支持内容的拒绝仍保留。
- native 根文档读取和去重支持 Yjs 页面数组中的普通对象。底层 y-octo 可变／只读解析器修复并发写入同一 map key 时冲突链的排序及空节点判断；按本地 `y-octo` 0.1.0 补丁构建。Rust 完整库测试 113 项通过、1 项原有忽略；Yjs 合成并发更新验证顺序和历史。对本地 11 个 Workspace 根文档做只读事务检查，修复前 2 个 native 读取及增量不一致，修复后 Rust 读取和内存内新增增量的 Yjs 回放均为 11/11；没有写入业务文档。native 增量回放失败时，注册流程可尝试现有的 Yjs 增量路径。

## 剩余事项及运行状态

### 普通数组历史根文档的后续修复

`meta.pages` 为普通数组时，预检和资源读取可识别历史页面；页面树迁移在原有工作区锁、来源版本检查和数据库事务内，将其递归转换为可编辑的 Yjs 数组／映射，并使用增量更新保留根文档的其他共享结构、页面顺序、未知字段、嵌套值和回收站记录。转换本身也会触发持久化，即使迁移无需创建文件夹或变更回收站。已切换的工作区若仍存在此格式，下一次有效页面树操作会在同一锁定事务内先完成转换。原页面正文仍是独立文档，不被重建。迁移未完成时，普通页面登记仍拒绝绕过页面树迁移直接转换，以免与旧协议写入竞争。

页面树切换后，服务端拒绝旧客户端替换整个 `meta.pages` 的同步，包括 CRDT 冲突中看似未生效的写入；用户需在旧客户端保留并处理未同步的离线更改，再以新结构重新同步，不能将拒绝视为已保存。正常的页面字段编辑、已应用更新重放和正文同步继续通过原有权限和生命周期校验。

本轮在独立 PostgreSQL 中应用全部 423 项迁移，并验证普通数组的真实页面树迁移、未知元数据和原页面正文保留、过期迁移计划拒绝、迁移后的创建及幂等重试、旧客户端冲突拒绝；还覆盖了迁移无需其他树变更的场景和两种冲突顺序。本机业务库的只读复核仍为 11 个根文档全部使用 Yjs 数组，native 读取及内存中增量回放均为 11/11；没有对业务根文档执行转换，因此其他环境的数据形态仍需按各自预检结果处理。

验证复用 `localmind-affine:dev-base`，使用当前工作树与独立测试库 `localmind_legacy_root_verify_20261028`；没有重建镜像或删除数据卷。先前页面树全套 29 项通过，随后针对新增边界补充隔离数据库回归。业务热启动实例直接挂载工作树，源码编辑期间自动重启；一次临时语法错误导致启动失败，修复后 GraphQL 和 Admin HTTP 已恢复。此次没有对业务库执行迁移或运行后端同步脚本，也没有提交或推送。

最终版本运行 `node .yarn/releases/yarn-4.13.0.cjs tsc -b packages/backend/server --pretty false` 通过；隔离库中运行 `node .yarn/releases/yarn-4.13.0.cjs workspace @affine/server ava --serial --timeout=5m src/__tests__/copilot/workspace-page-tree.e2e.ts --match='*legacy*' --match='*switched*'`，6 项通过；根登记、快照解析和正文同步聚焦测试 12 项通过，相关 oxlint、Prettier 和 `git diff --check` 通过。没有执行浏览器端的真实页面交互验收。

验证使用 Linux 容器和独立 `localmind_copilot_recheck_20261028` 数据库，迁移已应用；未重建 Docker 镜像。复用 `localmind-affine:dev-base` 和现有缓存，以 `cargo build --locked --offline --release -p affine_server_native` 构建 Linux native addon。

同步前以 `pg_dump -Fc` 备份本地业务库到 `.docker/dev/localmind-hot/backups/known-issues-20261028.dump`（2,008,966,423 字节），`pg_restore --list` 读取 2,842 行。使用 `LOCALMIND_RUNTIME_MODE=source` 和既有 `yarn localmind:sync:backend` 脚本，以隔离验证容器为源码源、独立容器执行迁移；数据库已有 423 项迁移，无待执行迁移。脚本重建本地后端容器后，按原 Compose 配置重新绑定 Web 和 Admin 的 native 文件；未重建镜像或删除数据卷。三个容器中的 native 文件与验证产物 SHA-256 均为 `6e6a5038066abbc976373f6275a438b32995f78b49ad431783cdeaa49949de9a`。实际后端中的合成根文档与 Markdown 探针通过，GraphQL 返回 `Query`，`http://localhost:3011/admin/ai` 返回 200，Admin 编译成功。

业务热启动后端挂载本工作树，源码修改曾触发自动重启；v8 指纹冲突造成一次临时启动失败，保留 v8 并切至 v9 后恢复。没有生产部署、提交或推送。原有业务数据、备份和个人配置保留。检查日志位于 `/tmp/localmind-*.log`。
