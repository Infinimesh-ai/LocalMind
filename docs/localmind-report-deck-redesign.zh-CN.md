# 汇报演示（Report Deck）重构：实施方案与改动清单

> 日期：2026-10-15 ｜ 状态：原始方案记录；现行交互以 2026-10-16 契约为准 ｜ 范围：前端 + 后端 + `@localmind/office`

## 2026-10-27：分步演示首章可见性

当章节标题本身属于演示分步时，进入演示或重新进入章节时先显示包含标题的步骤；
标题未被分步隐藏的章节仍从原有初始步骤开始。向前或向后导航继续遵守分步顺序，
不能退到隐藏标题的空白步骤。精确识别的旧版受信运行时及其 CSP 在读取时升级，
原始存储不变；未知脚本或 CSP 不匹配时不做替换。

本地页面复测了原先首章空白的汇报：首章在演示中保持可见，后续内容按步骤出现，
完成步骤后进入第二章。Linux 容器中的运行时及读取兼容聚焦测试 26 项通过；
此结果不代表全部浏览器、离线文件或整体验收已经通过。

## 2026-10-20：页面验收中的章节导航与阅读恢复修复

真实页面复现了两条状态错误：模板从末章选择首章后立即进入演示，会被平滑滚动的中间位置
覆盖为第 6 章；自定义 v4 汇报在分步演示后返回阅读，已进入视口的标题和图表可能持续隐藏。
前者保留用户选定的跳转目标，抵达、有界超时或手动滚动后恢复位置观察，同时忽略尚无尺寸的
章节；后者在返回阅读时恢复全部可见视图中的 reveal 内容，再次演示仍按原步骤展示。

旧报告只对精确识别的受信 shell/runtime SHA-256 及对应 CSP 做读取时兼容，保留正文、设计
CSS、其余受信脚本和数据库原始 HTML。查看与下载共用兼容路径；任意未知脚本或缺失 CSP
哈希不进入替换。沉浸全屏继续隐藏应用导航与底部控件，方向键先完成自定义分步展示再切章。

在现有 Linux `localmind_hot_web` 容器中，runtime、web-shell、web-v4、deck、deck-viewer
共 100 项聚焦测试通过；common/office 类型检查通过。真实页面复测原模板首章立即演示保持
1/7、方向键切章及 Escape 返回阅读；原 QA80 存档通过顶部和内部全屏入口，返回第二章阅读
后 24 个 reveal 元素及图表完整显示，HTML 下载成功。浏览器工具禁止打开本地 `file://`，
离线文件实际演示尚未验证，不能以下载或合成测试代替。

源码通过已有 bind mount 生效，未重建镜像、迁移数据库或改写历史汇报。自定义快速生成本轮
真实成功。随后精修任务 QA81 在首次 timeout 后通过页面重试生成五章，界面确认模型视觉
复核完成；图表数据展开、章节切换、全屏退出及 HTML 下载均经过页面操作。
历史超时根因仍未确认，已补充不含提示词、来源正文或凭据的阶段/耗时/错误码诊断；
未修改超时阈值，也未将一次重试成功视为可靠性问题完全修复或整体发布验收通过。

## 2026-10-19：模板图库尺寸与 Safari 绘制修复

图库改用按行排列的 Grid，替代下文原始方案中的 CSS 多列瀑布流。同一视口内的 10 张卡片
等宽、等高，行列间距统一为 18px；随内容容器宽度切换 3 / 2 / 1 列。卡片保持 14px 圆角，
封面按边框内侧的 13px 圆角直接裁切缩放 iframe；配置页选模版的封面使用其对应的 10px 内圆角。
封面仍为 16:9 静态缩略图，文字完整换行，标签对齐底部，不改变汇报正文的流式布局。

Safari 隔离对照页使用真实模板封面，恢复旧多列布局、卡片悬停位移与预览按钮的背景模糊后，
复现里程碑卡片悬停时封面及内容消失、预览按钮仍可见的绘制故障。分别去掉背景模糊或卡片位移，
均未再出现该故障。修复移除这些合成效果，保留边框、阴影与预览按钮淡入；封面直接裁切也修复
原先依赖外层 `overflow` 时露出直角的问题。触摸设备始终显示预览入口，键盘聚焦仍可显示并打开预览。

验证使用 macOS 上的真实 Safari 26.6.2（21624.5.1.11.3）与本地 `localhost:3011/reports`：

- 桌面宽 1728px：3 列，10 张卡片均为 364 × 326.625px；响应式设计模式宽 753px：2 列，
  均为 337.391 × 337.656px；宽 390px：1 列，均为 350 × 344.75px，无横向溢出。
- 全部 10 张卡片悬停、滚动后回看、预览打开与关闭、键盘打开预览、选用模板进入配置页均通过。
  覆盖当前浅色主题；窄视口是 macOS Safari 响应式设计模式，不等同于 iOS 实机验证。
- Linux 复用 `localmind_hot_web`（`localmind-affine:dev-base`），下列两份测试共 6 项通过；
  两个修改的源码文件通过 oxlint、Prettier，`git diff --check` 通过。

```sh
docker exec -w /workspace localmind_hot_web yarn vitest run packages/frontend/core/src/desktop/pages/report-decks/template-gallery.spec.tsx packages/frontend/core/src/desktop/pages/report-decks/config-page.spec.tsx
docker exec -w /workspace localmind_hot_web yarn lint:ox packages/frontend/core/src/desktop/pages/report-decks/report-decks.css.ts packages/frontend/core/src/desktop/pages/report-decks/template-gallery.tsx
docker exec -w /workspace localmind_hot_web yarn prettier --check packages/frontend/core/src/desktop/pages/report-decks/report-decks.css.ts packages/frontend/core/src/desktop/pages/report-decks/template-gallery.tsx
```

源码通过现有 bind mount 热更新生效；没有重建镜像、迁移数据库或创建新汇报。
截图、Safari 几何读数和悬停隔离页位于 `.codex-artifacts/report-gallery-fix-20261019/`。

## 2026-10-19：自定义生成链路 v3

自定义模式在一次提交内完成事实整理、设计规划、HTML/CSS 联合生成、真实浏览器截图与有界修正。
自由滚动网页和章节演示契约继续有效；模板与旧记录保持既有版本。新版本使用独立内容作用域，
保留稳定章节 ID，不附加旧通用设计覆盖 CSS。进度显示实际阶段，未完成的视觉覆盖明确提示。
模型、来源与 Project BYOK 的授权边界不变。详细实现、数据库迁移和运行环境证据见
[自定义设计实施与验收](localmind-report-deck-custom-design.execution.zh-CN.md)。

