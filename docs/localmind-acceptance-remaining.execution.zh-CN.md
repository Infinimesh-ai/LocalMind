# LocalMind 验收剩余项修复记录（2026-10-28）

本轮处理验收清单 TODO-05—TODO-12。代码先在 `LocalMind-qa143` 隔离源码副本与 Linux 容器中验证；隔离数据库、账号、文件和模型配置均为验收用途。原工作区已有改动按逐文件备份核对后保留。未提交、推送或发布镜像。

## 修复内容

- **TODO-05 / QA-128**：保存失败保留完整本地草稿；远端已产生新修订时，只以原命令和原幂等键核对未决回执，确定拒绝后才能放弃。恢复最新状态同时清除冲突/失败标志，允许继续编辑保存。离开确认提供只读草稿文字预览和复制反馈。文字恢复不承诺保留富文本排版。
- **TODO-06 / QA-131**：增加有界、事务化历史键修复工具，默认仅预览；应用需要数据库备份、暂停 worker、预览指纹和审计 actor。仅修复可确定的独立代号事实；问句、删除意图和多事实混合语句保留待人工判断。已删除、停用、过期、隔离、来源会话删除或有更新事实的记录不复活。旧事件和贡献关系保留，跨事实 supersedes 关系安全拆分，修复事件不可普通撤销。
- **TODO-07 / QA-132**：Rule 从参考记忆中分离为明确的用户指令；记忆与滚动摘要继续作为参考数据。v7 中规则正文仍留在 user 消息，不能覆盖平台、Workspace Policy 或权限。当前用户直接冲突的明确要求优先；v6 配置和指纹独立归档并可回放。真实模型输出及持久化消息均已包含尾注，实际显示问题是 Markdown 的折叠 Sources 标题隐藏了引用定义后面的正文；现将引用定义集中至文末，正文保持可见，不改写历史消息。
- **TODO-08 / QA-139**：工作区文档和上传索引文件使用持久化任务账本，区分排队、运行、成功和终态失败。生成号、运行号、租约和 CAS 阻止旧 worker 覆盖新结果。整批向量完成后事务提交；失败不留下半批“成功”。失败列表与同资源重试通过 GraphQL 和 UI 提供，上传成功但排队失败不诱导重复上传。旧文件缺少来源用户时明确要求重新上传。
- **TODO-09 / QA-136**：验证已有分页一致性实现；目录或权限快照变化时整体重试一次，再次变化给出明确提示，不拼接不同快照。
- **TODO-10 / QA-140**：普通中间失败继续由队列重试，只有最后一次失败进入终态失败；成功后同任务状态收敛。
- **TODO-11、12**：默认凭据名选取未占用序号；服务端保留唯一约束并映射并发重名错误；保存失败保留草稿。首次、重复测试、空模型列表和失败都有清晰反馈，错误脱敏。

## 页面证据

真实页面操作使用本地隔离 Web `3031` / Admin `3033`；接口仅用于测试夹具和故障控制，不代替 UI 验收。

| 场景                               | 结果与证据                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 250 个目录、多账号、数据库事务超时 | PostgreSQL 锁等待制造事务超时；页面保留输入，随后重试保存成功。`qa128-timeout-draft.png`                                                                                                             |
| 同一 Word 并发修订                 | A 保存失败后保留草稿，B 保存远端新正文，A 取回文字、返回新修订、合并并再次保存；新页面读到双方正文。`qa128-restored-reloaded.png`                                                                    |
| 草稿可见恢复                       | 离开确认显示双方正文和 `QA128_PREVIEW`，复制反馈明确，随后保存并完成导航。`qa128-visible-draft-recovery.png`。自动化剪贴板接口未反映页面写入，不能以该接口证明系统剪贴板内容；可见预览支持手工选取。 |
| 历史独立事实                       | 修复夹具后设置页面出现两个独立 active 事实，真实模型回答同时召回 `QA131_AZURE` 和 `QA131_COLUMN`。`qa131-restored-memory.png`                                                                        |
| 普通文件后的 Rule                  | 旧回答重新打开即显示尾注；新一轮真实 `workspace_resource_list`、`workspace_file_read` 调用后同样显示尾注。`qa132-history-footer-visible.png`、`qa132-file-rule-footer.png`。                         |
| 索引终态失败                       | 真实上传文件，隔离提供商持续 503，队列耗尽后显示失败；重新打开设置仍显示失败；点击重试后同文件成功，未重复创建。`qa139-provider-failed.png`                                                          |
| 嵌入先失败后成功                   | 第二个真实上传文件，同任务提供商先 503 后 200，最终页面为已同步 2/2。`qa139-qa140-index-complete.png`                                                                                                |
| 目录快照变化                       | 一次变更自动重新读取三页；两次变化分别在分页门闩 100、101 期间由成员页面重命名，UI 显示“加载期间目录或权限发生变化，请重试”。`qa136-double-change.png`                                               |
| BYOK                               | 重复成功、空模型、503、本地重名、并发重名及更名后保存通过。`byok-*.png`                                                                                                                              |

