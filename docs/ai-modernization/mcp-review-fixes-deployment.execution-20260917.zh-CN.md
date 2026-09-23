# MCP 审查与编辑器日志修复部署记录（2026-09-17）

## 结果与范围

经用户明确要求，通过 `ssh localmind` 更新生产仓库并部署，保留原有数据。
仓库 `/home/localmind/LocalMind` 的 `main` 从
`fe182653876f0c8030120e4e362658167d689e97` 快进至
`aa8401a9fbf1eb340e92364e12292b06938e8052`。
本次包含实时广播 ACL、分页游标、真实页面模式与编辑器日志 Markdown 更新修复。
契约依据为 `mcp-direct-resource-tools-design.zh-CN.md`，代码验证见
`mcp-direct-resource-tools.execution.zh-CN.md` 与
`../localmind-code-review-20260917.zh-CN.md`。

- 重建固定运行镜像 `localmind-affine:local`；没有重建 `dev-base` 或 `test` 标签。
- 新镜像 ID：`sha256:d140f7ce1b0370d02c1250dc972f87403fc1d915a097a7f5408116023dca6321`。
- 应用与 SparkClaw adapter 使用同一新镜像，验证时重启次数均为 0。
- 切换窗口：`2026-09-17T11:59:37Z` 至 `2026-09-17T12:00:49Z`，72 秒。
- 内网 `http://127.0.0.1:3011/`、`/admin/` 与公网
  `https://localmind.infinimesh.cloud/`、`/admin/` 均返回 HTTP 200。
- 原有 Compose 本地修改、索引 override、`.env` 和部署 wrapper 全部保留。
  MCP 直接资源与全文索引仍启用，ISCP 仍关闭。环境变量比较按键排序，忽略容器
  重建产生的排列顺序差异；数据挂载比较一致。
- 未删除数据卷或旧镜像，未操作独立 AFFiNE 服务。

## 备份与数据验证

生产证据目录（仅在服务器，受限权限）：
`/home/localmind/backups/localmind-review-fixes-deploy-20260917T113607Z`。

目录保存在线及停服后 PostgreSQL custom dump、附件/配置/enterprise-cli 归档、
旧运行镜像压缩归档、部署前配置、校验和、源码归档、构建和验证日志及部署脚本。
数据库备份通过 `pg_restore --list`，文件归档通过 `tar -tzf`，旧镜像归档通过
`gzip -t`；备份校验和记录于 `backup.online.sha256` 和 `backup.final.sha256`。

在线备份已恢复至独立网络 `localmind-review-validation` 的临时 PostgreSQL 容器，
验证后停止该容器；临时数据库使用 tmpfs，原有生产与测试数据库没有被覆盖。
新镜像在恢复库上执行 `prisma migrate deploy`、历史指纹检查和迁移预检均通过。
371 项 schema 迁移、9 项既有数据迁移完成，无待执行或失败迁移。

生产停服后再次备份，迁移及标准 predeploy 前后进行严格校验：6 个用户、7 个
Workspace、11 条成员关系、128 个文档条目、142 份快照、114 个附件记录、
412 条历史运行、69 条来源审计及 73 条工具调用的相应记录和指纹保持一致。
文档快照、增量更新、核心业务数据、凭据身份及历史审计按部署脚本定义比较。
247 个持久化文件的内容指纹一致；部署时没有活动 AI run 或待处理委托请求。
后续授权的日志更新属于部署完成后的正常业务写入，不计入停服数据不变校验。

## 执行与验证命令

以下命令在生产机执行，`LM_RECORD` 为上述证据目录；构建上下文为已提交版本的
干净 `git archive` 解包目录，不包含生产配置或上传文件。

```sh
docker system df
git -C /home/localmind/LocalMind fetch origin main
git -C /home/localmind/LocalMind pull --ff-only origin main
/home/localmind/.local/bin/localmind-compose -f "$LM_RECORD/build.override.yml" build affine
bash "$LM_RECORD/validate-image.sh"
bash "$LM_RECORD/cutover.sh"
```

`validate-image.sh`：新镜像原生 Qwen SSE 4 项烟测、恢复库迁移、业务与历史
指纹、迁移状态全部通过。没有调用外部模型。

`cutover.sh`：停止应用、最后备份、记录数据库及文件基线、迁移、比对、运行
`node ./scripts/self-host-predeploy.js`、再次比对、启动应用及 adapter。
`predeploy.exit` 与 `cutover.exit` 均为 0。启动探测最初两次连接重置发生在
应用就绪之前，随后本机和公网验证成功。

构建前 `docker system df`：镜像 550.6 GB、构建缓存 474 GB（共享层统计不能
相加作为独占占用）。根据此前同一 Dockerfile 构建估算新增 18–26 GB，低于
30 GB 门限；宿主文件系统可用约 1.3 TB。构建后文件系统仍可用约 1.3 TB，
已用约 570 GB，相比初始约 555 GB 增加约 15 GB，包含备份与构建数据。
部署后有界 `timeout 45s docker system df` 未在时限内返回，不以其证明精确
Docker 增量；未清理缓存、镜像或持久数据。

## 正式日志链路验收

通过 `localmind-team-daily-log` 技能及正式 Workspace MCP 连接验证：
既有今日日志从 `contentWritable: false` 恢复为 `true`，上线后首次读取正文与
部署前完全一致。重新检查 externalId、全 Workspace 精确标题及目录位置后，
使用新版本和完整参数幂等键合并上传本次总结。

- 文档：`SDdYoyLcHY3akdz2wVaqF`。
- 标题：`2026-09-17｜member-01｜工作日志`。
- 路径：`Infinimesh/陆天毅/2026-09/2026-09-17｜member-01｜工作日志`。
- 回执：`87146d89-1147-4519-a48d-e5a9bd464028`，`succeeded/committed`。
- 完整读回保持可写；全部原有与新增非空行一致，仅 Markdown 空行规范化。
- 内容已保存，日期排序未完成；当前 MCP 不提供持久化排序能力。

## 剩余边界

既有 SMTP、许可证编译配置及 embedding 1024/4096 维度警告仍在。本次没有
验证外部模型或 embedding 实调用、完整浏览器手工流程及多节点负载。此前全量
Copilot 套件的既有失败不因本次聚焦测试和部署验证而视为解决。Markdown 有损
结构的原有限制继续适用。本记录是新增本地部署证据，尚未提交到 Git。