## 2026-10-16：网页汇报与场景演示（现行契约）

用户已确认：默认自由滚动的专题网页，保留一屏一个场景的全屏演示，模板与自定义均适用。
本节覆盖下文原始方案中的固定 1280×720、逐页展示与按页数配置规则；存储、来源 ACL、
一次生成、分享与沙箱边界保持不变。

- 内容以正常文档流中的章节组织。阅读模式连续滚动；演示模式以视口高度作为章节最小高度，
  按章节导航，长内容自然增长并可继续滚动。不得等比缩放整个固定画布、拉伸文字或裁切正文。
- 模板沿用各自配色、图表与内容结构，使用流式字体、开放指标排布、响应式分栏、移动端纵向时间线。
  自定义提示词 v2 要求响应式 HTML/CSS、明确断点和安全的 details/summary 展开；模型仍不能输出可执行脚本。
- 配置中的篇幅改为「内容深度」：简洁、标准、深入。内部章节预算分别为 3–6、5–9、8–14；
  旧 wire 字段 `slides`、`slideCount`、`length` 保持兼容，面向用户显示「章」。
- 同一 HTML 自带阅读/演示切换、章节目录、前后章导航、全屏及退出。普通滚动、文字选择和内容点击
  不触发翻章；左右键跳章，Escape 退出演示；尊重减少动态效果设置。浏览器拒绝系统全屏时，
  仍保留铺满窗口的演示并给出提示。仅模板库静态缩略图保留 1280×720。
- 旧汇报在读取时仅对匹配原受信脚本 SHA-256 的 v1 文档更换展示外壳；保留正文与设计 CSS，
  不调用模型、不覆盖数据库中的原始压缩 HTML。查看、受控分享与下载共用此兼容路径。
  任意旧自定义 CSS 的版式创意不会自动重新生成；新生成结果使用 v2 网页设计规则。
- 本地运行使用现有源码热启动容器，不重建镜像，不修改数据库结构。

### 本轮实施与验证

主要实现位于 `packages/common/office/src/report/deck/{shell,responsive,upgrade}.ts`，
前端接入位于 `packages/frontend/core/src/desktop/pages/report-decks/deck-viewer.tsx`，
生成规则位于 `packages/backend/server/src/plugins/copilot/report-deck-prompts.ts`，
旧结果兼容由 `packages/backend/server/src/core/report-deck/share.ts` 统一接入。
简中、繁中、英文文案同步使用章节与内容深度。

验证复用 `localmind_hot_web`、`localmind_hot_backend` 的 Linux 源码容器，固定镜像为
`localmind-affine:dev-base`；没有重建镜像、迁移数据库或覆盖已有汇报。

```sh
docker exec -w /workspace localmind_hot_web yarn vitest run packages/common/office/src/report/deck/deck.spec.ts packages/common/office/src/report/deck/web-shell.spec.ts packages/frontend/core/src/desktop/pages/report-decks
docker exec -w /workspace localmind_hot_web yarn vitest run packages/common/office/src/report/deck/web-shell.spec.ts packages/frontend/core/src/desktop/pages/report-decks/deck-viewer.spec.tsx
docker exec -w /workspace localmind_hot_backend sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn workspace @affine/server ava --serial src/__tests__/report-deck/generation.spec.ts src/__tests__/report-deck/share.spec.ts'
docker exec -w /workspace localmind_hot_web yarn tsc -b packages/frontend/core --pretty false
```

- 前端与公共渲染共 87 项：初次 86 项通过，修正测试 DOM 的章节坐标和 mock context 后，
  受影响的 11 项复跑全部通过。后端生成与分享 21 项全部通过。改动文件通过 oxlint、Prettier。
- 整体前端类型检查仍有两处既有基线：`components/page-tree/created-resource.spec.tsx:33`
  的可空值与 `modules/navigation-panel/services/created-resource.spec.ts:29` 的 `parentNodeId`
  类型；本轮没有新增类型错误。
- 浏览器使用现有模板、自定义汇报检查桌面与 390px 手机视口：连续阅读、章节目录、左右键导航、
  退出演示及长内容可读；手机端正文无横向溢出。自定义演示在 1728×1084 视口下首章高度为
  1084px，下一章从 1084px 开始，已无固定比例黑边。
- 新提示词通过生成链路的模拟模型测试，本轮没有再次调用真实模型生成；任意模型生成版式的
  质量仍需结合实际内容验证。截图与命令日志在 `.codex-artifacts/report-web-20261016/`。

### 同日全屏状态与沉浸模式修复

外层已进入系统全屏时，内嵌汇报仍显示「全屏」，可能再次发起嵌套全屏请求；将整个应用页面
作为全屏目标还会保留侧栏和顶部栏。现由查看页与分享页的 `DeckFrame` 统一管理全屏，目标
改为 HTML iframe 本身，通过校验 `event.source` 的消息同步状态。顶部「全屏演示」和 HTML
内部「全屏」进入同一沉浸模式，仅显示汇报 HTML：隐藏应用侧栏、顶部栏、退出按钮和底部导航。
左右键仍可切章，Esc 恢复阅读界面并保留当前章节；浏览器先捕获 Esc 时，通过 `fullscreenchange`
恢复。系统全屏请求失败时保留纯 HTML 的窗口演示，Esc 同样可退出。独立下载的 HTML 继续
直接调用浏览器 API，沙箱权限保持不变。

首版网页汇报的已知运行脚本也纳入按 SHA-256 识别的读取兼容，因此已保存结果无需重新生成。
当前浏览器已实测内部与顶部两个入口：全屏视口为 1728×1084，`.deck-chrome` 为 `display:none`，
无应用侧栏、顶部栏或退出按钮；真实 Esc 按键恢复阅读，切至第二章后退出仍停留第二章。
截图为 `immersive-html-only.png`。聚焦检查覆盖 `deck.spec.ts`、`web-shell.spec.ts`、
`deck-viewer.spec.tsx`、`shared-route.spec.tsx`，共 74 项通过；命令日志前缀为 `immersive-`。
复用原有 Linux 热启动容器，不重建镜像。整体类型检查仍仅有上述两处基线错误。

## 0. 目标与已确认决策

