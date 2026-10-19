# 自定义网页汇报 v3：实施与验收

> 2026-10-19。范围：独立「汇报总结」的自定义模式。
> 产品契约见 [改造方案](localmind-report-deck-custom-design-upgrade.zh-CN.md) 与
> [自由滚动网页契约](localmind-report-deck-redesign.zh-CN.md)。本文区分源码、测试和运行环境状态。

## 视觉表达增强（适配版本 1.1.0）

针对初版“标题、段落、横线重复，图表表达偏弱”的反馈，本轮强化提示词与阶段协议：

- 新增 `artDirection`：明确一处主视觉、色彩角色、字体栈与桌面/手机尺度、逐章构图/表面/主次关系以及图表编码。字段必须与章节、事实 ID 对应。
- 生成仍在同一次提交内完成；不用额外选稿。长篇样章优先覆盖封面和图表章，后续批次接收前章已经使用的构图，降低样式重复。
- 图形必须表达数据关系：精确单位图、共同基线条形、状态或流程图，保留直接标注、单位和口径。几何比例可编码原值，不额外生成未经核验的百分比或趋势。
- 浏览器记录真实字号、字重、行高与字体栈；审查按构图、字体层级、图表表达分别给出观察证据。`needs_work` 没有对应 issue 时判为无效输出，避免检查止步于“没有溢出”。
- 新提示词使用独立 `Report Web * v3.1` 名称。已有 v3 任务、检查点及管理员覆盖保持原名；新运行冻结新提示词。没有新增数据库迁移、远程字体或素材权限。v3.1 输入预算复用现有按 UTF-8/ASCII 区分的保守 token 估算，并计入 schema 与截图预留，避免把更完整的 JSON 设计计划按一字符一 token 误判超限；调用数和总时限保持不变。

本轮样例沿用相同虚构 Atlas 原始资料，明确要求更强表现力，保持暖白/墨绿/橙色范围。v3.1 的 Plan 调用允许最多 180 秒以输出完整设计合同，其他调用仍为 120 秒，总运行时限仍为 15 分钟。

聚焦验证：11 项 Linux 后端测试、11 项公共渲染测试、服务端类型检查均通过；格式、oxlint 与 `git diff --check` 通过。首轮真实生成发现移动端图例分组问题并自动修正，也暴露旧字符预算阻挡全篇视觉审查；该首轮结果按 `visual_unavailable` 保留为调试证据，不作为最终视觉验收。新的预算按该轮真实产物复算，四个截图组均保留约 5500–6000 的输出 token 预算。

第二轮真实生成暴露修正阶段的两处问题：普通 CSS 注释被净化器移除后误报为安全错误；样章的非阻断设计修正失败会丢弃原本可用的版本。现在先移除注释再比较净化结果，注释拼接的外部 URL 仍会被识别并拒绝；无硬错误的样章仅在修正版无硬错误、检查覆盖不退步且问题减少时替换，修正失败则保留原样章。新增回归覆盖普通注释、混淆 URL、有效修正和安全检查失败时回退。

最终真实生成使用同一 `gpt-6.1-sol` BYOK，8 章、20 次调用、2 次修正，约 612 秒。24/24 计划截图完成审查，`visual=complete`；保留 12/9/3 原始指标。样章修正收紧单位图分组、保留数字与单位的完整断行。最终全篇仍有一条非阻断警告：桌面风险章定位截图中，浮动导航遮挡部分图注，不能宣称所有设计问题均已解决。机械设计检测还提示橙色与暖白组合的对比度约 4.3:1，未据此宣称小字号文字全部满足 AA。

该轮还发现 SVG `<title>` 的非可见无障碍描述被误当隐藏正文，消耗了一次修正。随后补齐元数据识别：浏览器不把 SVG title/desc 的零尺寸视作正文错误，事实校验也不把这些元数据计为可见证据，不能借此隐藏事实。聚焦回归与最终渲染重放覆盖此修正；未再次调用真实模型。重放同时检查修正前候选和实际交付候选，交付 HTML 字节保持一致。

当前证据目录为 `.codex-artifacts/report-custom-v31/`。最终预览 `preview/index.html` 的 SHA-256 为 `79c26eeda434369d0ca0a365c499db63879f4ba93fec9a3c8b3ecd1bfd391777`，与实际接受及截图审查的候选一致，未另做手工美化。桌面封面、单位图和 390px 手机首页均已人工查看。使用暖白/深墨绿章节节奏、86.4px 桌面衬线大标题与 18px 正文、等面积 9:3 单位图；手机标题收敛至 36px 并纵向重排。提示词、预算、截图与修正仍属于一次用户提交。

