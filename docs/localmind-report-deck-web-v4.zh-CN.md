# 自定义网页汇报 v4：叙事、动效与交互引擎

> 范围：独立「汇报总结」的 `mode=custom`（不是 Project 项目汇报工作台）。
> 前置契约：[网页汇报与场景演示](localmind-report-deck-redesign.zh-CN.md)（自由滚动 + 同一 HTML 按章节演示）、
> [v3 实施记录](localmind-report-deck-custom-design.execution.zh-CN.md)。本文是 v4 的现行设计、实现与验收记录。

## 1. 为什么需要 v4

对 v3.1 的源码与真实产物（`.codex-artifacts/report-custom-v31/`）评审后确认，问题主要是结构性的，不是“提示词不够漂亮”：

| 问题                   | 证据（v3.1）                                                                                                                                                   | v4 处理                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 动效、交互为零         | 交付 HTML 中 keyframes/transition/hover/details 均为 0；外壳只有章节级一次性 `.is-active`；净化器去掉所有可交互元素；截图在 reduce 下拍摄；审查无动效/交互维度 | 受信声明式运行时 + 计划字段 + 帧序列与行为剧本检查               |
| 空洞分页               | long 档强制 ≥8 章，9 条事实被拆成 8 章                                                                                                                         | 章数只设上限（下限 2），Plan Lint 拒绝单事实章节                 |
| 图表退化为数字块       | 可见数字必须出现在引文（刻度、百分比全部判失败）                                                                                                               | 数据集 + 服务端图表组件 + 应用计算的派生值 + `data-rd-fact` 绑定 |
| 重复句与免责挤占       | claims 逐字绑定，诱导“标题 + 同义事实句”                                                                                                                       | 属性绑定取代 claims；声明归入页脚                                |
| 审查宽松、择优按问题数 | 样例全部 `met`、0 问题；按问题数择优                                                                                                                           | 全篇缩略图 + 设计动作；成对盲比择优                              |
| 修正无图且不能动结构   | Repair 不收截图，章节 ID 锁定                                                                                                                                  | 带截图；可合并章节、换构图、换图表、改动效与交互                 |
| 风格收敛               | 提示词含唯一样例（“9:3”）与固定字号/字体                                                                                                                       | 方向与构图原型库、token 契约，删除样例数字                       |

## 2. 两种模式

| 模式          | 默认                   | 流程                                                                                                                                                     | 真实耗时（gpt-6.1-sol，单份材料） |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **快速 fast** | 每次新建默认           | 证据（多块并行）→ 计划 + Lint → **各章并行生成**（共享 token 与 rd-kit）→ 轻量浏览器检查（无截图）→ 硬错误章节重生成一次 → 失败动效/交互确定性降级为静态 | 约 1.9–2.8 分钟，6–9 次调用       |
| 精修 refine   | 用户在自定义配置中选择 | 快速流程之外，增加视觉能力探针、截图与帧序列、Critique/Motion 审查、≤2 轮结构性修正、成对盲比                                                            | 约 13–21 分钟，15–19 次调用       |

模型输出速度约 100 字符/秒，耗时几乎全在模型输出。快速模式通过“压缩输出（事实不重复陈述、不输出 quantities、计划字段极简）+ 章节并行 + 审查移出关键路径”把时间降到约 2 分钟；组件库 rd-kit（`packages/common/office/src/report/deck/kit.ts`）保证并行生成的章节仍是同一个视觉系统，且在明暗面上自动切换图表配色。

### 每次提交的生成模式（2026-10-19）

