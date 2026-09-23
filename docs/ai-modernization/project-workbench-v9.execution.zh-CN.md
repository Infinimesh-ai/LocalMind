# Project v9 工作台适配执行记录

日期：2026-09-22。Goal 状态：完成。本文只记录实际执行结果；未执行的检查不会写成通过。

## 1. 执行边界与依据

- 工作目录：`/Users/dev2/Documents/project/LocalMind`。
- 已完整读取 v9 Goal、实施方案、设计稿及 `AGENTS.md` 要求的 AI modernization、
  Project Native Resources、Project Workbench Redesign、Project AI Boundaries、Agent
  Runtime、Context Memory、Native Office、Docker 和用户行为权威文档。
- 采用 E01—E11 默认建议，没有重新询问已确认规则。
- 参考 HTML 仅用于设计核对；SHA-256 为
  `500bd5034853231df5c8dc01d03e1ab83c58645ef553780f1b8ef9cf1983b8de`。正式实现没有
  复制示例数据或模拟交互。
- 开始时 `main...origin/main` 已有大量修改和未跟踪文件。全部既有改动均保留；未执行
  commit、push、PR、业务环境同步、生产数据库操作、持久数据删除或子代理。

## 2. P0—P6 完成状态

| 阶段                | 状态 | 实际结果                                                                                                                                                                         |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 基线与方案收敛   | 完成 | 核对 dirty worktree、权威文档、HTML、现有 Project/Office/聊天/画布边界、Docker 镜像和磁盘；关系图采用无同步临时 BlockSuite GFX 宿主。                                            |
| P1 持久模型与作用域 | 完成 | 增加 `work_order` 第三类会话/Agent Runtime owner、个人工作状态、attention、工单、需求、交换、暂存 Blob、不可变交付 revision、采用、outbox、通知和数据库约束；迁移最终为 394 个。 |
| P2 运行时与业务闭环 | 完成 | prepare/confirm、精确收件人、独立私人会话、问答/拒绝/撤回、动态要求、文件容器校验、完整返回门禁、v1/v2、补充工单、采用 CAS、完成/重开、租约恢复及取消晚写防护全部持久化。        |
| P3 协议与实时投影   | 完成 | GraphQL schema/operation/client、工单工具、通知/outbox/realtime、15 秒对账、卡片/计数/分页、关系投影和 Project 全局 BYOK 接入完成。                                              |
| P4 工作台界面       | 完成 | 三栏个人看板、Project/工单路由、正式聊天复用、收发工单、版本历史/采用、F2 重命名、右侧 context/tree/resource 三态、全异步状态、中英文文案和无障碍列表入口完成。                  |
| P5 文件与关系       | 完成 | 复用原生 Page/Office/普通文件编辑器、保存/刷新、租约/版本保护；只读关系图支持缩放、fit、方向/状态筛选、自己的会话导航，500 边有界渲染且不写共享文档。                            |
| P6 集成验收与交付   | 完成 | 空库/旧状态迁移、真实多账号浏览器、原生文件编辑、四视口/浅深主题、Linux ARM64 容器、规模、生成、类型、lint、format 和负面安全回归完成。                                          |

## 3. 主要交付

### 3.1 后端与数据库

- `schema.prisma` 及迁移 `20260922010000`—`20260922040000`：v9 工作台完整持久模型、
  Office 来源固定 revision、采用来源和旧采用回填。
- `copilot-work-order.ts`、`copilot-work-order-agent-runtime.ts` 及 work-order resolver、
  controller、worker、storage、tools：个人工单业务状态机、不可变证据、幂等、CAS、租约、
  outbox 和账号删除/保全语义。
- Project 全局 BYOK、会话/上下文/Memory、Agent Runtime 和通知集成：工单会话没有
  Workspace/Project 隐藏成员关系，缺失或停用全局配置时不回退。
- 修复 v9 消息来源触发器与共享 Project Memory 的契约衔接：合法持久用户回合
  `conversation-input:*` 现在作为受控 Project 输入校验，私人/未知来源仍拒绝。

### 3.2 GraphQL、前端与原生文件

- 共享 GraphQL 新增个人看板、工单动作/聊天/收件人、关系图、完成/重命名和上下文整理
  operations，并重新生成 client schema。
- Project 工作台新增个人总览、三栏 conversation board、工单 composer/panel/chat、关系图、
  Project 会话树分页/F2、右侧上下文和焦点恢复。