本轮本地同步已完成，GraphQL `{ __typename }` 返回 `Query`。使用 `localmind_report_v3_verify` 的 Linux 验证结果和约 1.41 GB、权限 0600 的 `backups/before-visual-upgrade.dump`，按下述脚本更新。419 个迁移没有待应用项。同步后曾因 Web、Admin、验证容器仍挂载原 native inode 而启动失败；停止四个相关容器后，用原 Compose 配置重建 backend/web/admin 的文件绑定，恢复 Linux ELF 读取和 GraphQL 就绪。只重建容器，没有重建镜像，没有删除 volume、提交或远端发布。

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_report_v3_verify \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_report_v3_verify \
LOCALMIND_DATABASE_BACKUP="$PWD/.codex-artifacts/report-custom-v31/backups/before-visual-upgrade.dump" \
LOCALMIND_URL=http://localhost:3011 \
yarn localmind:sync:backend

# 原挂载被其他容器保留时的本次恢复操作
docker stop localmind_hot_backend localmind_hot_web localmind_hot_admin localmind_report_v3_verify
docker compose -f .docker/dev/localmind-hot/compose.json \
  -f .docker/dev/localmind-hot/local-url.override.json -p localmind-hot \
  up -d --no-deps --no-build --force-recreate backend web admin
```

真实模型测试使用 `LOCALMIND_REPORT_DESIGN_BOLDER=yes` 与 `LOCALMIND_REPORT_DESIGN_LONG=yes`；真实调用日志为 `live-final.log`，最终回归为 `recovery-final.log` / `shared-final.log` / `typecheck-final.log`，同字节渲染重放为 `final-render-replay.json`。已停止三个隔离测试容器并删除临时 BYOK fixture。独立预览只服务 `preview/`，Codex 浏览器已实际切换到第 2 章演示并恢复第 1 章阅读。当前磁盘：镜像 33.69 GB、容器 1.947 GB、volume 21.49 GB、构建缓存 14.19 GB，主机约 75 GiB 可用。下面保留初版 v3 的历史验收记录。

## 已接入的用户流程

用户仍只提交一次配置。后台依次读取授权来源、整理事实、规划设计、联合生成 HTML/CSS、检查页面、查看截图并最多修正两轮。长篇先验证封面与高密度样章，再按三个章节一批补齐；最终按规划排序，重新检查整份页面。

生成页显示实际子阶段，不把子阶段进度换算成虚假的整体百分比。结果页可提示来源覆盖限制、无法看图、截图覆盖不完整或仍有非阻断设计问题。模板继续走原流程；旧记录保持 `generation_version=2`，新引擎只处理明确标记为 3 的任务。原 HTML 不被迁移重写。

## 代码落点

| 位置                                                                         | 已实现内容                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/common/office/src/report/deck/design.ts`                           | 规划、章节、联合产物、共享样式变更、问题、修正及公开质量字段的严格 schema          |
| 同目录 `design-render.ts`                                                    | HTML 净化、事实锚点检查、CSS AST 作用域、动画命名空间、最终字节哈希                |
| 同目录 `shell.ts`、`sanitize.ts`                                             | v3 轻外壳、稳定章节 ID、保留安全事实 ID、避免旧通用设计 CSS 覆盖                   |
| `packages/backend/server/src/plugins/copilot/report-web-design/`             | 固定技能、七个版本化提示词、事实核验、运行编排、浏览器与调用超时边界               |
| `packages/backend/server/src/models/report-deck-design.ts`                   | 租约、fence、调用预算、幂等修正预留、不可变检查点、最终保存与清理                  |
| `packages/backend/server/migrations/20261019000000_report_deck_design_runs/` | 运行/步骤/产物表，身份、快照、预算单调性与产物不可变约束                           |
| `packages/backend/server/src/core/report-deck/`                              | 新任务版本选择、真实进度和质量数据读取                                             |
| `packages/backend/server/src/plugins/copilot/runtime/prompt-runtime.ts`      | 固定有效提示词、固定模型、截图作为用户数据附件                                     |
| `packages/backend/server/src/plugins/copilot/providers/factory.ts`           | 有运行租约约束的请求级 BYOK 图像协议描述，不修改全局模型注册表                     |
| `packages/frontend/core/src/desktop/pages/report-decks/`                     | 阶段显示、结果质量提示、旧界面兼容                                                 |
| `Dockerfile.localmind`                                                       | dev-base 与 runtime 安装 Chromium 和 Noto CJK 字体；服务端声明 Playwright 运行依赖 |

