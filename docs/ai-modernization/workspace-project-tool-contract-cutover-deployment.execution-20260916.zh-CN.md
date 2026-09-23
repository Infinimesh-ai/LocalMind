# Workspace/Project 工具契约切换与全文索引恢复执行记录

日期：2026-09-16。已完成远程部署和服务端验证。按照用户后续明确要求，不要求登录账号，不执行需要账号的网页和 MCP 业务写入验收。

## 部署结果

| 项目                         | 结果                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| SSH 目标                     | `localmind`                                                               |
| 服务器源码                   | `/home/localmind/LocalMind`                                               |
| 分支                         | `main`，通过 `git pull --ff-only origin main` 更新                        |
| 部署提交                     | `b10a1b40cf4bc1d9a0b9b2e3732bac9ace8a6e6f`                                |
| 前一运行提交                 | `38b6807558039d14653b8f95ab89bf70aa54ab52`                                |
| 固定运行镜像                 | `localmind-affine:local`                                                  |
| 新镜像 ID                    | `sha256:83730a05d16b889baed74a8b9905f20c22f3b8a6f4720d634dcacf5b245d1d0f` |
| 镜像大小                     | Docker inspect 返回 `742587189` 字节                                      |
| 旧镜像 ID                    | `sha256:859e64dece70556211706108a4b289865c4b17b2bddfba5cb04f61e25d16ce68` |
| 维护窗口                     | `08:02:20–08:07:03 UTC`，4 分 43 秒                                       |
| 本机 HTTP                    | `http://127.0.0.1:3011/`，200                                             |
| 公网 HTTP                    | `https://localmind.infinimesh.cloud/`，200                                |
| 应用状态                     | running，重启次数 0                                                       |
| 迁移服务                     | 新镜像，退出码 0                                                          |
| PostgreSQL / Redis / adapter | healthy                                                                   |
| 搜索服务                     | `manticoresearch/manticore:10.1.0`，healthy，无宿主机端口映射             |

服务器上的另一套 AFFiNE 实例未改动。未删除既有 volume、数据库、Blob 或历史任务。用于恢复演练的 runner、测试 PostgreSQL 和测试 Redis 已停止，演练数据保留。

## 构建与上线前验证

本次使用既有 `localmind-affine:test` 做恢复演练，重建固定 `localmind-affine:local`，未重建 `dev-base` 或 `test`，未创建其他镜像 tag。

构建上下文由部署提交的 `git archive` 生成，位于备份记录目录的独立 `source/` 子目录。备份、环境文件和部署凭据均在构建上下文之外。源码归档 SHA-256：

```text
95979d5339264ee8a963d7ee4e507fcd6a54d5a45f6cb9c81d2ccd0a864953e1
```

实际构建命令：

```sh
/home/localmind/.local/bin/localmind-compose \
  -f /home/localmind/backups/localmind-deploy-20260916T071307Z/build.override.yml \
  build affine
```

退出码为 0。Linux x64 原生 release 编译、Dockerfile 中的格式检查及 Web、Admin、mobile、server 打包全部通过。Docker 缓存检查和大量小文件的镜像层处理是构建期间的主要等待阶段，旧应用在整个构建期间继续运行。

新镜像通过了原生文档创建/解析往返检查、新工具契约和维护 CLI 打包检查，以及在真实备份升级库上的 CLI 幂等复查。代码修复此前已通过 303 项后端、11 项前端验证；本次增加的维护逻辑通过 2 项 Linux 聚焦测试，以及后端、Copilot 测试和 CLI 类型检查、lint 与格式检查。实现细节见[修复执行记录](./workspace-project-ai-write-authorization-remediation.execution.zh-CN.md)。

## 备份与一致性

远程记录目录：

```text
/home/localmind/backups/localmind-deploy-20260916T071307Z
```

该目录限制其他用户访问。在线备份已实际恢复到隔离 PostgreSQL，并完成从 367 条到 369 条 schema 迁移的升级与旧任务收敛演练。停服后另做最终备份，归档均非空，并通过 `pg_restore --list` / `tar -tzf` 可读性检查。

| 最终备份              |   字节数 | SHA-256                                                            |
| --------------------- | -------: | ------------------------------------------------------------------ |
| `database.final.dump` | 62523945 | `e902512a4e088fe6678778627590e2c2781587ccf23528855e927528ee1da80f` |
| `files.final.tar.gz`  |  3975625 | `47f464a2298d620e93bbfb4b0c7211c2312387963a7519b4a31ee131d560aca1` |

文件备份包含 Blob/storage、配置及企业连接器目录；原 Compose、环境文件、挂载映射、旧镜像与提交信息也已保存。报告不包含环境文件内容、凭据或正文。

切换前后及新应用启动后的核对结果：

- 原有 395 个终态 run 的记录、step、timeline 和 execution result 指纹保持一致。
- 原有 69 条来源审计、71 条 MCP tool call 及既有请求身份/能力快照保持一致；审计比较排除新迁移新增的版本列，保留原有证据字段。
- 5 个用户、6 个 Workspace、10 个成员关系、120 条 workspace page 元数据、132 份同步快照、1 个 Project、113 个 Blob 记录数量保持一致。
- Project 原生资源和 Office artifact 原先均为 0，切换后仍为 0。
- 停服切换阶段的全部文档快照内容指纹保持一致；待合并 update 为 0。

## 数据库与旧任务切换