- 正式 Project 文件树接入原生 Page/Office/普通文件 surface。修复本地开发时
  `0.0.0.0`/`localhost` Office 资产 URL 同源代理，以及不可变 Office revision 推进时浏览器
  已变更 `contenteditable` DOM 的重复文本问题。
- 暗色关系图文字改为主题色；关闭资源后按实际来源恢复到文件树/上下文资源按钮；分页失败
  有明确通知；新增中英文文案并重新生成 i18n。

## 4. A01—A42 最终验收矩阵

| 验收 | 状态 | 证据摘要                                                                                              |
| ---- | ---- | ----------------------------------------------------------------------------------------------------- |
| A01  | 通过 | 未选 Project 时保留草稿、显示选择提示、不挂载聊天且 GraphQL/模型/Memory 调用为 0。                    |
| A02  | 通过 | 真实 UI 创建并命名 Project；新会话显式预选该 Project，Agent 无创建 Project 能力。                     |
| A03  | 通过 | request key 重放维持单 session/单卡；失败草稿可恢复；手工标题 CAS 不被晚到自动标题覆盖。              |
| A04  | 通过 | 展开项目不切主区；切换会话正确；真实浏览器 F2 长中文保存并恢复原名，未改工单标题。                    |
| A05  | 通过 | 深链、刷新、Back/Forward 回到同一 owned session/resource；非法或越权 ID 统一 unavailable。            |
| A06  | 通过 | Project Memory 对有效成员共享；多账号证明聊天、私人附件、摘要和选择范围隔离。                         |
| A07  | 通过 | 一会话一卡、Project 标签/列计数/游标分页正确；1,001 历史会话首 30 条投影 37.82 ms；无队友私人卡。     |
| A08  | 通过 | 同一会话同时保留 question/delivery 两个 attention；回答只清 question，普通文本不清另一项。            |
| A09  | 通过 | 未结义务阻止完成；查看不重开；成功消息重开；普通 run 不自动完成会话。                                 |
| A10  | 通过 | prepare 与 confirm 分离；确认前 B/C 无卡、通知、关系；伪造确认指纹失败。                              |
| A11  | 通过 | 仅精确 ID/邮箱解析；大小写邮箱可用；未知、停用和站外地址统一拒绝且不枚举全站。                        |
| A12  | 通过 | B 无任何 Project/Workspace 仍进入自己的工单会话并使用全局模型；无隐藏成员关系。                       |
| A13  | 通过 | BYOK 10/10：缺失/停用不回退，revision 热更新仅影响后续调用，密钥不进入响应或审计。                    |
| A14  | 通过 | A 看不到 B 私聊，B/C 互不可见；D 的 GraphQL/Blob/SSE/图均拒绝且不泄露正文。                           |
| A15  | 通过 | 结构化动态 requirements 同时覆盖纯文字与真实 PPTX，不依赖固定字段。                                   |
| A16  | 通过 | 缺/空文本、空文件、伪 MIME/扩展、损坏 PPTX、未知 requirement、数量不符均不完成并保留草稿。            |
| A17  | 通过 | 真实 PPTX 可解析/下载，字节、MIME、容器、指纹和固定回执一致；文本交付亦独立完成。                     |
| A18  | 通过 | B 已返回而 C 未返回时 A 仅见进度；正文、下载、解析、模型/索引旁路和采用均锁定。                       |
| A19  | 通过 | 全部完成后原来源会话进入待处理；没有新接收会话；显式采用生成唯一 context version。                    |
| A20  | 通过 | B 追问后 A 待处理/B 等待；A 显式回答后 B 恢复待处理，双方时间线和通知一致。                           |
| A21  | 通过 | 拒绝原因必填；B 拒绝后即使 C 已交付仍不释放，直至 A 明确撤回 B。                                      |
| A22  | 通过 | 撤回保留原因和原拒绝记录；同 key 重放同证据；B 只收到一次取消通知。                                   |
| A23  | 通过 | 未结清单阻止完成；完成与确认派单由来源 session 行锁串行，不遗漏新义务。                               |
| A24  | 通过 | 取消/拒绝后成功私人消息只重开私人会话，工单仍终态且不把正文发送给 A。                                 |
| A25  | 通过 | 已交付/已采用 v1 固定；准备、放弃或无效 v2 不改变旧正文、指纹和 adoption item。                       |
| A26  | 通过 | 显式 v2 产生新 revision/通知；采用前上下文不变，采用后 epoch 推进，v1/v2 历史均可读。                 |
| A27  | 通过 | supplement/replace 使用新 ID 和新私人 session，原会话/要求/结果不覆盖或自动撤回。                     |
| A28  | 通过 | 取消/交付竞争唯一终态；prepare、交付、取消、采用重放返回相同证据且不重复资源。                        |
| A29  | 通过 | 过期租约由 DB 恢复到 attempt 2；Blob/回执不重复；取消后晚 worker 写入被拒。                           |
| A30  | 通过 | worker/客户端离线时 outbox 保留；恢复后稳定通知 ID 去重；已读通知不改变业务状态。                     |
| A31  | 通过 | revision/context CAS、旧轮重试、v1→v2 显式采用和缓存失效版本均有持久证据。                            |
| A32  | 通过 | 私人交付不自动生成 Project Memory；显式共享必须通过当前成员、来源和受众授权检查。                     |
| A33  | 通过 | 同一原生编辑区切换；树状态保留；真实浏览器关闭资源后焦点回到原 `demo` 文件按钮。                      |
| A34  | 通过 | Page 与真实 DOCX 在浏览器保存/刷新保留；四种 Office 格式 e2e 编辑/重开/撤权 5/5；维持原生类型。       |
| A35  | 通过 | edit guard、租约、版本冲突、AI handoff 聚焦测试通过；Owner 不绕过租约，浏览不自动加入上下文。         |
| A36  | 通过 | 图与角色同源，方向/状态/同人多单正确；只读缩放/fit/列表和自己的会话导航可用。                         |
| A37  | 通过 | D/C 空态及权限不泄露；500 边浏览器渲染无横向溢出；只读宿主不注册共享写入和编辑快捷键。                |
| A38  | 通过 | 会话/账号删除清理私人 payload；幸存者回执与共享 Memory 保留；legal hold 冻结，解除后恢复。            |
| A39  | 通过 | 旧文件请求 11/11、Project 发布 9/9、Workspace 导入 11/11、资源 API 5/5；旧授权/审批语义未变。         |
| A40  | 通过 | 394 迁移空库完整应用；390→394 fixture 升级及幂等重跑；停用新功能仍保留读取/收尾路径。                 |
| A41  | 通过 | 1440/1040/760/390、浅/深、500 边、长中文 F2、键盘和焦点真实浏览器验收无遮挡/溢出。                    |
| A42  | 通过 | 生成、三包 typecheck、聚焦 lint/format、Linux 容器、迁移、混合 scope/伪造身份/失效 ACL 负面回归通过。 |