GraphQL 沿用现有 JSON 命令与详情载荷。新增内容由公共包 schema 和前后端解析器约束，无需新增 GraphQL operation。

## 花叔技能与提示词

来源为 `alchaincyf/huashu-design`，固定提交 `798c4235ebff03d5c45e3c8affdf5e9d18f9dfa7`，初版适配版本 `1.0.0`，当前视觉增强版本 `1.1.0` 的差异见上节。
`manifest.json` 保存上游文件校验值和适配提示词文件哈希，`LICENSE.upstream` 保留 MIT 许可证。

接入的是审阅后的设计规则与流程，不执行上游脚本、不依赖服务端用户的个人技能目录，也不在每份报告生成时联网下载技能。题材判断、三方向探索、构图、字体、留白、响应式和视觉批评被分配到各阶段。

以下为初版注册名；视觉增强版使用同阶段的 `v3.1` 后缀。

| 注册名称               | 输出与职责                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| `Report Web Vision v3` | 在截图里读取不可预测的校验码，证明当前模型确实能看图             |
| `Report Web Facts v3`  | 连续原文引文、事实类型、状态、时间和数值口径                     |
| `Report Web Plan v3`   | 三个内部方向、自动选择、设计 token、章节任务、事实分配和变化节奏 |
| `Report Web Build v3`  | 短篇全篇联合生成 HTML/CSS/claims                                 |
| `Report Web Batch v3`  | 样章及后续批次；共享 CSS 保持冻结，必要变更单独申请并重验        |
| `Report Web Review v3` | 按真实截图分组检查，输出定位证据和问题，不凭空打分               |
| `Report Web Repair v3` | 绑定候选 hash，返回章节或共享 CSS 替换，保留事实与既定设计方向   |

提示词以 DB 种子注册，管理员已有覆盖不会被覆盖。每次运行固定实际解析后的全部提示词、模型 ID、设计技能版本、用户配置和预算；恢复时使用该快照。JSON 哈希采用规范序列化，避免 PostgreSQL JSONB 调整键序后把正确检查点误判为篡改。

事实、网页文字、HTML 和截图都按数据处理。数值、日期、风险与决策事实必须进入规划覆盖；claims 必须对应 DOM 内实际文字。连续引文与数值真实时，无法逐字验证的可选单位/比较说明记录为未知，不因辅助字段的措辞差异丢弃整条真实指标。

## 样式与浏览器闭环

- HTML 使用 `rd-custom-v3` 根与稳定 `rd-c-*` 章节/事实 ID。外壳不会把 v3 的章节 ID 改成旧的 `chapter-N`，避免章节 CSS 突然失效。
- CSS 经 PostCSS 与 selector parser 解析；逗号列表、媒体规则和章节自身的选择器均正确限定作用域。禁止外壳选择器、越界相邻选择器、`!important`、fixed/sticky 和不支持的资源规则。章节动画使用独立命名空间。
- v3 不附加旧的通用 card/grid/title 覆盖样式。外壳负责导航、阅读/演示和必要结构约束，正文视觉由联合生成的 HTML/CSS 负责。
- 浏览器读取净化后、装入真实外壳的完整 HTML。iframe 沙箱与 CSP 同时生效；阻断页面外网、WebSocket、service worker 和下载，浏览器子进程不继承模型密钥环境。
- 1440×900、390×844、320×844 检查正文、可见性与溢出；1920×1080 检查演示。长章分片截图，减少动态效果与普通动态状态都检查。最多 60 张图、6000 万像素，单图不超过 2 MiB。
- 复核每组最多六张图，记录真正检查的 capture ID。请求明确区分样章与整篇、当前截图组与其他组，并只传当前待审章节的规划；不能将尚未生成的样章范围外内容误判为缺失。超限或调用失败显示覆盖限制，不能把未检查的截图算作通过。
- 修正针对有问题的章节，每次最多三个；仅字体问题可只替换共享 CSS。任何共享变更都重新渲染整份报告。最多两次修正，优先保留无硬错误且检查覆盖不退步的候选。
- 保存 HTML 的 SHA-256 必须等于已检查候选的哈希；不在截图通过后额外拼接新样式。