- 自定义配置提供「快速生成」「精修生成」，每次新建、再次生成或重新配置均默认快速；不保存或继承上次的模式偏好。切换模板/自定义时，本次尚未提交的选择保留，模板请求不携带模式。
- `config.designMode=fast|refine` 在创建时持久化，运行快照优先使用该选择；恢复和失败重试保持原模式。旧客户端未提供字段时，创建时冻结 `reportDecks.webRefine` 的兼容默认值；旧运行继续遵守已有快照。历史记录无模式证据时不显示推测标签。
- 历史列表及结果页的再次生成入口先打开配置页。兼容 `regenerate` 命令创建的新任务也默认快速。列表、生成页和结果页显示已保存的模式。
- AI 选项只展示已有模型声明，文本 BYOK 的默认定义不等于已验证不支持视觉；未知能力提示开始后验证。精修前明确提示：视觉复核不可用时保留通过基础检查的报告，并标记精修未完成；固定 Project 模型提示联系管理员。
- 快速的 `quality.visual=not_requested`；精修没有任何成功视觉审查时为 `unavailable`，部分成功为 `partial`。结果页分别显示快速完成、精修完成或精修未完成；不得把零成功截图误称部分成功。浏览器不可用及硬错误仍阻断交付。
- 使用既有 JSON 配置和质量字段，无数据库迁移或 GraphQL 字段变化；公开 MCP、来源 ACL、模型权限和模板生成链路保持原契约。

## 2.1 精修模式流程

```
来源授权读取 → 视觉能力（同用户同模型 7 天内复用）
→ Facts v4：事实 + 数据集 + 关系 + 显著性（逐字落地核验）
→ Plan v4：体验计划 + Plan Lint（失败时带逐条反馈重试）
→ Build v4（≤6 章整篇）/ Batch v4（样章 + 每批 3 章，组件清单与参考章节保持一致）
   文本包输出，每次都真实组装校验（净化、数字门槛、事实覆盖、行为与图表）
→ 组装：外壳 v4 + 受信运行时 + token CSS + 分层 CSS + 服务端图表
→ 浏览器检查（无模型调用）：4 视口静态探针与截图、全篇缩略图、行为剧本（鼠标/键盘/触屏/滚动/演示分步）、
   动效帧序列（WAAPI 定位时间点）、无脚本与打印回退
→ Critique v4（缩略图 + 细节图 + 确定性指标）‖ Motion v4（帧序列 + 行为日志）
→ Repair v4（≤2 轮，带截图，可执行计划操作）→ 重新检查 → Compare v4（硬门槛优先，随机顺序盲比）
→ 发布前来源复核 → 保存
```

## 3. 关键契约

### 3.1 证据与派生

- 数据集行的标签与数值必须逐字出现在其 fact 的引文中；单位只在出现于引文时保留。
- 派生值只能由计划申请（`difference/change_pct/ratio/share/sum/average/max/min`），由应用计算并记录公式与输入事实；口径不适用时拒绝并反馈原因。
- 数字门槛：带 `data-rd-fact` 的元素内，数字必须与所绑定引文/派生显示值完全一致（不再豁免 1–14）；未绑定文字只允许本章证据中的数字与 1–14 的序号；图表组件生成的刻度与数值不参与门槛（来自数据集）。
- 计划给每章的事实必须绑定到可见元素（或被本章图表数据集覆盖）。

### 3.2 受信运行时（`packages/common/office/src/report/deck/runtime.ts`）

模型只写声明属性，外壳通过 CSP hash 授权三段固定脚本（外壳、head 看门狗、运行时）。

| 能力     | 声明                                                                                                        | 行为                                           | 无脚本 / 减少动效 / 打印 |
| -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------ |
| 揭示     | `data-rd-reveal`（fade/rise/slide/scale/wipe/mask-up/blur-in/grow/draw/count）+ `data-rd-seq`/`data-rd-dur` | 元素进入视口按序号×节拍出现                    | 完全可见                 |
| 计数     | `data-rd-count`                                                                                             | 计到原文数字后恢复原文                         | 显示原文                 |
| 演示分步 | `data-rd-step`                                                                                              | 演示模式中前进键先揭示步骤再换章；离开章节重置 | 阅读模式全部可见         |
| 视图切换 | `data-rd-switch` + `data-rd-view`                                                                           | 运行时生成可键盘操作的 tab                     | 视图依次堆叠             |
| 联动高亮 | `data-rd-linked` + `data-rd-key`                                                                            | 悬停/聚焦/点按突出同 key 元素；HTML 项变为按钮 | 静态                     |
| 滚动叙事 | `data-rd-scrolly` + `data-rd-figure` + `data-rd-stage`                                                      | 宽屏阅读时图形粘性，按阅读位置设 `data-rd-at`  | 堆叠，图形为完整终态     |