| #   | 决策                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 汇报跨范围使用：来源可以是 workspace 文档、项目文件/文件夹、整个项目，**允许混选**                                                 |
| 2   | 全局左侧窄栏，在 workspace 页和项目页**完全一致**：工作区 / 项目协作台 / 项目文档 / 汇报总结（底部：任务、设置）                   |
| 3   | **一次性生成**：没有追问、对话、编辑、大纲确认环节；想要不同结果就“用此配置再生成”                                                 |
| 4   | 结果页只提供：展示（含全屏演示）、分享（链接/有效期/密码/撤销）、下载 HTML、删除                                                   |
| 5   | 生成方式由用户选：**模版**（AI 输出结构化内容 + 模版预设动效）或 **自定义**（AI 直接写 HTML/CSS）                                  |
| 6   | 动效不让用户配置：模版模式下 AI 只标注“表达意图”，模版决定具体动效                                                                 |
| 7   | 不新开文件存储：生成的 HTML 压缩后存数据库，「汇报总结」页提供“历史结果”                                                           |
| 8   | 旧项目汇报（工作室、版本、评论、审阅、定时、PPTX/PDF、模版导入等）**禁用不删除**                                                   |
| 9   | 生成所用 AI 可以在配置页选择；不选时默认用**第一个来源所属范围的 AI**（workspace 来源用该 workspace 的 AI，项目来源用该项目的 AI） |

## 1. 总体架构

```
入口（任一）                                 配置页 /reports/new
 ├ 全局栏「汇报总结」→ 新建                  ├ 来源清单（可增删，实时预检权限）
 ├ workspace 全部文档 多选 →「汇报演示」     ├ 生成方式：模版 | 自定义
 ├ 项目文档 多选 →「汇报演示」               ├ 用途/受众/篇幅/语言/语气/内容偏好/补充要求
 └ 项目列表行的汇报图标（= 整个项目）        └ 生成 ─┐
                                                     ▼
后端 job: copilot.reportDeck.generate（以创建人身份）
 1 解析来源：逐条校验权限 → 读取文本 → 去重 → 截断；不可读的记为“已排除+原因”
 2 提炼：分块调用模型，输出要点（事实/数字/日期/风险，数字必须带原文引用）
 3 生成：
    模版模式  → DeckSpec（结构化 JSON）→ 服务端 renderDeckHtml(spec, 模版)
    自定义模式 → 先生成设计样式 + 页面结构，再分批生成各页 HTML → 白名单净化
 4 套壳：统一的演示外壳（翻页/缩放/全屏/动效触发 JS + CSP）
 5 gzip 存入 report_decks.html_gzip，状态 ready，实时推送给创建人
                                                     ▼
结果页 /reports/:deckId    展示（iframe 沙箱） / 全屏演示 / 下载 HTML / 分享 / 删除
分享页 /share/decks/:shareId#token=…   （可选密码）只读展示，可选允许下载
```

**为什么不会“AI 打架”**：AI 不调用任何读取工具。服务器按来源清单逐条做权限校验和读取，然后把文本交给 AI。AI 接触不到清单以外的数据，所以来源属于 workspace 还是项目都没关系。

## 2. 数据模型（新增 3 张表，不挂在项目下）

迁移目录：`packages/backend/server/migrations/20261016000000_report_decks/migration.sql`

```prisma
model ReportDeck {
  id            String    @id @default(uuid()) @db.VarChar
  ownerUserId   String    @map("owner_user_id") @db.VarChar
  title         String    @db.VarChar(512)          // 用户填写，或生成后由 AI 回填
  status        String    @default("queued") @db.VarChar(16) // queued|generating|ready|failed|cancelled
  mode          String    @db.VarChar(16)            // template|custom
  templateKey   String?   @map("template_key") @db.VarChar(64)
  config        Json      @db.JsonB                  // 见 §4 配置项
  progress      Json      @default("{}") @db.JsonB   // {phase, done, total}
  htmlGzip      Bytes?    @map("html_gzip")
  htmlBytes     Int?      @map("html_bytes")
  slideCount    Int?      @map("slide_count")
  errorCode     String?   @map("error_code") @db.VarChar(64)
  aiScopeKind   String    @map("ai_scope_kind") @db.VarChar(16) // workspace|project：实际使用的 AI 范围
  aiScopeId     String    @map("ai_scope_id") @db.VarChar
  modelId       String?   @map("model_id") @db.VarChar        // 实际使用的模型（生成后回填）
  usage         Json?     @db.JsonB                  // 模型调用次数 / token
  runAttempt    Int       @default(0) @map("run_attempt")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  completedAt   DateTime? @map("completed_at") @db.Timestamptz(3)
  deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(3)
  sources       ReportDeckSource[]
  shares        ReportDeckShare[]
  @@index([ownerUserId, deletedAt, createdAt])
  @@map("report_decks")
}

model ReportDeckSource {
  id            String  @id @default(uuid()) @db.VarChar
  deckId        String  @map("deck_id") @db.VarChar
  scopeKind     String  @map("scope_kind") @db.VarChar(16)   // workspace|project
  scopeId       String  @map("scope_id") @db.VarChar         // workspaceId | projectId
  kind          String  @db.VarChar(16)                      // project_all|doc|file|folder
  resourceId    String? @map("resource_id") @db.VarChar
  titleSnapshot String  @map("title_snapshot") @db.VarChar(512)
  status        String  @default("pending") @db.VarChar(16)  // pending|included|excluded|truncated
  reason        String? @db.VarChar(64)                      // no_permission|not_found|empty|unsupported|over_budget
  chars         Int?
  deck          ReportDeck @relation(fields: [deckId], references: [id], onDelete: Cascade)
  @@index([deckId])
  @@map("report_deck_sources")
}

model ReportDeckShare {
  id            String    @id @default(uuid()) @db.VarChar
  deckId        String    @map("deck_id") @db.VarChar
  tokenHash     String    @unique @map("token_hash") @db.VarChar(64)
  tokenCipher   String    @map("token_ciphertext") @db.Text   // 便于创建人再次复制链接
  passwordHash  String?   @map("password_hash") @db.VarChar
  allowDownload Boolean   @default(false) @map("allow_download")
  expiresAt     DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz(3)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  deck          ReportDeck @relation(fields: [deckId], references: [id], onDelete: Cascade)
  @@index([deckId])
  @@map("report_deck_shares")
}
```