截图位于仓库 `.codex-artifacts/acceptance-remaining/`。请求跟踪只记录消息角色、长度和测试标记是否存在，不记录密钥或完整提示词。索引采用本地确定性 4096 维模拟向量，证明状态机和 UI 恢复，不代表商业模型向量质量。聊天使用已配置服务商的真实模型 `gpt-6.1-sol`；业务配置未修改。

## Linux 验证

复用 `localmind_qa122_sync_source`、`localmind_qa143_backend/web` 与独立数据库。复用镜像为 `localmind-affine:dev-base`，没有重建镜像。

- Context planner：42 项，包含 v6 回放、权限/信任边界、工具轮次和上下文预算。
- Markdown 适配器：63 项，新增单引用及多引用后仍有正文的回归。
- 历史 Memory 修复：5 项，覆盖禁用/删除、历史事件、并发预览漂移、幂等及歧义拒绝。
- 索引账本：7 项；索引 UI：2 项。
- 文档编辑：51 项；资源会话：10 项；资源界面：7 项。
- 目录与资源服务：36 项。
- BYOK Admin：14 项；probe：19 项；后端并发唯一性：1 项。
- 后端完整 TypeScript、变更前端文件聚焦 TypeScript、oxlint、Prettier、GraphQL/Prisma/i18n 生成按本轮变更执行。
- 全新库应用全部 423 个迁移；旧库从 420 升至 423，并验证既有未索引文件补为 `source_owner_missing` 且原文件保留。

主要命令：`yarn workspace @affine/server test <focused spec>`、`yarn vitest run <focused specs>`、`yarn workspace @affine/server tsc --noEmit`、`yarn lint:ox <changed files>`、`yarn prettier --ignore-unknown --check <changed files>`、`prisma migrate deploy`。详细日志保存于 `/tmp/localmind-remaining-evidence/`。

## 本地集成

57 个任务相关文件已按本轮修改前备份逐文件核对后合并至原工作区，保留既有未提交改动。后端 watcher 和 worker 暂停后，使用 `pg_dump -Fc` 生成完整数据库备份：`.docker/dev/localmind-hot/backups/acceptance-remaining-20261028.dump`，2,004,600,034 字节，`pg_restore --list` 成功读取 2,826 个目录项。

业务历史修复共检查 11 条旧分类，实际修正 2 条确定错误键、恢复启用 0 条，保留原停用/被替代状态和不可变事件；另 9 条属于项目代号或歧义陈述，保持原分类。再次预览已无可确定待修复键或可恢复记录。审计 actor 为 `local-maintenance:acceptance-todo-20261028`。

通过标准 source 同步流程更新本地运行环境，命令如下：

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_qa122_sync_source \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_qa122_sync_source \
LOCALMIND_DATABASE_BACKUP=/Users/dev2/Documents/project/LocalMind/.docker/dev/localmind-hot/backups/acceptance-remaining-20261028.dump \
fnm exec --using 22.23.0 yarn localmind:sync:backend
```

同步会暂停本地服务，并通过现有 Compose 重建容器以重新绑定 native；不构建镜像、不删除数据卷。Web/Admin 继续使用源码 bind mount，通过原 Compose 启动加载新代码。迁移已成功应用，业务库现为 423 个迁移。脚本的 60 秒就绪等待因 Web 首次编译超时退出；随后独立复核 `http://localhost:3011/` 返回 HTTP 200，`/graphql` 的 `{ __typename }` 返回 `Query`，浏览器实际显示 LocalMind 登录入口，Web 与 Admin 均编译成功，worker 已恢复。

隔离测试中临时复制的真实模型凭据已清空并停用，临时全局模型配置已移除，故障开关恢复为空，验证 Web/Admin 容器已停止。备份保留在原工作区。本轮不提交、推送或发布生产镜像。

最终 `git diff --check` 通过；磁盘剩余约 46 GiB。验证日志位于 `/tmp/localmind-remaining-evidence/final/`，同步日志与数据库修复预览/应用结果位于其上级目录。未执行全仓 TypeScript 检查；已执行后端完整检查和变更前端/Markdown 的聚焦检查。