现有 BYOK 的默认模型描述只声明文字输入，不能据此判定真实模型无法看图。因此增加受控的实际校验：图像输入协议许可只对当前运行、当前用户、当前 AI scope、当前 fence 和正在运行的 Vision/Review 步骤有效，并限定到固定模型。验证失败退回文字/DOM 检查，不切换凭据或模型，不把临时探测写成全局模型能力。

## 持久化、预算与恢复

默认运行 15 分钟、40 次模型调用，每次请求最多等待 120 秒；格式纠正最多两次，视觉/结构修正最多两次。请求发出前持久预留调用预算，超时或 worker 中断记为 `outcome_unknown`。供应商不响应 AbortSignal 时，应用也停止等待；这不意味着供应商一定停止计算或不会计费。

租约为 90 秒，运行期间每三秒续租并检查取消。每分钟回收可恢复任务，重新取得租约时增加 fence；过期或旧 worker 无法继续写步骤、产物或最终结果。取消、删除、重试和最终保存均重新检查报告状态/attempt。发布前再读取来源 ACL 与内容哈希，权限或内容改变时不交付旧快照结果。

规划、事实、候选、浏览器结果、截图及审查结果均可复用。截图按内容哈希保存，恢复使用原截图字节；修正预留有确定性键，恢复不会再扣一次修正额度。

**与初始方案的存储细化：** 本次采用独立私有 `ReportDeckArtifact` 表的有界 BYTEA，JSON 压缩、JPEG 原样保存；没有把这些文件注册为 WorkspaceFile、Project 资源或公开附件。这样检查点和运行租约可在同一事务中提交，不产生公开 Blob 访问入口。单产物 10 MiB、单运行总量 80 MiB，默认七天到期；删除报告也进入有界清理。高吞吐部署未来迁到专用私有对象存储时，应继续保留相同哈希、租约和引用提交契约。

运行保留实际调用数、重试/修正次数、模型及提示词哈希。当前 `PromptRuntime` 的返回接口没有逐调用 token/费用信息，相关值为 `null`，不以字符数冒充 token 或费用。

## 配置与部署

- `LOCALMIND_REPORT_DESIGN_V3=true`：默认开启新自定义任务。关闭后新自定义任务走 v2，已有 v3 任务仍按冻结版本执行，已有成品保持可读。
- `LOCALMIND_REPORT_CHROMIUM=/usr/bin/chromium`：可配置受信可执行文件路径。缺失时任务明确失败为 `render_failed`，不静默跳过浏览器检查。
- 先应用迁移并生成 Prisma Client，再运行新服务。镜像发布须同时包含 Chromium、中文字体与服务端 Playwright 依赖。
- 自托管源码热启动实例仍通过仓库同步脚本更新，必须先备份数据库，再暂停 worker，同步迁移、Client、native 并核验 GraphQL。

## 验证记录

证据保存在本地 `.codex-artifacts/report-custom-v3/`，不提交模型凭据、私密来源或截图临时文件。

| 验证                     | 结果                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Linux 新库全量迁移       | 419 个迁移通过                                                                                                          |
| 旧状态升级               | 从前 418 个迁移创建旧 HTML 样本，应用新迁移后仍为版本 2，原压缩 HTML 的 MD5 前后均为 `4425d9063c0940b9e3c54517db82832e` |
| 后端聚焦回归             | 46 项通过，含 v2 模板/自定义、来源、BYOK、分享和 v3 新增测试                                                            |
| 浏览器与持久化集成       | 3 章与 8 章生成；样章/分批/共享变更；模拟发布前中断；恢复不增加模型调用；截图字节与最终哈希一致                         |
| 权限与并发               | 过期 worker、不同 actor/scope、取消、并发预算、冻结快照修改与产物覆盖均被拒绝                                           |
| 前端与公共包             | 112 项通过（11 个测试文件）                                                                                             |
| 服务端类型检查           | 通过                                                                                                                    |
| 代码风格检查             | 新增设计模块通过；已有 `api.spec.ts:239` 的 `no-useless-promise-resolve-reject` 告警保留                                |
| Web bundle               | 通过；现有资产体积警告仍在                                                                                              |
| 全量前端类型检查         | 仍有两处既有 page-tree/navigation-panel 测试类型错误，与本次改造无关                                                    |
| 真实 BYOK 短篇           | `gpt-6.1-sol`，15 次调用、2 次修正、约 374 秒；18/18 截图检查；成功交付并保留质量提示                                   |
| 真实 BYOK 长篇与指标覆盖 | `gpt-6.1-sol`，8 章、13 次调用、0 次修正、约 322 秒；25/25 计划截图完成审查，无残余问题；12/9/3 指标保留                |

