# Project 个人工单 AI 辅助交付：实施与验证记录

日期：2026-09-29。对应[产品契约](project-work-order-ai-delivery-contract.zh-CN.md)。

## 2026-09-30：Markdown 工单失败与占位交付修复

通过 `ssh localmind` 只读核对 infinimesh 项目工单 `21a632b1-…`、接单会话
`28fdc284-…` 和 run `f21262a0-…`。最初两次生成 TXT、一次生成 DOCX，均因冻结要求
只接受 Markdown 而失败；后续重试生成了“暂无业务内容”的 Markdown 说明文件，
收件人确认后工单已经变为 `delivered`。因此原问题既有生成失败无反馈，也有占位
内容被误作业务交付。此次未修改远端工单、不可变回执或会话记录。

根因与修改：

- 工单冻结上下文以第二条 `system` 消息插入，而 native request 构造仅保留第一条
  `system`。远端运行 sourcemap 也确认存在此路径。改为与 Project 引用一致的
  `user` 参考数据，明确它不能授权变更权限或豁免要求；用真实 native 请求构造验证
  要求 ID、CPU 主题、内容说明、MIME 均进入请求，发单人私人历史仍不进入。
- 原格式校验发生在异步暂存阶段，AI 只能看到缺项。现在复用原生文件 writer 的
  MIME 映射，在生成入队前拒绝不匹配格式并提示支持的 `content.format`。真实
  Blob 暂存校验继续保留，不放宽允许格式。
- 草稿检查向接单人返回每项最新任务状态、格式和有界错误码，转换状态通过现有
  durable realtime outbox 刷新。工具同时返回冻结要求，失败不再假装排队；发送方
  和其他用户不能读取私有任务、正文或原始 worker 错误。
- AI policy 区分“没有补充资料”和“无法提供交付物”，含糊回答先澄清，后者引导
  本人填写原因并确认拒绝。禁止生成无内容占位文件；就绪卡片提醒核对业务内容。
  这属于上下文与行为指引修复，没有新增通用语义判定器或自动拒绝权限。

实现主要位于 `runtime/turn-orchestrator.ts`、`tools/work-order-file-create.ts`、
`models/copilot-work-order-agent-runtime.ts`、`models/copilot-work-order.ts`、
共享 `office/src/create.ts` 及接单对话的 `work-order-generation-status.tsx`。
GraphQL schema、operation/client 和 i18n 均通过现有生成流程更新；没有数据库模型
变化或新增迁移。依据本契约以及 Agent Runtime、Project Native Resources active track。

验证环境复用固定镜像 `localmind-affine:dev-base`，以临时 Linux runner 和一次性
PostgreSQL/Redis 执行；数据库从空库应用全部迁移，没有使用业务数据库。未重建
镜像，未同步或部署本机/远端业务服务。验证时 `docker system df`：镜像 29.22 GB、
容器 1.617 GB、卷 19 GB、构建缓存 3.586 GB；未删除持久卷或其他项目镜像。

聚焦命令与结果：

```sh
docker exec localmind_workorder_validation yarn workspace @affine/server test src/__tests__/copilot/project-workbench-v9.e2e.ts src/__tests__/copilot/file-create-input.spec.ts
docker exec localmind_workorder_validation yarn workspace @affine/server test src/__tests__/copilot/project-workbench-v9.e2e.ts --match='recipient-confirmed inability*'
docker exec localmind_workorder_validation yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/work-order-generation-status.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/work-order-delivery.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/work-order-panel.spec.ts packages/common/office/src/create.spec.ts --maxWorkers=1
```

已通过 41 个不重复测试：既有后端回归及新增上下文/生成恢复用例 29 项，确认拒绝
专项 1 项，前端和原生文件 writer 11 项。覆盖入队前 TXT/DOCX 拒绝、旧失败可见、
Markdown 实际生成、草稿恢复、幂等、确认前不交付、拒绝权限/原因/单一通知/无回执。
模型行为本身未调用生产 provider 做端到端评估，测试不证明任意自然语言内容合格。
真实提示组件在隔离预览中验证了桌面浅色和 420px 深色、失败到排队到就绪状态，
无横向溢出，旧错误会随状态更新清除；尚未在生产客户端验证完整往返。