- 删除是软删除（`deletedAt`）；软删除时同时撤销所有分享。
- HTML 上限默认 5 MB（解压后）。不嵌入字体，使用系统字体栈；图片只允许 data URI，且只来自模版自带的装饰 SVG。v1 不嵌入来源文件里的图片。
- 汇报只有创建人能看到；对外只能通过分享链接访问。

## 3. 来源解析（后端）

`packages/backend/server/src/core/report-deck/sources.ts`

| 来源                  | 权限校验                                                              | 读取                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace 文档        | `ac.user(u).workspace(ws).doc(id).projectScope(null).can('Doc.Read')` | `DocReader.getVersionedDocMarkdown(ws, id)`                                                                                                                                                                                 |
| workspace 本地文件    | `WorkspaceNativeResourceService.readText`（内部自带 assert）          | 同左                                                                                                                                                                                                                        |
| 项目资源（文档/文件） | `models.projectResource.assertMember` + `projectResource.get`         | `ProjectResourceService.readDocument` → `parseYDocToMarkdown`；`readTextFile`；Office 文件走 `readRevisionAsset` + `officeStateSearchText`；PDF 走 pdfjs（复用 `ProjectReportSourceService.read` 的分支逻辑，抽成公共函数） |
| 项目文件夹            | 同上                                                                  | `projectResource.list` 递归，最多 200 项                                                                                                                                                                                    |
| 整个项目              | `assertMember`                                                        | 全部资源 + 共享记忆 `sharedBackground` + 本人相关工单 `workOrders`（只用服务端生成的状态文本）                                                                                                                              |

规则：

- **去重**：选了整个项目时，同项目内单独选的资源会被合并；同一资源重复出现只保留一条。
- **预检**：配置页调用 `reportDeckPreflight`，返回每条来源能否读取、排除原因和预估字数，不可读的来源在配置页标灰。生成时**再检查一次**，以生成时为准。
- **预算**（`reportDecks.*` 配置）：最多 200 条来源；总字数上限 60 万，超出的按选择顺序标为 `truncated`。
- 项目 `aiPolicy` 目前固定为 `read_write`，实际只校验成员身份。代码里保留 `evaluateIntelligenceWorkbenchOperation` 读操作的检查点，以后放开策略时可以直接生效。

## 4. 配置页字段（`config` JSON）

| 字段           | 取值                                                                         | 说明                                                     |
| -------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `mode`         | template / custom                                                            | 必选                                                     |
| `templateKey`  | 模版 key                                                                     | 模版模式必选                                             |
| `customStyle`  | ≤500 字                                                                      | 自定义模式：风格描述，如“深色科技风、霓虹蓝、大字号数据” |
| `accentColor`  | #rrggbb                                                                      | 可选；两种模式都可覆盖主色                               |
| `purpose`      | periodic / progress / customer / decision / retrospective / training / other | 用于推荐模版和组织结构                                   |
| `audience`     | team / management / customer / public                                        | 影响措辞和敏感信息的处理                                 |
| `length`       | short(6–10) / standard(10–18) / long(18–30) 页                               |                                                          |
| `language`     | zh-CN / en                                                                   |                                                          |
| `tone`         | formal / concise / vivid                                                     |                                                          |
| `preferences`  | `charts`、`citations`、`conclusionFirst`（布尔）                             | 数据可视化 / 来源标注 / 结论先行                         |
| `instructions` | ≤2000 字                                                                     | 补充要求（一次成型的唯一引导手段）                       |
| `title`        | 可选                                                                         | 留空时由 AI 生成                                         |
| `ai`           | `{scopeKind, scopeId, modelId?}`，可选                                       | 生成所用 AI，详见 §5.1；不填时按“第一个来源”自动决定     |

- 用户上次的偏好存在 localStorage（`report-deck:last-config`），下次打开时自动预填。
- 如果当前有正在生成的任务，生成按钮会提示。每人同时最多 2 个任务。

## 5. 生成管线

后端位置：`packages/backend/server/src/plugins/copilot/report-deck-generation.ts`。需要 `PromptRuntime`，所以放在 copilot 插件里；核心服务通过 `ModuleRef.get(..., {strict:false})` 拿到它，和现有的 `ProjectReportService` 写法一致。

1. **Job**：注册 `copilot.reportDeck.generate {deckId, attempt}`，用 `@OnJob`，队列并发跟随 copilot 队列。单个任务 15 分钟超时，进度写入 `progress` 字段，并通过 `realtime.publish('report.deck.changed', …, {room: user})` 推送。
2. **提炼**（`Report Deck Extract v1`，`runStructured`）：
   - 每块输入不超过 48k 字符。
   - 输出 `{facts:[{id, text, quote, kind: fact|number|date|risk|decision}]}`。
   - 复用 `groundReportFacts`，要求引用必须是原文子串，数字类事实没有引用就丢弃。
3. **模版模式**（`Report Deck Compose v1`，`runStructured`，maxTokens 16000）：输出 `DeckSpec`（§6），zod 校验失败时带上错误信息重试 1 次。
4. **自定义模式**（`runText`）：
   - a. `Report Deck Custom Design v1`：输入风格描述、主色、页数和要点，输出 `{css, outline:[{title, intent}]}`。
   - b. `Report Deck Custom Slides v1`：每批 4 页，CSS 固定，输出若干 `<section data-slide>` 的 HTML。
   - c. 白名单净化（§7），任一页净化后为空就重写这一页 1 次。
5. **套壳**：`wrapDeckHtml({slidesHtml, css, title, lang})`，两种模式共用，见 §6。
6. **落库**：gzip 后写入 `htmlGzip`；记录 `slideCount`、`modelId`、`usage`；`status=ready`。失败时 `status=failed`，并写入 `errorCode`，取值为 `no_sources | provider_unavailable | model_invalid_output | budget_exceeded | timeout | cancelled`。
7. **模型**：按 §5.1 决定的 AI 范围组装 `providerOptions`。
8. **调用预算**：`reportDecks.maxModelCalls` 默认 40，单次输出不超过 16000 token，单次调用 120 秒超时。

### 5.1 用哪个 AI

**规则**

1. 用户在配置页明确选了 AI，就用用户选的。
2. 没选时，取来源清单里**第一条来源**所属的范围：
   - workspace 文档或文件 → 用该 workspace 的 AI；
   - 项目资源或整个项目 → 用该项目的 AI。