## 5. 精确验证记录

### 5.1 生成、类型、格式和静态检查

- `yarn workspace @affine/server prisma format --schema schema.prisma`
- `yarn workspace @affine/server prisma validate --schema schema.prisma`
- `yarn workspace @affine/server prisma generate --schema schema.prisma`
- `yarn workspace @affine/graphql build`
- `yarn workspace @affine/i18n build`
- `yarn tsc -b packages/backend/server/tsconfig.json --pretty false`
- `yarn exec tsc -p packages/frontend/core/tsconfig.json --noEmit --pretty false`
- `yarn exec tsc -p packages/frontend/admin/tsconfig.json --noEmit --pretty false`
- `yarn lint:ox <v9 backend/frontend/GraphQL/Office changed source targets>`
- `yarn prettier --ignore-unknown --check <v9 changed targets>`
- `node /Users/dev2/.codex/skills/impeccable/scripts/detect.mjs --json <v9 UI targets>`：
  返回 `[]`，仅执行这一轮最终 detector。
- `git diff --check` 和 Goal 文件冲突标记扫描：通过，无输出。

上述命令最终均通过。为使完整前端/Admin typecheck 通过，还修复了既有测试中的冗余
Testing Library `exact` 参数和 Admin Observability i18n 数值参数类型；对应测试分别 3/3、
2/2 通过。

### 5.2 后端、前端和兼容回归

- `project-workbench-v9.e2e.ts`：12/12。
- `project-context.e2e.ts`：13/13；含 Project Memory、来源授权、删除和 compaction。
- `project-session.e2e.ts`：8/8；`context-session-retention.e2e.ts`：1/1。
- `project-global-byok.spec.ts`：10/10；`project-office.e2e.ts`：5/5。
- 旧 `project-file-request`、`project-publication`、`project-workspace-import`、
  `project-resource-api`：共 36/36。
- 工作台/Project resources/Office 聚焦前端：30 文件、152/152。
- 工单模型、聊天 runtime、上下文整理、旧任务 UI：6 文件、87/87。
- GraphQL workbench operations：19/19；Admin Observability：2/2；Import 键盘：3/3。

Office 全文件第一次复跑时四格式场景出现一次 `ECONNRESET`；单场景随即 1/1，通过后完整
文件再次 5/5，不存在残留失败。

