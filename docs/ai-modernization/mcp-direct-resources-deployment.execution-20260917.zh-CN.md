# MCP 直连资源工具：生产部署记录（2026-09-17 UTC）

## 部署结果

通过 `ssh localmind` 在 `/home/localmind/LocalMind` 完成保留数据升级。
本次仅使用 SSH、Docker 和 HTTP 健康检查，没有调用远端 LocalMind MCP、delegate
或外部模型，没有创建生产用户、凭据或日志。

- 部署前：`6762e73e98458a73f1caa0bd0519655aaf7cb78b`。
- 部署后：`fe182653876f0c8030120e4e362658167d689e97`，`main` 与 `origin/main` 一致。
- 固定镜像：`localmind-affine:local`，本次重新构建运行镜像，基础层命中缓存；未重建
  `localmind-affine:dev-base` 或 `localmind-affine:test` 标签。
- 新镜像：`sha256:1509847709ba868dfd5e14c25e46da1017fb0090b059d245c62ca1d22b0ead74`。
- 服务地址：<https://localmind.infinimesh.cloud/>，主机端口 `3011`。
- 停机窗口：`2026-09-17T04:32:59Z` 至 `2026-09-17T04:34:03Z`，64 秒。
- 契约依据：`mcp-direct-resource-tools-design.zh-CN.md` 和
  `mcp-direct-resource-tools.execution.zh-CN.md`。

## 配置与数据保留

继续使用 `/home/localmind/.local/bin/localmind-compose`，保留既有 `.env`、
`compose.localmind.yml` 与未跟踪的 `compose.localmind-indexer.override.yml`。
原有上传文件、配置、企业 CLI、PostgreSQL 和 Manticore 数据挂载经归一化比较一致。
没有清理镜像、数据卷或目录，没有操作独立的旧 AFFiNE 实例。

全文索引继续开启，ISCP 保持关闭。`LOCALMIND_MCP_RESOURCES_ENABLED` 仍未设置，
新 MCP 资源工具保持默认关闭；新版实现和数据库结构已部署，旧 MCP 凭据能力未扩大。

迁移前后严格校验业务记录和文档内容指纹，结果一致：5 个用户、6 个工作区、
10 条成员记录、124 个页面、136 份快照、114 条 blob 记录、1 个 Project。
412 条终态 Agent 历史、69 条来源审计、73 条工具调用以及 BYOK 和 MCP 凭据
指纹均保留。切换时没有活动 Agent run 或等待中的委托请求。

## 备份与验证

私有部署目录：
`/home/localmind/backups/localmind-mcp-deploy-20260917T040833Z`。

目录包含在线和停机后最终 PostgreSQL 自定义格式备份、文件归档、原始配置、
旧镜像归档 `runtime.rollback.tar.gz`、源代码归档、构建日志、迁移日志及校验基线。
数据库备份通过 `pg_restore --list` 验证，文件归档通过目录读取验证，旧镜像归档
通过 `gzip -t` 验证；在线备份、最终备份和旧镜像的 SHA-256 均再次验证通过。
原始旧镜像 ID 为
`sha256:31053762b9cf749706796e39ad1bdf3c47e66a42898f697158f7b1166208aeee`。

关键执行命令如下，`LM_RECORD` 为上述私有部署目录：

```sh
git fetch origin main
git pull --ff-only origin main
git archive HEAD > "$LM_RECORD/source.tar"
/home/localmind/.local/bin/localmind-compose -f "$LM_RECORD/build.override.yml" build affine
bash "$LM_RECORD/validate-image.sh"
bash "$LM_RECORD/cutover.sh"
```

`build.override.yml` 只把构建上下文指向提交的干净归档，不包含 `.env` 或运行数据。
详细命令、输出和门禁保留在同目录脚本中：

- `validate-image.sh`：新镜像原生 Qwen SSE 的 4 个场景通过；真实生产备份恢复到隔离库后
  执行 `yarn prisma migrate deploy`，371 个 schema 迁移完成、无待执行迁移，9 个
  data migration 均已完成；原数据和凭据指纹一致。
- `cutover.sh`：停应用、最终备份、捕获基线、正式库迁移、严格数据校验、执行标准
  `self-host-predeploy.js`、再次校验，最后启动应用。迁移容器退出码为 0。
- 应用启动后再次验证历史记录，主服务重启次数为 0；PostgreSQL、Redis、Manticore
  和 adapter 健康。内网与外网的 `/`、`/admin/` 均返回 200，外网验证正常 TLS。
- 临时启动的现有测试 PostgreSQL/Redis 容器已恢复为停止状态，隔离恢复库保留。

## 资源与剩余事项

构建前执行了 `docker system df`，磁盘约 540 GiB 已用、1.3 TiB 可用。
预计新增 18–26 GB，低于 30 GB 限制。备份后构建基线至构建完成的文件系统用量
从 580447121408 增至 597846372352 字节，约增加 17.40 GB（16.20 GiB，包含测试
恢复库等开销，并非镜像独占大小）。部署结束主机约 555 GiB 已用，仍余约 1.3 TiB。
构建期间 Docker 一度因交换分区读页变慢，随后正常完成，未通过清理数据或重启
Docker 处理。
部署后的 `docker system df` 在 45 秒超时，已保留输出和文件系统统计；上述实际
增量采用文件系统读数，不将其冒充 Docker 独占统计。

启动日志无 ERROR/FATAL，仅保留原有许可证编译配置、未配置 SMTP 和 embedding
声明 1024 维而工作区需要 4096 维的警告。本次没有实际请求外部 AI/embedding 服务，
不据此宣称该链路已验证。MCP 新工具需要后续显式开启开关并授予凭据能力才能使用。

此执行记录没有再次提交或推送；本地原有未提交文档保持原样。