3. 如果默认范围没有配置可用的 AI，就按来源顺序找下一个有 AI 的范围，并在配置页提示“已改用 X 的 AI”。所有范围都没有可用 AI 时，生成按钮禁用，并说明原因。
4. 确定下来的范围和模型写入 `aiScopeKind / aiScopeId / modelId`。“用此配置再生成”沿用这个设置；如果当时已不可用，就失败并提示重新选择。

**配置页控件（“生成所用 AI”）**

- 下拉框分两组：
  - **来源所在范围**：按来源顺序列出，第一项标“默认”；
  - **其他**：用户有权使用的其他 workspace 和项目。
- 每项显示提供方和模型名；没有配置 AI 的项标灰，注明“未配置 AI”。
- 选中 workspace 后，可以再选具体模型，列表就是该 workspace 当前用户可用的模型。
- 选中项目时模型只读。原因：现在所有项目共用管理员配置的同一个“项目 AI”（`aiProjectByokConfig` 只有一行 `global`），不存在按项目单独设置的模型。界面上照实显示。
- 选中的 AI 和来源不在同一个范围时（比如用 workspace1 的 AI 处理项目A的文件），显示提示：“项目A 的内容将发送给 workspace1 配置的模型提供方（X）”。

**后端调用方式**（`PromptRuntime.runText / runStructured` 的 `providerOptions`，不创建会话）

| AI 范围     | 前置校验（以创建人身份，创建时和生成时各查一次）                                                            | providerOptions                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| workspace W | `ac.user(u).workspace(W).assert('Workspace.Copilot')`                                                       | `{ user: u, workspace: W, featureKind: 'action', quotaBackedRoutesAllowed: false }`，传 `modelId`（用户选了模型时）         |
| 项目 P      | `models.projectResource.assertMember({projectId: P, actorId: u})`（`getProfiles` 内部也会再查一次成员身份） | `{ user: u, projectId: P, featureKind: 'action', quotaBackedRoutesAllowed: false }`；`modelId` 不传，项目 AI 的模型会覆盖它 |

**限制**

- workspace 管理员的“本地密钥”（`byokLeaseId`，存在浏览器端的临时凭证）不适合后台长时间任务。v1 只使用服务端配置的密钥。
- 如果某个 workspace 只配置了本地密钥，下拉框里显示“仅本地密钥，后台生成不可用”。

**可选 AI 列表接口**：新增 `reportDeckAiOptions(scopes)`。

- 为什么不复用现有接口：现有的 `getPromptModels` 不带 `userId`，看不到管理员按用户分配的 AI 配置。
- 对每个候选范围，以当前用户身份调用 `providerFactory.getEffectiveModelSelectionScope({userId, workspaceId | projectId, featureKind: 'action'})`。
- 返回：`{scopeKind, scopeId, label, available, reason?, providerName, models:[{id, name}], defaultModelId, modelLocked}`。

## 6. 渲染：DeckSpec、演示外壳、动效预设

新目录：`packages/common/office/src/report/deck/`

### 6.1 DeckSpec（AI 在模版模式下的输出）

```ts
DeckSpec = {
  title, subtitle?, period?,
  slides: Array<{
    layout: 'cover'|'section'|'bullets'|'metrics'|'chart'|'timeline'|'comparison'|'table'|'quote'|'closing',
    title, kicker?, notes?,
    blocks: Array<
      | {type:'paragraph', text, intent?}
      | {type:'list', items, ordered?, intent?}
      | {type:'metric', label, value, unit?, delta?, trend?: 'up'|'down'|'flat', intent?}
      | {type:'chart', chartType:'bar'|'line'|'pie'|'donut', labels, series, unit?, intent?}
      | {type:'timeline', entries:[{date, title, detail?, status?}], intent?}
      | {type:'table', columns, rows, intent?}
      | {type:'callout', text, tone:'info'|'risk'|'decision', intent?}
      | {type:'quote', text, by?, intent?}
    >,
    citations?: string[]   // 来源标题，仅在用户勾选“来源标注”时输出
  }>
}
intent: 'hero' | 'sequence' | 'number' | 'grow' | 'progress' | 'none'
```

- 限制：6–40 页；每页最多 6 个内容块；表格最多 6 列 × 8 行。
- 校验复用 `schema.ts` 里的字段规则：文本长度、颜色、图表系列与标签数量一致。

### 6.2 演示外壳 `deck-shell.ts`（两种模式共用）

- 舞台固定为 1280×720，等比缩放适配窗口。
- 操作：键盘翻页（← → 空格 PgUp PgDn Home End）、`F` 全屏、`B` 黑屏，以及底部进度条和页码。
- 动效触发：当前页加 `.is-active` 类，CSS 动画由这个类触发；离开当前页后重置，回来时重新播放。
- 系统开启“减少动态效果”时禁用全部动画。
- CSP：`default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'sha256-<shell>'; connect-src 'none'; form-action 'none'`。
- 字体：`"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif`，不嵌入字体文件。
- 打印：每页一张。下载下来的 HTML 离线可用。

### 6.3 模版 = 主题 + 版式 CSS + 动效语言 `deck-templates.ts`

现有 6 个主题保留配色（periodic / management / customer / milestone / closure / retrospective），再新增 4 个（科技发布会 launch、极简黑白 minimal、数据看板 dashboard、活力创意 vivid），共 10 个。每个模版定义四部分：

| 组成      | 内容                                                              |
| --------- | ----------------------------------------------------------------- |
| `theme`   | 背景、文字、主色、辅色、字体风格（无衬线/衬线）、装饰 SVG（内联） |
| `layouts` | 10 种 layout 各自的 CSS                                           |
| `motion`  | intent → keyframes 的映射，翻页转场                               |
| `sample`  | 一份示例 DeckSpec，用于模版库卡片的真实封面和预览                 |

不同风格对同一个 intent 的处理（`deck-motion.ts`）：