隐藏初态只在 `.rd-motion` 下生效；head 看门狗 3 秒未就绪即撤销；打印、静态缩略图、失败时强制可见。净化器拒绝模型伪造运行时状态属性；keyframes 只允许合成层属性，`infinite` 改为 1 次。

### 3.3 样式分层与外壳

`@layer rd-base, rd-runtime, rd-shared, rd-chapter`。外壳导航与可见性保底不分层；基础样式、字体角色变量（macOS/Windows/Linux 回退）在 `rd-base`；运行时与图表预置在 `rd-runtime`；模型共享样式与章节样式由应用分别包入后两层。token CSS 由计划编译，模型只引用 `--rd-*`。

### 3.4 体验计划

方向原型（10 种）、章节构图原型（12 种）、主角与面积占比、明暗面、阅读路径、移动端重排、图表编码与高亮、动效（入场、序列、演示步数）、交互（目的、默认状态、降级）。Plan Lint 强制：章数上限、事实与数据集存在、派生可计算、决策相关事实不得省略、相邻章节构图不同、单一构图不超过 40%、入场效果不全相同、至少一个动效序列、交互不超过 6 个、不得有单事实空章。

所有者补充要求中明确且无歧义的章数（如“用3个章节呈现”）进入计划、结构修正及最终交付检查；修正不得合并掉该章数，也不得为满足章数编造事实。没有明确要求时仍保留下限2、按内容确定章数的规则。短报告的动效检查仅对确实离开监听视口的元素重置入场状态，避免检查器自身隐藏仍在视口内的内容；视觉探针不可用时修正使用文本与确定性检查反馈，交付仍标记视觉复核未完成。

### 3.5 质量字段

`quality.version = report-web-v4`，新增 `experience{behaviorsDeclared, behaviorsVerified, motion, charts}` 与提示 `motion_degraded`、`interaction_degraded`。`usage` 记录调用、格式重试、修正、各阶段耗时、方向与构图原型、行为与动效检查结果、技能片段与提示词 hash。

## 4. 版本与兼容

- 存储仍为 `generation_version=3`，引擎由运行快照 `version` 选择：新任务 `report-web-v4`，已有 v3/v3.1 快照的运行恢复时继续走原引擎。无数据库迁移。
- 已保存 HTML 不改写；v4 HTML 自带运行时脚本与对应 CSP hash，分享页与查看器沿用 `sandbox allow-scripts`，不放宽 same-origin、网络或表单。
- 提示词注册为 `Report Web * v4`，管理员已有覆盖不受影响；运行时冻结有效快照。
- 运行时限 30 分钟（v3 为 15 分钟）；调用上限沿用配置（默认 40）。BYOK 未声明上下文窗口时按 128K 估算预算。

## 5. 验收方法

`src/__tests__/report-deck/live-cases.ts` 提供四类固定虚构材料（数据型经营月报、流程型平台迁移、文字型客户案例、薄材料 Atlas），各带不同风格要求。`design-live.e2e.ts` 支持：

```sh
LOCALMIND_REPORT_DESIGN_ISOLATED=yes LOCALMIND_REPORT_DESIGN_BYOK_FILE=… \
LOCALMIND_REPORT_DESIGN_CASE=data|process|text|atlas \
LOCALMIND_REPORT_DESIGN_ENGINE=v3   # 可选：同材料、同模型跑冻结的 v3.1 作为基线
LOCALMIND_REPORT_DESIGN_RUN=r1      # 输出目录后缀
```

输出到 `.codex-artifacts/report-web-v4/<engine-case-run>/`：最终 HTML、计划、每次审查、行为日志、帧序列、缩略图、各阶段耗时与调用。判断标准逐项记录可观察证据，不合成总分；单次样例不宣称稳定优于基线。

可观察标准：首屏唯一主角；无单句成章；相邻构图不同；同句不重复；免责不在首屏主体；字体角色 ≥4 且中文行长 22–34 字、无孤字；每图有结论句与直接标注、数值与数据集一致、移动端紧凑版本；帧序列中主角先出现、300ms 时同时运动元素少、终态全部可见；每个交互在鼠标/键盘/触屏均通过、默认状态已给出结论、无脚本与打印时内容完整。