应用停服后先完成两条 schema 迁移，为维护命令所需的审计版本和 Project 终态回执提供结构：

```text
20260916010000_workspace_live_acl_audit
20260916020000_tool_contract_retirement_receipt
```

随后使用正式发布产物 `/app/dist/retire-tool-contracts.js` 完成 dry-run、apply 和重复执行验证。apply 设置 `LOCALMIND_WORKERS_PAUSED=1`，并使用 `--reconcile-before=2026-09-16T06:00:00Z`。

| 项目                                  |  结果 |
| ------------------------------------- | ----: |
| 受影响旧契约 run                      |     2 |
| 以 `tool_contract_retired` 收敛的 run |     2 |
| 同步收敛的关联 MCP 请求               |     2 |
| 按既有失败证据收敛的历史滞留 MCP 请求 |     4 |
| 新增 timeline 事件                    |     4 |
| 取消 callback                         |     0 |
| 无法归类 / 并发条件冲突               | 0 / 0 |
| 重复 apply 新增改动                   |     0 |
| 上线后受影响旧契约非终态任务          |     0 |

4 个滞留请求分别由已失败 run、原始失败回执或未进入执行阶段的证据判定，没有重放业务操作，也没有改写原终态 run。新请求契约为 `localmind-tool-agent-request/v6`，Workspace / Project 工具使用各自前缀，未启用旧工具别名。

标准 `self-host-predeploy.js` 运行成功，迁移容器退出码 0。最终检查：369 条有效 schema 迁移全部完成，9 类数据迁移均完成，没有待执行 schema 迁移或未恢复的失败迁移。

## 索引恢复与覆盖率

使用独立 Compose 补充文件启用 Manticore。通过现有 `import-config` 入口保存三个索引配置键，再在所有索引 worker 停止时执行：

```sh
node /app/dist/main.js revert RebuildManticoreMixedScriptIndexes1763800000000
node /app/dist/main.js run
```

两条命令使用 `SERVER_FLAVOR=script`。建表与重建成功，6 个 Workspace 全部排队，然后启动新应用消费任务。

| Workspace SID | 有效同步文档 | 已索引文档 | 回收站文档 | 缺失 / 解析失败 |
| ------------- | -----------: | ---------: | ---------: | --------------- |
| 2             |            2 |          2 |          0 | 0 / 0           |
| 3             |            2 |          2 |          0 | 0 / 0           |
| 4             |            2 |          2 |          0 | 0 / 0           |
| 5             |           74 |         74 |         27 | 0 / 0           |
| 6             |            2 |          2 |          0 | 0 / 0           |
| 7             |            3 |          3 |          0 | 0 / 0           |
| 合计          |           85 |         85 |         27 | 0 / 0           |

`doc` 表 85 条，`block` 表 3304 条。覆盖率基于各 Workspace 根文档树中有效、非回收站且已同步的文档计算；其他未挂入根文档树的快照保留，不擅自挂载或删除。

对 14 篇既有旧文档执行 28 次标题/正文关键词探测，全部命中；探测前没有编辑这些文档。当前单个 Workspace 均未超过 200 篇有效文档，因此不存在需要从第 200 篇之后选取的样本。

索引队列 waiting、active、prioritized、failed 均为 0。仅保留一个正常周期性 `indexer.autoIndexWorkspaces` delayed job。启动后日志有 85 条文档同步记录，没有解析失败、Job failed、搜索提供方缺失、关键词索引不可用或 ERROR。

## 后续运维入口

基础 Compose 仍是：

```text
/home/localmind/LocalMind/.docker/selfhost/compose.localmind.yml
```

索引补充配置：

```text
/home/localmind/LocalMind/.docker/selfhost/compose.localmind-indexer.override.yml
```

服务器已保存以下包装命令，后续 Compose 操作应使用它，以同时加载原环境和索引补充配置：

```sh
/home/localmind/.local/bin/localmind-compose ps --all
/home/localmind/.local/bin/localmind-compose logs --tail=100 affine localmind_indexer
```

本机实际 Manticore 镜像通过动态配置监听容器 IP 的 9312 端口。手册原始 `searchd --status` 会检查错误的 loopback 地址，产生误报。本次健康检查使用已经实测通过的：

```sh
searchd --status --config /etc/manticoresearch/manticore.conf.sh
```

搜索服务仅在 Compose 私网开放，数据使用独立持久化卷。

## 磁盘与验证边界

构建前 `docker system df`：镜像约 503 GB，构建缓存约 428.8 GB。预计构建新增 18–26 GB，低于 30 GB 停止阈值。宿主机文件系统使用量从约 503 GiB 增至 519 GiB，仍有约 1.4 TiB 可用空间，使用率 28%。未执行镜像、缓存或数据卷清理。

构建后的 `docker system df` 在 55 秒上限内未返回，已记录退出码 124；因此不伪造 Docker 分类占用变化，以实际文件系统检查和新镜像大小作为补充证据。

按用户要求未登录账号做网页、AI 或 MCP 的真实业务操作验收。服务端代码验证、真实备份升级演练、历史完整性、HTTP、索引覆盖与旧文档关键词探测均已完成。

启动日志仍提示 SMTP 未配置、AFFiNE 商业版编译密钥未设置，以及现有 Embedding 路由声明 1024 维但 Workspace 向量索引要求 4096 维。本次没有修改这些配置。全文索引已验证成功；Embedding 向量索引不属于此次索引恢复手册的范围，不以全文检索成功代替向量索引验收。