后端整包 TypeScript、Office/GraphQL 声明构建及本轮后端/前端文件的定向类型检查
通过；所改 TypeScript 的仓库 ESLint/oxlint、Prettier、`git diff --check` 通过，
新增提示组件的设计扫描无发现。日志保存在本地 `.codex-artifacts/workorder-fix-*`。
通用语义检查仍未实现，已经确认的错误交付不能靠覆盖历史回执修正；运行环境
上线与该工单后续业务处理须分别执行。

## 已落地

- 新工单写入模板版本 2；发单人确认后才创建各收件人的工单、通知与私人会话。版本 1
  的既有提交接口仍保留，版本 2 的公开接口要求进入交付草稿确认流程。
- 新增收件人独有的 `WorkOrderDeliveryDraft`，以工单 ID 为主键、版本号防止覆盖，
  数据库约束确认草稿所有者是收件人。AI 文字工具先读取版本再保存；AI 生成文件与
  用户上传文件在成功暂存后自动关联对应要求。
- 工单详情返回逐项就绪结果；真实文件读取会核对可用性、元数据和字节指纹。待我
  行动卡片展示发单人、来源项目、必填返回项及草稿缺项数。接单对话展示准确交付
  预览和确认按钮；同一确认请求键重试返回同一不可变回执。
- `bounded_model` 的语义条件暂无可靠证据，按失败关闭：新工单拒绝该模式，历史
  工单不自动认定文字非空即满足语义条件。支持的文字和文件模式分别验证非空内容
  与真实容器；发单人确认草稿时仍需审阅业务要求表述。

## 验证

- 独立 PostgreSQL 数据库从空库应用全部 406 个迁移，包括新增草稿迁移；
  `prisma validate` 与 `prisma generate` 通过。
- 在 `localmind-affine:dev-base` 临时 Linux 容器中运行三个聚焦 AVA 用例，均通过：
  私人会话和 GraphQL 作用域、版本 2 旧提交入口拒绝；文字与真实 PPTX 草稿、
  缺项、版本冲突、文件实体丢失、确认、重试及单一回执；既有 PPTX 容器损坏拒绝
  与私有生成任务重放。
- Linux 容器内的三个精确测试命令（均使用隔离 PostgreSQL 与 Redis）为：

  ```sh
  yarn workspace @affine/server ava --serial --timeout=5m --match='relationship GraphQL scope keeps drafts private and opens only the actor conversation' src/__tests__/copilot/project-workbench-v9.e2e.ts
  yarn workspace @affine/server ava --serial --timeout=5m --match='work-order delivery draft requires the real PPTX and recipient confirmation' src/__tests__/copilot/project-workbench-v9.e2e.ts
  yarn workspace @affine/server ava --serial --timeout=5m --match='real private PPTX staging validates containers, replays once and records work-order runtime evidence' src/__tests__/copilot/project-workbench-v9.e2e.ts
  ```

- GraphQL schema 与客户端、i18n 由仓库生成命令更新；后端及前端 TypeScript
  检查通过；工单草稿及待我行动卡片共 4 个 Vitest 用例通过；所改源码的 oxlint、Prettier
  与 `git diff --check` 通过。
- 未重建任何镜像，使用现有固定 tag `localmind-affine:dev-base`；验证前
  `docker system df` 显示镜像 31.94 GB、容器 4.34 GB、卷 18.53 GB、构建缓存
  3.586 GB。未同步到正在运行的 3011 服务，因为当前工作树还包含其他任务的
  大量未提交改动；因此新的交互尚未在真实浏览器的目标视口与主题中验收。

## 后续边界

每次打开就绪预览都会重新读取候选文件，确保丢失或损坏的附件不显示可确认状态；
大量接近 100 MiB 的文件可能带来预览耗时，需在运行环境中测量并优化。通用
自然语言内容条件没有可信自动放行路径，后续若引入语义检查，应持久化有界证据并
绑定草稿版本、要求指纹及人工确认，不能把模型自报“完成”当成事实。