## 6. 实施与验证记录

### 6.1 自动化验证

- office：`web-v4.spec.ts` 等 81 项（派生计算、Plan Lint、结构性操作、数字门槛、伪造运行时属性、行为校验、图表与回退）。
- 后端（Linux 容器 + Chromium + 隔离 PostgreSQL）：report-deck 全套 50 项通过，含 v3 冻结快照恢复、v4 精修闭环（Lint 反馈重试、行为剧本、合并章节修正、盲比择优、检查点零重复调用恢复）与 v4 快速路径（并行章节、浏览器发现溢出后只重生成该章、无模型审查）。
- 服务端类型检查、oxlint、prettier 通过；前端 report-decks 相关 41 项通过。

### 6.2 真实模型运行（同一 BYOK `gpt-6.1-sol`，隔离库，虚构材料）

证据目录：`.codex-artifacts/report-web-v4/<用例>-<运行>/`（计划、产物、行为日志、审查、截图、耗时）。

| 运行          | 模式   | 结果                       | 耗时     | 调用 | 章数 | 图表 | 方向 / 构图               |
| ------------- | ------ | -------------------------- | -------- | ---- | ---- | ---- | ------------------------- |
| data-r5       | refine | ready，2 轮修正 + 2 次盲比 | 21.5 min | 19   | 7    | 10   | whitepaper；7 章 7 种构图 |
| process-r1    | refine | ready                      | 13.5 min | 15   | 4    | 1    | route-map                 |
| text-r1       | refine | ready，1 轮修正            | 8.1 min  | 10   | 4    | 1    | editorial-spread          |
| data-fast2    | fast   | ready（1 章重试）          | 2.8 min  | 9    | 6    | 5    | whitepaper                |
| process-fast2 | fast   | ready                      | 2.2 min  | 6    | 4    | 2    | route-map                 |
| text-fast2    | fast   | ready                      | 1.9 min  | 6    | 4    | 1    | editorial-spread          |
| atlas-fast2   | fast   | ready                      | 2.1 min  | 7    | 4    | 1    | data-poster               |
| data-fast3    | fast   | ready（含本轮全部修复）    | 2.4 min  | 8    | 6    | 6    | whitepaper                |

观察：四份材料得到四种方向（白皮书 / 路线图 / 杂志特稿 / 数据海报），配色与构图随风格要求变化；薄材料 Atlas 由 v3.1 的 8 章降为 4 章；所有运行重复句为 0；交付页全部通过鼠标、键盘、触屏、演示分步、无脚本与打印检查（失败项按规则降级）。

### 6.3 真实运行暴露并已修复的问题

承载页缺 viewport 导致移动端截图失真；动画终态检查把视口外元素计为隐藏；BYOK 未声明上下文窗口时被 32K 回退卡住修正；文本检查点恢复时被重复解析；截图元数据带 hash 导致缓存失效；修正头部 `type`/`op` 别名、动效序号上限、构图规则在修正阶段过严、ops 数量上限；章节引用未声明派生值；净化器反馈不列出被移除的标签（并放行 `article`）；`details` 默认展开时交互检查误判；深色面上图表墨色系列不可见；图表 ID 未带章节前缀浪费重试；数据集标签被迫取连接词（“从/提高到”）；被拒绝的模型条目误报“部分资料未纳入”。

### 6.4 已知限制

- 快速模式没有模型看图审查，设计质量依赖计划 Lint、rd-kit 与确定性检查；需要更高质量时开启精修模式。
- 免责/背景声明仍可能出现在首屏主体（仅提示词约束，未做确定性检测）。
- 每个用例只有 1–3 次运行，不代表统计意义上的稳定优势；需要按第 5 节扩大重复次数。
- 本地热启动实例挂载源码并由 nodemon 自动重载，因此本地实例已运行 v4（快速模式）；未构建或发布生产镜像，未提交代码。

### 6.5 同材料、同模型的 v3.1 基线

用 `LOCALMIND_REPORT_DESIGN_ENGINE=v3` 冻结 v3.1 提示词，在相同材料与要求下运行：

