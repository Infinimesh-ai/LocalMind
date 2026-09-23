# Qwen 运行时修复远端部署记录（2026-09-16）

用户授权通过 `ssh localmind` 应用本轮已提交更新，并保留原有数据。本次发布的是部分运行时修复，不代表完整 Qwen 修复方案验收。真实工作日志提交仍按用户要求暂缓。

## 发布结果

- 目标提交：`6762e73e98458a73f1caa0bd0519655aaf7cb78b`，已推送 `origin/main`。
- 远端仓库：`/home/localmind/LocalMind`；部署使用既有 `localmind-compose` 包装脚本及原索引器 override。
- 仅重建固定运行镜像 `localmind-affine:local`；镜像 ID 为 `sha256:31053762b9cf749706796e39ad1bdf3c47e66a42898f697158f7b1166208aeee`。未重建 `dev-base` 或 `test` 镜像，未创建专属 tag。
- 应用维护窗口：UTC `2026-09-16T10:52:37Z` 至 `2026-09-16T10:59:10Z`，约 6 分 33 秒。
- 本机端口 3011 与公网 `https://localmind.infinimesh.cloud/` 均返回 HTTP 200；运行容器使用目标镜像，检查时重启次数为 0。
- PostgreSQL、Redis、索引器与 adapter 状态正常；同机旧 AFFiNE 服务未操作。本次启动的隔离测试 PostgreSQL、Redis 在验证后停止，测试数据保留。

## 备份及数据保留

远端私有备份和执行证据目录：

```text
/home/localmind/backups/localmind-qwen-deploy-20260916T102423Z
```

包含在线及停机后的 PostgreSQL custom dump、storage/config/enterprise-cli 文件归档、环境配置与 Compose 配置副本、校验和、旧运行文件系统归档和执行日志。数据库 dump 经 `pg_restore --list` 检查；在线 dump 已在隔离 PostgreSQL 完整恢复并升级演练。停机后文件归档完成可读性检查。

生产迁移前后进行业务行、快照内容及不可变历史指纹比对，通过结果为：5 个用户、6 个工作区、10 条成员记录、121 个页面、133 份快照、114 条 blob 记录、1 个 Project、407 条 Agent run、69 条来源审计及 73 条工具调用均保留。启动后再次校验原有历史，结果通过。生产数据挂载的来源、目标和读写属性一致。

应用 `20260916090000_byok_api_protocol` 后，370 项 schema 迁移全部完成，无待执行迁移；predeploy 退出码 0，数据迁移与索引器配置预检通过。2 份 Workspace BYOK 配置保留原协议兼容值 `apiStyle=null`，新增版本值为 1；没有 Project BYOK 或历史 Project 配置审计需要转换。原有凭据和模型路由内容未改变，没有自动切换 Qwen Chat。

暂停应用及 worker 后，旧工具契约 inspect、apply 与重复 apply 均报告受影响运行数为 0，没有清除终态历史。

## 验证与命令

本轮沿用 Agent Runtime、Registries 与 Workspace/Project 写入授权契约。代码级回归记录见 [修复实施记录](./qwen38-runtime-remediation.execution-20260916.zh-CN.md)。该记录描述提交前状态；后续远端发布状态以本文为准。

远端使用提交归档作为独立构建上下文，隔离恢复实际数据库，执行迁移、完整数据保留比对、迁移预检与协议默认值检查。Linux x86_64 release 镜像中的真实 native addon 通过 4 个 Chat/Responses 合成成功与失败工具闭环。

关键命令如下；`LM_RECORD` 为上述证据目录。包含数据库连接的参数仅保存在私有 env 文件中。

```sh
/home/localmind/.local/bin/localmind-compose -f "$LM_RECORD/build.override.yml" build affine
# 隔离容器中运行 Prisma migrate deploy、镜像内 qwen-runtime-smoke.cjs，
# 并执行 production-evidence.mjs capture/verify、migration-preflight.mjs、protocol-migration.cjs。
bash /tmp/localmind-qwen-cutover-continue.sh
bash /tmp/localmind-qwen-cutover-apply.sh
bash /tmp/localmind-qwen-health.sh
```

原始完整命令与输出保存在证据目录的 build、validation、cutover、health 脚本和对应日志中。此次未执行真实 Qwen 请求、用户文档写入或工作日志提交。

## 切换异常及回退材料

新镜像替换固定 tag 后，旧镜像 ID 无法直接读取，首次停机文件备份助手启动失败；此时尚未执行生产迁移。旧容器与持久化挂载保留，随后使用已验证的新镜像作为只读 tar 助手完成最终文件备份。

旧容器的 `docker commit` 同样因旧层内容缺失失败。改用 `docker export` 保存旧运行文件系统，并通过 `docker import` 恢复无 tag 的回退镜像，验证旧 `/app/dist/main.js` 存在且 native addon 能成功加载。回退镜像 ID 为 `sha256:ec79d3454262b46f47a29e3610207394dfc4a2e9ed49c77ccd5932374078701a`，持久化数据由独立备份覆盖。回退镜像仅作离线文件和 native 检查，未启动旧应用执行端到端回滚演练。需要回退时应使用该归档/镜像和保存的配置，不能依赖失效的旧镜像 ID。

## 磁盘与剩余限制

构建前已检查 `docker system df`。根分区已用空间从 557,486,698,496 字节增至检查时的 578,795,294,720 字节，包含新构建与回退归档，增加约 21.31 GB，低于 30 GB 门槛；剩余约 1.425 TB。未删除镜像、volume 或持久化数据。

启动日志未发现 ERROR、任务失败或未处理 Promise 拒绝。存在未配置商业授权编译字段、SMTP 及 embedding 声明 1024 维而工作区索引要求 4096 维的告警；此次保留配置，没有通过更改索引或模型设置来掩盖告警。若 provider 不支持请求的 4096 维，检索链路仍需单独验证和处理。

完整修复方案中的三阶段能力探测、native HTTP 即时取消、逐次尝试持久化、未知 usage 存储语义、严格完成意图与最终资源核验、Admin 浏览器交互及真实 Qwen 验收仍未完成。此次部署验证证明该提交能够升级并保留现有数据，不替代这些产品能力验收。