| intent   | 稳重（periodic/closure/management）       | 发布会（launch/vivid） | 简约（minimal/customer） | 数据（dashboard/milestone/retrospective） |
| -------- | ----------------------------------------- | ---------------------- | ------------------------ | ----------------------------------------- |
| hero     | 淡入 + 上浮 12px                          | 放大 0.92→1 + 光晕     | 纯淡入                   | 淡入 + 主色下划线展开                     |
| sequence | 逐条淡入，间隔 80ms                       | 卡片错落飞入           | 逐条淡入，间隔 60ms      | 逐行滑入                                  |
| number   | 数字滚动（壳内 JS 驱动，读 `data-count`） | 滚动 + 冲击放大        | 滚动                     | 滚动 + 趋势箭头                           |
| grow     | 柱子从基线生长、折线描边绘制              | 生长 + 高亮最大值      | 生长                     | 生长 + 数值标签延迟出现                   |
| progress | 时间线逐段绘制                            | 节点逐个点亮           | 逐段淡入                 | 进度条填充                                |
| 翻页     | 平滑横移                                  | 纵深缩放               | 交叉淡化                 | 横移                                      |

### 6.4 图表

复用 `chart.ts` 的 `reportChartShapes`，改动只做增量：

- 给图形加 `data-series` / `data-index` / `class` 属性，用于错落动画；
- 甜甜圈图中心改用主题背景色（现在写死为 `#ffffff`）。

现有测试应保持通过。

## 7. 安全

- **自定义模式净化** `deck-sanitize.ts`：基于 parse5（需要显式加为 `@localmind/office` 的依赖）做白名单过滤。
  - 只保留排版类标签（section/div/span/h1–h4/p/ul/ol/li/table…/svg 子集/img）。
  - 删除所有 `<script>`、`on*` 事件、`<iframe|object|embed|form|link|meta|base>`、`javascript:`，以及外部 URL（`http(s):`、`//`、CSS 里的 `url()` 只允许 `data:`）。
  - CSS 中删除 `@import` 和 `expression()`。
  - AI 写的内容**不能带任何 JS**；动效只能用 CSS，由外壳的 `.is-active` 类触发。
- **展示**：结果页和分享页都用 `<iframe sandbox="allow-scripts" srcdoc=…>`，不加 `allow-same-origin`，页面拿不到 cookie，也访问不了 API。全屏通过 `allow="fullscreen"` 开启。
- **分享**：沿用旧版 `share.ts` 的做法，单独实现一个 `ReportDeckShareService`，不改动旧代码。
  - 链接令牌只存 sha256；密码用 `crypto.verifyPassword`。
  - 验证通过后发放加密 cookie `lm_deck_<id>`，有效 30 分钟，httpOnly，sameSite strict。
  - 链接有过期时间（1/7/30 天），可以撤销。
- **分享提醒**：创建分享时列出这份汇报的来源范围，例如“包含来自 项目A、工作区X 的内容”，提醒用户链接持有人能看到这些内容。
- 所有 API 都只允许创建人访问；限流复用 `@Throttle`。

## 8. API

GraphQL（`packages/backend/server/src/core/report-deck/resolver.ts`，前端 `.gql` 放在 `packages/common/graphql/src/graphql/report-deck-*.gql`）：

| 操作                                                                    | 说明                                       |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| `reportDecks(cursor, limit, status)`                                    | 历史结果列表                               |
| `reportDeck(id)`                                                        | 详情：配置、来源状态、进度、错误、分享列表 |
| `reportDeckPreflight(sources)`                                          | 配置页预检（同时返回默认 AI 范围）         |
| `reportDeckAiOptions(scopes)`                                           | 配置页“生成所用 AI”的候选列表（§5.1）      |
| `createReportDeck(input)`                                               | 创建并入队；返回 id                        |
| `regenerateReportDeck(id)`                                              | 用同一份配置新建一份                       |
| `retryReportDeck(id)` / `cancelReportDeck(id)` / `deleteReportDeck(id)` |                                            |
| `createReportDeckShare(deckId, expiresInDays, password, allowDownload)` | 返回链接                                   |
| `revokeReportDeckShare(shareId)`                                        |                                            |
| `reportDeckTemplates`                                                   | 模版列表（含示例 DeckSpec，前端渲染封面）  |

REST（`controller.ts`）：

- `GET /api/report-decks/:id/html`：需要登录，只有创建人能访问；带 `?download=1` 时附加 `Content-Disposition: attachment; filename="<标题>.html"`。
- `POST /api/deck-shares/:shareId`：请求体 `{token, password?}`，验证后发 cookie；`@Public()`，严格限流。
- `GET /api/deck-shares/:shareId/html`：凭 cookie 访问；`allowDownload` 打开时支持 `?download=1`。

配置（`core/report-deck/config.ts`，`defineModuleConfig('reportDecks', …)`）：`enabled`（默认 true）、`maxSources`、`maxSourceChars`、`maxModelCalls`、`maxHtmlBytes`、`maxConcurrentPerUser`、`allowAnonymousShare`。

## 9. 前端

### 9.1 全局窄栏

- 新建 `packages/frontend/core/src/components/global-rail/`，内容从 `desktop/pages/intelligence/system-rail.tsx` 迁移过来；原文件改成转导出，保持兼容。
  - 主区：工作区（`/workspace/<last>`）、项目协作台（`/project`）、项目文档（`getProjectDocumentsPath(lastProjectId)`）、汇报总结（`/reports`）。
  - 底部：任务（`/tasks`）、设置。
  - 当前高亮根据 `location` 自动判断，不再需要 `documentsView` 参数。
- **workspace 布局**：在 `desktop/components/app-container/index.tsx` 的 `DesktopLayout`（约 L81）和 `BrowserLayout`（约 L99）里，在 `<RootAppSidebar/>` 前插入 `<GlobalRail/>`。宽度 56px，760px 以下隐藏（沿用现有规则）。
  - 设置按钮在 workspace 下打开 workspace 设置对话框，在项目页下沿用现有的 `onOpenSettings`。
- **项目页**：`desktop/pages/intelligence/index.tsx:1505` 改用 `GlobalRail`。
- **汇报页**：新的 `/reports*` 布局同样包含 `GlobalRail`。
- **`RootAppSidebar`**：隐藏快捷栏里的 `AIChatButton` 和「更多」菜单里的 `TasksButton`，两者已移到窄栏。代码保留，加开关控制。

### 9.2 路由（`desktop/project-router.ts` 顶层新增）