### 5.3 迁移与规模

- `localmind_pw_v9_final_20260922`：从空库应用全部 394 个迁移；最终重跑返回
  `No pending migrations to apply`。
- `localmind_pw_v9_upgrade_v1`：先保留 390 迁移的 Project/Workspace 会话 fixture，再升级
  391—394；现有两类会话和 2 条 work state 完整，第二次部署无待迁移。
- `directory-scale.e2e.ts`：10,000 行、9,000 policy、64 层；首 100 行 200.98 ms / 15 次
  Prisma 调用，destination 页 105.90 ms / 16 次调用，101 页遍历 10,000 行 9,436.04 ms；
  policy drift/CAS 通过。fixture 保留在专用隔离库。
- v9 投影：1,001 历史会话首 30 条 37.82 ms；501 条同人多单有界为 500，22.79 ms，
  `truncated=true` 且 ID 不合并。

## 6. Linux 与浏览器证据

### 6.1 Linux 隔离验证

- `docker system df`：镜像 28.72 GB、容器 1.121 GB、volume 6.59 GB、build cache
  3.586 GB；没有预计新增 30 GB 的重建动作。
- 固定镜像：`localmind-affine:dev-base`（ID `1bb126f97249`）；复用现有
  `localmind_office_surface_verify`，Linux ARM64、Node 22.23.2、Yarn 4.13.0。
- 容器内先为其独立 `node_modules` 卷生成当前 Prisma Client，再执行：
  - 前端/GraphQL 6 文件 54/54；
  - `project-workbench-v9.e2e.ts` 12/12；
  - `yarn tsc -b packages/backend/server/tsconfig.json --pretty false` 通过。
- 没有重建 `dev-base` 或 `local`，没有创建新 tag。

### 6.2 真实多账号浏览器

- 隔离服务：前端 `8080`、后端 `3025`、PostgreSQL `55432`、Redis `56379`。
- A=`dev@localmind.test`；B/C 为非 Project/Workspace 成员接收人；D 为无关账号。
  Project=`be0b0ad0-54fe-4ea6-a042-2e9b289a8d52`，源会话=
  `f842fb2a-2bff-4ae4-a0dc-de45f5be4fa1`，B/C 工单分别为
  `0cf9fc6a-3879-47bc-93a4-8b2970736c39`、
  `5b714529-a6c4-41b1-8e5f-0740ecfbdbd4`，采用=
  `e5b6f6f4-f8a4-4aaf-acde-cdec436bec61`。
- 真实流程完成确认前隐藏、确认后各自可见、B 追问/A 回答、部分交付锁定、全部交付、C v2、
  A 显式采用、D 越权拒绝。B 的私人会话通过本地 OpenAI-compatible 探针向
  `/v1/responses` 发送模型 `localmind-v9-test`，收到精确响应且全局配置写入
  `last_used_at`；B/C/D 始终没有隐藏成员关系。
- Page 资源 `93c5601f-43ed-46fe-9002-a36f00b72988` 保存正文后刷新保留；真实 DOCX 资源
  `dcf1906c-aa32-4fcf-a2bd-ee82105457dc` 完成编辑、保存、revision 推进和刷新，无重复正文。
- 已恢复浏览器 Appearance=`System` 并清除临时 viewport override。

截图位于 `.codex-artifacts/project-workbench-v9/`：

- `browser-responsive-{1440,1040,760,390}-relations-500.jpg`
- `browser-dark-{1440,390}-relations-500.jpg`
- `browser-f2-long-chinese-dark-1440.jpg`
- `browser-project-native-document-editor-dark-1440.jpg`
- `browser-project-native-docx-editor-dark-1440.jpg`
- `browser-project-file-tree-docx-dark-1440.jpg`

## 7. 已解决问题与剩余风险

已解决：本地 Office loopback hostname 不一致、Office 保存后 `contenteditable` 重复文本、
关闭资源焦点错误、暗色关系图低对比、Project Message 来源前缀授权断层、分页 Promise 未处理、
测试集合顺序断言、Linux Prisma Client 漂移。所有修复均有聚焦回归。

剩余风险仅限本次明确未授权的运营步骤：尚未同步业务环境、未修改生产数据库、未构建或
发布运行镜像、未做 commit/push/PR。隔离数据库、测试容器和证据文件均按“不删除持久数据”
要求保留。Node `module.register()` deprecation 和测试环境 localStorage warning 仍会输出，但未
影响本次结果；后续工具链升级可独立处理。
