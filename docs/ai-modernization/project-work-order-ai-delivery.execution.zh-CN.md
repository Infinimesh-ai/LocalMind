# Project 个人工单 AI 辅助交付：实施与验证记录

日期：2026-09-29。对应[产品契约](project-work-order-ai-delivery-contract.zh-CN.md)。

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