真实短篇暴露并推动修正了 ID 被外壳重写、claim 与 DOM 文字绑定、可选指标元数据误删事实、BYOK 图像协议和原生调用无法及时中止等待等问题。后续回归覆盖这些触发条件。短篇首轮的来源覆盖提示对应指标辅助字段被严格拒绝；当前事实规范化已修正，长篇样本已证明指标保留。长篇还修正了样章审查误用全篇完整性要求的问题，回归验证审查范围与实际传入章节一致。

这轮验收证明流程和具体样本可用，不宣称已完成多模型、多次盲评的统计性 A/B 优势验证，也不把有残余设计提示的报告称为所有视觉维度满分。

## 运行环境记录

已按依赖变化重建固定 `localmind-affine:dev-base`，补齐 Chromium 与字体。复用独立 Linux 测试容器及一次性 PostgreSQL/Redis，未删除业务 volume。没有构建生产 `localmind-affine:local`，没有提交、推送、PR 或远端发布。

本地热启动实例 `localmind_hot_backend` 已同步完成。同步前使用 `pg_dump -Fc` 备份业务库，备份约 1.40 GB、权限 0600，保留在本地私有 artifacts 目录；已检查 archive 目录可读。使用独立且通过 9 项聚焦测试的 `localmind_report_v3_verify` 作为 Linux 源与迁移容器，通过下列仓库脚本暂停 worker、应用第 419 个迁移、同步 Client/native 并重建绑定。同步后 GraphQL `{ __typename }` 返回 `Query`，容器 Chromium 为 `155.0.8059.79`。

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_report_v3_verify \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_report_v3_verify \
LOCALMIND_DATABASE_BACKUP="$PWD/.codex-artifacts/report-custom-v3/backups/before-report-v3.dump" \
LOCALMIND_URL=http://localhost:3011 \
yarn localmind:sync:backend
```

前端使用现有源码热启动；浏览器验证未登录汇报入口正确显示登录要求。已登录业务页面没有另做手工点击验收；创建、权限、生成、质量提示由隔离服务端集成及前端组件测试覆盖。真实生成样例使用虚构材料与隔离数据库，没有新增业务汇报或修改业务资料。测试用临时模型凭据文件已删除。

最终样例位于 `.codex-artifacts/report-custom-v3/preview/index.html`，其 SHA-256 为 `17a9e2b3fa91102c426bc437e66514db478205b89141f1a6ae93b7248d2d3a8a`，与实际接受的候选完全一致。25 张审查图包括桌面 10 张、390px 手机 12 张、演示抽样 3 张；320px 做全章 DOM 检查。`visual=complete` 表示该截图计划全部完成，不表示所有视口的所有像素都经过模型审查。

本轮关键验证命令（数据库与 Redis 均指向隔离测试服务）：

```sh
docker build --target dev-base -t localmind-affine:dev-base -f Dockerfile.localmind .
yarn workspace @affine/server prisma migrate deploy
yarn workspace @affine/server ava --serial src/__tests__/report-deck/design.spec.ts src/__tests__/report-deck/design.e2e.ts
yarn workspace @affine/server ava --serial src/__tests__/report-deck/design-live.e2e.ts
yarn affine bundle -p @affine/web
```

测试前设置 `LOCALMIND_REPORT_DESIGN_ISOLATED=yes`；真实模型测试另需只读私有 BYOK fixture，长篇增加 `LOCALMIND_REPORT_DESIGN_LONG=yes`。这些开关只用于显式 opt-in 的隔离测试，普通测试不读取实际凭据或调用付费模型。

最终收尾：已在 Codex 浏览器打开独立 HTML，实际切换阅读/演示模式并跳到第二章，导航显示 `2 / 8`；交付时恢复首页阅读模式。本地预览服务仅提供专用 `preview/` 目录，未暴露备份或模型凭据目录。

磁盘检查：镜像 33.69 GB、容器 1.945 GB、volume 21.98 GB、构建缓存 14.19 GB；主机仍有约 80 GiB 可用。新增依赖使用固定 dev-base tag 构建，未构建里程碑 tag、未删除 volume。验收结束后停止本任务的四个隔离测试容器，保留本地业务实例及 HTML 预览服务。