| 路径                       | 页面                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/reports`                 | 汇报总结首页：「新建汇报」+ 历史结果（状态、模式、模版、来源数、时间；生成中显示进度）+ 模版库（瀑布流，真实渲染的封面） |
| `/reports/new`             | 配置页；初始来源通过 `history.state` 或 sessionStorage 传入，避免 URL 过长                                               |
| `/reports/:deckId`         | 结果页：iframe 展示 + 全屏演示 / 下载 HTML / 分享 / 用此配置再生成 / 删除；生成中显示进度，失败显示原因并可重试          |
| `/reports/:deckId/present` | 全屏演示（只有 iframe）                                                                                                  |
| `/share/decks/:shareId`    | 公开分享页：有密码时先输入密码                                                                                           |

新目录：`desktop/pages/report-decks/`，包含 `index.tsx`（路由壳）、`home.tsx`、`history-list.tsx`、`template-gallery.tsx`、`config-page.tsx`、`source-picker.tsx`、`deck-viewer.tsx`、`share-dialog.tsx`、`shared-route.tsx`、`*.css.ts`。

数据层：新目录 `modules/report-decks/`，包含 `api.ts`、`hooks.ts`（SWR，生成中每 3 秒轮询一次，同时订阅 `report.deck.changed`）和 `source-handoff.ts`。

**模版库封面**：在前端用 `renderDeckHtml(template.sample, template)` 生成真实封面，放进缩放的 iframe 显示，不用空白占位图。

**来源选择器**：一个对话框，左侧切换「工作区 / 项目」，右侧是文档树：

- workspace 部分复用文档列表数据；
- 项目部分复用 `ProjectFileSelectionTree`，并提供“选择整个项目”。

### 9.3 多选入口

- workspace 全部文档：
  - 混合视图：`components/native-files/resource-explorer.tsx` 的工具栏（约 L1243–1300）加「汇报演示」按钮；
  - 纯文档视图：`components/explorer/docs-view/docs-list.tsx` 的 `ListFloatingToolbar`（约 L375）加同样的按钮。
  - 两者都把选中的 id 转成 `{scopeKind:'workspace', scopeId, kind:'doc'|'file'|'folder', resourceId}`。
- 项目文档：`desktop/pages/intelligence/project-files.tsx` 选择栏（约 L997–1036）加按钮。
- 项目列表行的汇报图标（`project-tree.tsx:308`）改为跳转 `/reports/new`，来源预填为 `project_all`。
- 通知里的汇报深链 `components/notification/project-report.tsx` 在旧功能关闭时改跳 `/reports`。

### 9.4 i18n

新增 `com.affine.localmind.reportDeck.*` 和 `com.affine.localmind.workbench.systemRail.reports`、`systemRail.tasks`，`en.json` 和 `zh-Hans.json` 同步添加，然后运行 `packages/frontend/i18n/build.ts` 重新生成 `i18n.gen.ts`。

## 10. 旧功能禁用（不删除）

| 层       | 做法                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 后端     | `projectReports.enabled` 默认值改为 `false`（`core/project-report/config.ts:16`），环境变量 `LOCALMIND_PROJECT_REPORTS_ENABLED=true` 可以恢复。现有代码已经据此拦截所有新建/编辑操作和项目对话里的汇报 AI 工具；定时汇报 cron 也要检查这个开关，确认会停止触发           |
| 前端开关 | `modules/feature-flag/constant.ts` 新增 `enable_legacy_project_reports`（默认 false，隐藏），用来控制：`project-router.ts` 的 `/project/:id/reports*`（关闭时重定向到 `/reports`）、`/share/reports/:id`（保留，旧分享链接照常可用）、`TemplateImport`（pptx/potx 导入） |
| 侧栏     | `AIChatButton` 和 `TasksButton` 由开关 `enable_global_rail` 控制隐藏（默认 true，意思是“使用全局栏”）                                                                                                                                                                    |
| 代码     | 旧的 `intelligence/reports/*`、`modules/project-reports/*`、20 张 `project_report_*` 表和相关测试全部保留                                                                                                                                                                |

## 11. 风险与对策

| #   | 风险                                                         | 对策                                                                                                                                    |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 所选范围在生成时 AI 已不可用（管理员停用了密钥、成员被移除） | 生成开始时重新校验；不可用就失败（`provider_unavailable`），提示用户重新选择 AI；不会自动换成别的范围，以免内容被发到用户没选的提供方   |
| 1b  | 用 A 范围的 AI 处理 B 范围的内容，存在数据外发合规问题       | 配置页明确提示；同时遵守 `providers.routePolicy.byWorkspace` 的隐私规则（被策略阻止的组合直接标为不可用）                               |
| 2   | 自定义模式质量不稳定、版面溢出                               | 先固定设计样式再分批写页；外壳在舞台上加 `overflow:hidden`，内容超高时自动缩小字号（壳内 JS 测量，最小 0.8 倍）；净化后为空就重写这一页 |
| 3   | 来源过多导致耗时和费用失控                                   | 设字数上限、截断，限制调用次数；预检时提示“预计耗时”                                                                                    |
| 4   | 链接分享泄露原本有权限限制的内容                             | 创建分享时显示来源范围提醒；默认有效期 7 天；可以撤销；可以加密码                                                                       |
| 5   | HTML 存数据库体积过大                                        | gzip 压缩，上限 5MB，不嵌字体和来源图片；历史结果分页                                                                                   |
| 6   | 自定义 HTML 存在 XSS                                         | 白名单净化 + iframe 沙箱（无 same-origin）+ CSP，三层防护                                                                               |

## 12. 实施阶段

| 阶段 | 内容                                                                                                              | 验证                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| P1   | 全局窄栏、workspace 布局插入、`/reports*` 路由骨架、旧功能开关                                                    | rail / sidebar / index / project-tree 相关测试更新后通过                                                                |
| P2   | Prisma 模型与迁移、`ReportDeckModel`、来源解析与预检、GraphQL/REST、分享服务、AI 范围解析与 `reportDeckAiOptions` | 后端单测：权限排除原因、去重、预算、只有创建人可访问、分享令牌/密码/过期/撤销、AI 范围的默认规则/顺延/权限/项目模型锁定 |
| P3   | `@localmind/office` deck：schema / shell / templates(10) / motion / render / sanitize，chart 增量改动             | 单测：渲染结构、CSP、无外链、净化用例、动效映射；`report.spec.ts` 保持通过                                              |
| P4   | 生成管线：job、提炼、模版模式生成、自定义模式生成、进度与实时推送、失败重试与取消                                 | 用模拟模型单测各阶段；之后用真实模型各跑 1 次                                                                           |
| P5   | 前端：首页（新建/历史/模版库）、配置页、来源选择器、结果页、全屏、下载、分享对话框、分享页、三个多选入口          | 组件测试；用浏览器在 3011/3012 走一遍完整流程并截图                                                                     |
| P6   | 收尾：i18n 生成、tsc、vitest 全量、lint、文档                                                                     | 汇报验证结果                                                                                                            |

## 13. 改动清单

### 新增

**后端** `packages/backend/server/`

- `migrations/20261016000000_report_decks/migration.sql`
- `src/models/report-deck.ts`（`ReportDeckModel`：创建、列表、详情、更新状态与进度、存 HTML、软删除、分享增删查）
- `src/core/report-deck/{index.ts, config.ts, service.ts, sources.ts, resolver.ts, types.ts, controller.ts, share.ts}`
- `src/plugins/copilot/report-deck-ai.ts`（AI 范围解析：默认规则、可选列表、权限校验、组装 providerOptions）
- `src/plugins/copilot/report-deck-generation.ts`（job、prompts、管线）
- `src/plugins/copilot/report-deck-prompts.ts`（4 个 prompt：Extract / Compose / Custom Design / Custom Slides）
- `src/__tests__/report-deck/{sources.spec.ts, service.spec.ts, share.spec.ts, generation.spec.ts}`

**office** `packages/common/office/src/report/deck/`

- `schema.ts`、`templates.ts`、`motion.ts`、`render.ts`、`shell.ts`、`sanitize.ts`、`index.ts`、`deck.spec.ts`
- `package.json` 增加导出路径 `./report-deck`，以及依赖 `parse5`

**GraphQL** `packages/common/graphql/src/graphql/`

- `report-decks.gql`、`report-deck.gql`、`report-deck-preflight.gql`、`report-deck-ai-options.gql`、`report-deck-templates.gql`、`create-report-deck.gql`、`report-deck-actions.gql`、`report-deck-share.gql`（然后重新生成 index.ts / schema.ts）

**前端** `packages/frontend/core/src/`

- `components/global-rail/{index.tsx, global-rail.css.ts, global-rail.spec.tsx}`
- `modules/report-decks/{api.ts, hooks.ts, source-handoff.ts, types.ts, index.ts}`
- `desktop/pages/report-decks/{index.tsx, home.tsx, history-list.tsx, template-gallery.tsx, config-page.tsx, source-picker.tsx, ai-picker.tsx, deck-viewer.tsx, share-dialog.tsx, shared-route.tsx, report-decks.css.ts}` 及对应 spec

### 修改

| 文件                                                                                                        | 改动                                                              |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `backend/server/schema.prisma`                                                                              | 新增 3 个 model                                                   |
| `backend/server/src/models/index.ts`                                                                        | 注册 `reportDeck`                                                 |
| `backend/server/src/app.module.ts`                                                                          | 引入 `ReportDeckModule`                                           |
| `backend/server/src/plugins/copilot/module-providers.ts`                                                    | 注册 `ReportDeckGenerationService`                                |
| `backend/server/src/core/project-report/config.ts`                                                          | `enabled` 默认改为 false                                          |
| `backend/server/src/core/project-report/schedule.ts`                                                        | 确认/补上开关检查（定时任务不再触发）                             |
| `backend/server/src/plugins/copilot/report-generation-service.ts` / `core/project-report/source-service.ts` | 把“资源→文本”的读取分支抽成公共函数，旧代码改为调用它（行为不变） |
| `backend/server/src/schema.gql`                                                                             | 自动生成                                                          |
| `common/office/src/report/chart.ts`                                                                         | 图形增加 class / data 属性；甜甜圈中心改用主题色                  |
| `common/office/src/report/index.ts`                                                                         | 导出 deck                                                         |
| `frontend/core/src/desktop/project-router.ts`                                                               | 新增 `/reports*`、`/share/decks/:shareId`；旧汇报路由按开关重定向 |
| `frontend/core/src/desktop/route-paths.ts`                                                                  | `getReportDecksPath`、`getReportDeckPath`、`getNewReportDeckPath` |
| `frontend/core/src/desktop/components/app-container/index.tsx` (+ styles)                                   | 插入 `GlobalRail`                                                 |
| `frontend/core/src/desktop/pages/intelligence/system-rail.tsx`                                              | 改为转导出 `GlobalRail`                                           |
| `frontend/core/src/desktop/pages/intelligence/index.tsx`                                                    | 使用 `GlobalRail`；项目行汇报入口改到 `/reports/new`              |
| `frontend/core/src/desktop/pages/intelligence/project-tree.tsx`                                             | 汇报图标的提示文案改为「汇报演示」                                |
| `frontend/core/src/desktop/pages/intelligence/project-files.tsx`                                            | 选择栏加「汇报演示」                                              |
| `frontend/core/src/components/native-files/resource-explorer.tsx`                                           | 工具栏加「汇报演示」                                              |
| `frontend/core/src/components/explorer/docs-view/docs-list.tsx`                                             | 浮动工具栏加「汇报演示」                                          |
| `frontend/core/src/components/root-app-sidebar/index.tsx`                                                   | 按开关隐藏 `AIChatButton`、`TasksButton`                          |
| `frontend/core/src/components/notification/project-report.tsx`                                              | 旧功能关闭时跳 `/reports`                                         |
| `frontend/core/src/desktop/pages/intelligence/reports/list.tsx`、`management.tsx`                           | `TemplateImport` 按开关隐藏                                       |
| `frontend/core/src/modules/feature-flag/constant.ts`                                                        | 新增 `enable_legacy_project_reports`、`enable_global_rail`        |
| `frontend/i18n/src/resources/{en,zh-Hans}.json` + `i18n.gen.ts`                                             | 新增文案                                                          |

### 需要同步更新的测试

`intelligence/system-rail.spec.tsx`、`intelligence/index.spec.tsx`（窄栏按钮名；汇报入口 L1378 期望改为 `/reports/new`）、`intelligence/project-tree.spec.tsx`、`root-app-sidebar/index.spec.tsx`（任务入口、更多菜单）、`intelligence/reports/list.spec.tsx`（模版导入在开关打开时才显示）、`i18n/src/resources.spec.ts` 与 `static-keys.spec.ts`（中英文 key 必须同步）。

### 不动（禁用后保留）

`desktop/pages/intelligence/reports/*`、`modules/project-reports/*`、`core/project-report/*`、`plugins/copilot/report-*.ts`、`tools/project-report.ts`、`common/office/src/report/{export-pdf,export-pptx,export-offline,import-template}.ts`、20 张 `project_report_*` 表。