| 用例    | v3.1 结果                               | 原因                                             | v4 快速模式          |
| ------- | --------------------------------------- | ------------------------------------------------ | -------------------- |
| data    | 失败（7.0 min）                         | 分批生成连续 3 次未通过数字/claims 校验          | ready，2.4–2.8 min   |
| process | 失败（2.0 / 4.2 min）                   | 第一次上游 502；重跑时 Build 达到单次 120 秒上限 | ready，2.2 min       |
| text    | 失败（7.6 min）                         | Build 两次校验失败后超时                         | ready，1.9 min       |
| atlas   | 历史记录 ready（v3.1，约 10 min，8 章） | —                                                | ready，2.1 min，4 章 |

v3.1 在信息较多的材料上交付失败，原因与第 1 节的结构性问题一致（禁止数字门槛、JSON 字符串整篇输出、单次 120 秒上限）。

### 6.6 每次提交的生成模式：实施与验证（2026-10-19）

前后端已贯通 `config.designMode`：配置页选择、创建时冻结、运行快照路由、历史标签、结果状态、重新配置和失败重试。模式不进入偏好存储，重建表单及复用精修汇报配置均回到快速；模板请求不携带此字段。AI 能力声明只用于提示，不替代运行时视觉验证，也不切换用户选择的模型。

本轮验证复用 `localmind_report_v3_verify`（固定镜像 `localmind-affine:dev-base`）及独立 PostgreSQL/Redis；未重建镜像，未删除数据卷。准备隔离库时通过 `yarn workspace @affine/server prisma migrate deploy` 应用已有的 419 个迁移，本次没有新增迁移。执行命令与结果：

```sh
# 47 项前端 + 53 项共享协议，共 100 项通过
# 包括默认值、不记忆、配置复用、提交值、再次生成入口及四种结果状态
docker exec -w /workspace localmind_report_v3_verify yarn vitest run \
  packages/frontend/core/src/desktop/pages/report-decks \
  packages/frontend/core/src/modules/report-decks/api.spec.ts \
  packages/common/office/src/report/deck/deck.spec.ts

# 18 项通过，使用真实 Chromium 和隔离 PostgreSQL，模型输出为固定测试响应
docker exec -e LOCALMIND_REPORT_DESIGN_ISOLATED=yes -w /workspace \
  localmind_report_v3_verify sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn workspace @affine/server ava --serial src/__tests__/report-deck/mode.spec.ts src/__tests__/report-deck/ai.spec.ts src/__tests__/report-deck/design-v4.e2e.ts'

# 服务端与前端类型检查通过
docker exec -w /workspace localmind_report_v3_verify \
  yarn tsc -b packages/backend/server packages/frontend/core --pretty false

# i18n 使用既有生成流程，未手工改写生成文件
docker exec -w /workspace localmind_report_v3_verify yarn workspace @affine/i18n build
```

- 后端覆盖显式选择优先于相反的全局默认、创建幂等、重试保持原模式、权限拒绝、禁用链路拒绝、旧记录兼容、视觉声明提示，以及精修完整/部分/全部失败与快速无视觉审查路径；继续验证 Chromium 修正、盲比与检查点恢复。
- 最后统一零次视觉审查成功时的 `unavailable` 状态和提示，并单独复跑精修全部失败、部分失败两条浏览器用例。
- 本轮 20 个 TS/TSX 文件的 oxlint 无警告、无错误；变更文件 Prettier 与 `git diff --check` 通过。
- 本地热启动页面在 1280×720、390×844 及深色主题下检查；鼠标与方向键切换、按钮/摘要同步、刷新恢复快速均通过。测试后恢复原来的跟随系统主题与浏览器视口。截图和测试日志在 `.codex-artifacts/report-mode-selection/`。
- Docker 检查结束时：镜像 33.12 GB、容器 1.376 GB、数据卷 21.67 GB、构建缓存 14.19 GB，未新增镜像。验证容器测试后停止，保留原数据卷。
- 本地热启动实例直接挂载源码，本轮变更已随热更新载入；没有调用同步脚本、提交代码或发布生产镜像。本轮未调用真实外部模型，真实 provider 的视觉兼容性仍以运行时探针和实际审查结果为准；第 6.2 节的真实模型证据属于此前 v4 验证。
