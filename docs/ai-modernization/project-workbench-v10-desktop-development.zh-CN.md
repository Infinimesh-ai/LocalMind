# Project v10 Circuit 桌面工作台开发文档

日期：2026-09-29。版本：1.0。状态：待实施；本文件不代表功能已开发或通过验收。

执行入口：[配套 Goal 指令](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/project-workbench-v10-desktop.goal.md)。
设计依据：[v10 设计与实施方案](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/project-workbench-v10-desktop-design-implementation.zh-CN.md)。

本文将设计方案收敛为开发任务、组件边界、交互约束和验收矩阵。执行本 Goal 时以本文的实施范围和集成规则为准；已有业务契约继续有效。

## 1. 目标与交付边界

让 Electron 用户通过 Circuit 风格的 Project 工作台查看本人任务、继续会话、查看协作进展，并在同一工作区打开、编辑和使用真实项目资源。

必须交付：

1. 桌面工作台壳：系统导航、项目/会话侧栏、业务头部和可调整面板。
2. 任务条目视图、当前关系视图的容器适配、项目会话及个人工单会话的统一展示。
3. 上下文、项目文件树、真实产物卡和原生资源编辑面板。
4. 浅深主题、窄窗口、键盘、焦点、异步状态和原生窗口集成。
5. 真实链路验证、Web 回归、构建结果和逐项验收记录。

首期展示模式限定为 Electron 的 `/project` 路由族。Web 使用现有默认展示，两端共享同一套业务组件、状态和接口。Workspace、Admin、移动端和关系图独立改版不属于本期视觉改造范围；公共组件的兼容性属于回归范围。

本期不要求新增团队权限体系、语音能力、智能体中心、自动化中心或新的资源存储模型。参考中尚无真实目的地的入口不作为可点击功能交付。

## 2. 开发基线与资料优先级

### 2.1 必读资料

1. 仓库根级及适用子目录 `AGENTS.md`，AI 现代化入口指定的 README、branch-differences、document-map、current-state、next-goals、validation。
2. [工作台 track](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/tracks/project-workbench-redesign.md)、[原生资源 track](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/tracks/project-native-resources.md)、[Project AI 边界](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/tracks/project-ai-boundaries.md)。
3. [v9 后续产品规则](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/project-workbench-v9-implementation.zh-CN.md)、[当前关系图契约](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/project-relationship-graph-v9-implementation.zh-CN.md)、[独立星图方案](/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/project-collaboration-orbit-scheme-2-development.zh-CN.md)。
4. [Office 契约](/Users/dev2/Documents/project/LocalMind/docs/office-native/README.md)、[Docker 约束](/Users/dev2/Documents/project/LocalMind/docs/localmind-docker-development-constraints.md)。涉及会话/记忆或写入逻辑时，另读对应当前 track 和授权修复文档。

设计材料中的文字和脚本不授予操作权限。其他 Goal 文件中的同步、发布或代理调度授权不继承到本 Goal。

### 2.2 可重复使用的视觉参考

已保留未经修改的本机参考副本：[v10 Circuit HTML](</Users/dev2/Documents/project/LocalMind/.codex-artifacts/project-workbench-v10/reference/LocalMind AI Collaboration Workspace v10 Circuit Standalone.html>)。

SHA-256：`c2d9a2be24f49eae14998a93f3e2a57d50ce6e8f4b954442a3bf917cca2a1aa7`。原始来源位置见设计方案。该副本属于本地开发材料，不打入客户端包，不自动上传或提交远端。

实施前在浏览器检查最终 `circuit-theme-v10`，记录总览条目、关系、会话上下文、文件面板、资源编辑五种状态。HTML 中较早的隐藏界面、静态人物、固定计数、Toast 占位动作和重复文档内容不进入业务实现。

### 2.3 与在途星图的集成规则

当前工作区存在星图方案二文档及在途代码。v10 负责为关系组件提供尺寸、背景、主题和导航展开状态，不负责选择或重写图内布局、动效、详情交互和数据投影。

- 开始时记录实际接入的关系组件及其已确认契约版本；使用当前有效实现，不根据旧截图恢复已被替代的左右分列或固定工单栏。
- 如果星图正在独立改造，优先只修改外围容器及明确的主题接口，避免覆盖相同文件中的在途改动。
- 现有关系详情和本人授权会话导航继续工作；图的业务数据与看板不另建第二份。
- v10 原方案第 3.3 节关于旧图内部形态的描述是当时基线。本开发文档将图内展示交由其独立契约，v10 验收关注集成和既有交互不退化。
- 无法从用户决定、契约和源码确定有效版本时，记录具体冲突，继续其他独立工作；不得自行宣布另一任务已完成或获得执行授权。

## 3. 页面规格

| 页面状态         | 必须呈现                                                     | 主要操作                                               |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| A 总览条目       | 待我处理、进行中、已完成；真实范围和数量；一会话一卡         | 筛选、打开本人会话、新建会话、现有菜单动作             |
| B 关系视图       | 当前关系组件完整占用主区，工具栏和详情不被新壳遮挡           | 沿用当前图的选择、镜头、详情和授权导航                 |
| C 会话＋上下文   | 会话标题、消息、引用、执行证据、产物、输入区；右侧状态和来源 | 发送、停止、重试、管理引用、打开产物                   |
| D 会话＋项目文件 | 完整原生树和管理入口；清晰区分打开与引用                     | 新建、上传、打开、重命名、移动、历史、回收站等既有动作 |
| E 会话＋资源     | 同一个资源 ID 的原生编辑器、保存/只读状态与真实操作          | 编辑、保存、已有导出/历史、切换树、关闭返回            |

个人工单会话沿用同一视觉语言，继续保留本人工单 scope；不能为了补齐右栏而读取来源项目树、Memory 或他人会话。

### 3.1 布局与视觉基准

- 系统栏约 56px，项目栏默认约 232px，业务头部约 56px，上下文约 280px，文件面板约 320px。既有用户面板宽度保留并按新可用空间约束，不无条件重置。
- 会话与资源并排时，会话约 360px、编辑区约 480px 为初始可用宽度目标。不足时先收导航，再提供扩大编辑区或内容切换，保留编辑器和运行时状态。
- 冷灰底、浅色分层面板、轻边框/阴影、珊瑚红强调色；正文约 14px、辅助文字不低于 12px。颜色映射到局部语义 token，品牌素材复用现有资产。
- 原生窗口安全区与业务头部分开：macOS 交通灯、Windows 控件、拖动区和可点击区域不能互相覆盖。参考的外部画框不在窗口内部重复绘制。
- 菜单、浮层、提示、资源选择器和编辑器工具栏使用现有层级体系；检查滚动容器、剪裁和焦点，不能只让静态截图正确。
- 所有新增用户文案进入现有 i18n 流程，至少覆盖项目既有中文和英文回退。长标题、长中文、错误信息和空名称都有合理布局。

### 3.2 业务文案与真实数据

| 展示内容                           | 数据或动作来源                                | 缺失时处理                             |
| ---------------------------------- | --------------------------------------------- | -------------------------------------- |
| 卡片标题、归属、待我原因、更新时间 | 现有 owned-session / 工单投影                 | 保留已有名称回退，不编造摘要           |
| 看板数量                           | 服务端范围及分页元数据                        | 已加载数量需标清范围，不能当作全部     |
| 执行记录                           | 当前会话的 run、step、timeline 和真实审批状态 | 展示实际阶段/不定进度，不固定四段进度  |
| 协作者                             | 有权限读取的成员或工单参与者                  | 不推断其私人会话内容                   |
| 当前会话引用                       | 持久化的会话上下文资源集合                    | 空态提供显式引用入口                   |
| AI 产物                            | 真实资源与来源/版本证据                       | 无来源证据时展示普通资源，不按名称猜测 |
| 保存、历史、导出                   | 原生资源组件与已有领域服务                    | 不支持的动作不显示成功占位             |
| 成果采用、工具审批、发布授权       | 分别调用对应对象的动作及实时授权              | 不合并为通用“批准当前版本”             |

“等待他人”归进行中；已完成保留历史分页；查看不自动标记完成。原型中的“全部团队”和默认七天限制不改变已有范围与历史规则。

## 4. 工程结构与状态所有权

### 4.1 展示模式

在 [Project 页面入口](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/index.tsx) 集中选择 `default` / `circuit`。可沿用 `BUILD_CONFIG.isElectron`，子组件接收展示参数或继承局部主题，不各自判断平台。

抽出薄的壳，通过内容槽组合现有模块。建议新增以下文件；名称可以按现有约定微调，但职责必须保持单一：

- `/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-workbench-shell.tsx`：系统栏、项目栏、头部、内容和右面板组合。
- `/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-workbench-shell.css.ts`：尺寸、网格、滚动和窄窗口规则。
- `/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-circuit-theme.css.ts`：限定在根容器内的浅深主题。
- `/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-system-rail.tsx`：真实全局入口和当前态。

路由、查询、mutation、权限和业务动作继续由现有页面/模块管理。无需复制一份 `index.tsx`、新建一个前端应用或引入通用平台抽象框架。

### 4.2 必须复用的组件

| 模块       | 入口                                                                                                                                                                                                                                                                                             | 本期责任                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 项目导航   | [project-tree.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-tree.tsx)                                                                                                                                                               | 项目展开、会话选中、状态和管理入口            |
| 总览       | [conversation-board.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/conversation-board.tsx)                                                                                                                                                   | 条目卡片、筛选、切换和关系组件容器            |
| 关系组件   | [collaboration-graph.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/collaboration-graph.tsx)                                                                                                                                                 | 集成其当前有效实现，按需提供局部主题接口      |
| 会话       | [workbench-conversation.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/workbench-conversation.tsx)                                                                                                                                           | 会话头部、容器和共享聊天展示配置              |
| 工单会话   | [work-order-conversation.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/work-order-conversation.tsx)                                                                                                                                         | 统一展示，保留 scope、私密性和工单动作        |
| 聊天元素   | [ai-chat-content.ts](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/blocksuite/ai/components/ai-chat-content/ai-chat-content.ts)                                                                                                                                             | 扩展明确可选的展示属性、slot 或 CSS variables |
| 上下文     | [project-context-panel.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-context-panel.tsx)                                                                                                                                             | 真实状态、协作者、来源和动作的层级            |
| 文件与资源 | [project-files.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-files.tsx)、[project-resource-preview.tsx](/Users/dev2/Documents/project/LocalMind/packages/frontend/core/src/desktop/pages/intelligence/project-resource-preview.tsx) | 容器、打开路径、树/编辑器切换和头部           |
| 桌面窗口   | [App](/Users/dev2/Documents/project/LocalMind/packages/frontend/apps/electron-renderer/src/app/app.tsx)、[Shell App](/Users/dev2/Documents/project/LocalMind/packages/frontend/apps/electron-renderer/src/shell/app.tsx)                                                                         | 与已有窗口控件和壳的关系，避免双重导航        |

聊天包含 Lit 自定义元素：仅修改 React 外层 CSS 无法完成内部消息与输入区适配。先检查公开样式变量和属性，再做最小扩展；默认配置保持其他消费者的原行为，不使用全局选择器穿透 Shadow DOM，不复制聊天组件。

### 4.3 面板状态与导航

保留 `ProjectRightPanelState` 的单一状态源，以及现有路由中的 project/session/resource/workOrder ID。

| 事件                   | 状态转换及要求                                                   |
| ---------------------- | ---------------------------------------------------------------- |
| 从上下文打开资源       | `context → resource(id, openedFrom=context)`；不自动引用         |
| 从文件树打开资源       | `projectTree → resource(id, openedFrom=projectTree)`；保留树定位 |
| 资源打开时切换窄树     | 只改变 `treeOpen`，不卸载编辑器或重建聊天运行时                  |
| 关闭资源               | 回到 `openedFrom`，恢复触发点焦点和树选中；脏内容先经过已有保护  |
| 引用到会话             | 使用现有 runtime/context 动作持久化；与打开资源分开              |
| 拖动、折叠、扩大编辑区 | 只改展示偏好，不能重建 session/run 或改变资源 ID                 |
| 后退、前进、刷新、深链 | 从路由恢复对象并重新授权，不能按标题寻找替代资源                 |
| 切换项目/会话          | 依照现有生命周期切换上下文，处理脏状态，避免上一会话数据残留     |

宽度偏好沿用 `localmind.project.pane-widths`，非法值按现有边界回退；如确需区分模式，只增加向后兼容的偏好字段。业务状态不得搬到 localStorage。

### 4.4 数据与权限改动门槛

默认复用已有 API。先建立 UI 字段到真实数据的映射，再判断缺口。仅核心展示或操作确有缺失时扩展有界 GraphQL 投影，同步服务端、共享 operation、生成类型与测试；不能手改生成文件。

Project 保持独立资源和原生版本；Office/PDF 不塞入 BlockSuite Page。保留租约、CAS、不可变修订、来源复制/发布权限、全局 Project BYOK、共享 Memory 与私人会话隔离。视觉改造不能扩大工具注册、MCP 凭据、工单参与者或数据受众。

## 5. 开发工作包

| 编号 | 工作                                                             | 依赖   | 交付检查                                                     |
| ---- | ---------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| P0   | 核对 git status/diff、原型摘要、运行入口、关系图版本、组件和字段 | 无     | 基线记录、字段映射、可用验证环境、已有失败清单               |
| P1   | 展示模式、新壳、局部 token、原生窗口安全区和尺寸策略             | P0     | 五种状态可承载现有业务；Web 默认模式正确                     |
| P2   | 项目导航、新会话、总览卡片与关系容器                             | P1     | 真实导航、筛选、分页、状态及管理操作正确                     |
| P3   | 会话头部、消息/输入展示、执行记录和产物卡                        | P1     | 一条真实消息可发送、流式更新、停止/重试；已有工具/审批可操作 |
| P4   | 上下文、文件树、原生编辑器和面板恢复                             | P2、P3 | 新任务→真实产物→打开→编辑保存→返回会话闭环                   |
| P5   | i18n、主题、窄窗口、键盘、焦点与失败状态收尾                     | P2—P4  | 视觉检查和关键状态用例通过                                   |
| P6   | 聚焦测试、两端构建、真实 Electron/本机包冒烟、Web 回归与报告     | P0—P5  | 验收矩阵有逐项证据，未验证平台与剩余风险明确                 |

P1—P5 按本任务范围直接推进。常规组件拆分、尺寸微调和兼容修复不设额外确认关卡。遇到新的产品范围、权限受众或不可逆操作时，说明具体分歧；继续不受影响的工作。

每阶段更新拟建执行记录：`/Users/dev2/Documents/project/LocalMind/docs/ai-modernization/project-workbench-v10-desktop.execution.zh-CN.md`。记录阶段、涉及文件、实际命令/退出状态、验收 ID、证据路径、失败原因和下一步。尚未执行的项使用“待执行”，不得预填通过。

## 6. 验收矩阵

所有适用项必须有实际结果。表中的“保持原规则”必须通过聚焦测试或真实操作证明，不能仅凭阅读代码宣告通过。

| ID  | 必须满足                                                         | 最小证据                             |
| --- | ---------------------------------------------------------------- | ------------------------------------ |
| A01 | Electron Project 使用 Circuit，Web 使用默认模式                  | 两端相同路由截图与模式测试           |
| A02 | 系统栏、项目栏、头部和面板接近参考层级；无重复窗口壳             | 本机 Electron 五种状态截图           |
| A03 | 项目展开/会话导航、创建/改名/管理及个人工单分组可用              | 操作记录和导航测试                   |
| A04 | 新会话明确选择项目，首次成功发送绑定真实会话                     | 请求/结果和刷新后的 URL              |
| A05 | 一会话一卡，待我处理与等待他人分类正确，完成历史可继续加载       | 有多个状态和历史分页的数据用例       |
| A06 | 卡片和引用导航到本人授权的准确对象                               | route/scope 用例，拒绝或失效入口用例 |
| A07 | 当前关系组件的筛选、详情、相机、授权导航不退化                   | 原有相关测试及真实集成操作           |
| A08 | 发送、流式输出、停止、失败重试、输入法和草稿正常                 | 真实会话操作及关键组件测试           |
| A09 | 面板切换/调整不重建同一会话 runtime，不重复执行请求              | 运行中切换测试和请求计数证据         |
| A10 | 执行记录使用真实阶段、审批和结果，无假进度/假指标                | 有成功与失败/等待状态的执行记录      |
| A11 | 产物卡打开其真实资源与版本，不显示固定预览文案                   | 两个不同产物的 ID/类型及实际内容     |
| A12 | 打开和引用分离，引用持久化，删除或失权时正确反馈                 | 打开/显式引用/刷新/失效测试          |
| A13 | 项目文件管理入口完整，操作后数据与树一致                         | 受影响 CRUD、历史、回收站等用例      |
| A14 | Page/Edgeless、Office/PDF、普通文件走正确原生组件                | 各已支持资源类别的样本打开记录       |
| A15 | 编辑保存稳定资源 ID，版本推进正确，失败不创建同名副本            | 编辑成功、冲突或失败记录             |
| A16 | 租约只读、脏状态保护、编辑器展开/返回正确                        | 双窗口占用及未保存切换用例           |
| A17 | 关闭恢复上下文/树与焦点；前进后退、刷新和资源深链正确            | 状态转换和浏览历史用例               |
| A18 | Project BYOK 缺失/异常仍可处理，工单与项目的私人边界不变         | 配置错误态、scope/权限回归           |
| A19 | 浅深主题、1440×900/1280×800、窄窗口及 125%/150% 缩放可用         | 分组截图；不要求完整笛卡尔积         |
| A20 | 键盘、焦点、长中文、菜单/浮层、loading/empty/error/disabled 可用 | 聚焦操作和边界状态截图               |
| A21 | 本机 Electron 原生控件、窗口拖动、最大化/全屏可用                | 原生应用验证记录；其他平台单列状态   |
| A22 | 两端构建成功，共享组件和受影响业务测试通过                       | 精确命令、退出状态、测试汇总         |
| A23 | 本机生成的桌面应用包可启动并进入 Project 核心路径                | 包路径/构建信息和本机包冒烟记录      |
| A24 | 所有任务、验收、差异和剩余平台风险可追溯                         | 执行文档、截图/日志索引和最终报告    |

Windows/Linux 原生行为若没有可用环境，明确标为未实测及对应发布限制；本机原生验证 A21、A23 必须执行。跨平台编译/条件分支测试不能标作该平台真人机验收。资源当前不支持的编辑能力不因 A14 被扩大，需记录真实能力边界。

## 7. 验证流程

### 7.1 先聚焦，后集成

按改动选择现有 `index`、`project-tree`、`new-conversation`、`project-context-panel`、`project-files`、`project-file`、`project-chat-config`、`pane-resize-handle` 和关系组件测试。补充展示模式限定、面板恢复、运行时生命周期和请求不重复等行为测试，不为每个颜色/类名建立实现镜像测试。

常用命令在仓库根执行；列出的新 E2E 文件是本期拟新增文件，创建并配置真实测试环境后才能运行：

```sh
yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/index.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/project-context-panel.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/project-files.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/pane-resize-handle.spec.tsx
yarn workspace @affine/electron-renderer build
yarn workspace @affine/web build
yarn workspace @affine/electron build
yarn workspace @affine/electron package
yarn workspace @affine-test/affine-desktop e2e e2e/project-circuit.spec.ts
git diff --check
```

不要假设以上命令没有环境依赖：先检查 [Electron 测试 fixture](/Users/dev2/Documents/project/LocalMind/tests/kit/src/electron.ts)、[桌面测试配置](/Users/dev2/Documents/project/LocalMind/tests/affine-desktop/playwright.config.ts)、[Electron 包脚本](/Users/dev2/Documents/project/LocalMind/packages/frontend/apps/electron/package.json) 和实际打包配置。当前 fixture 使用桌面 `dist` 副本，开发 renderer 模式约定 `http://localhost:8080`；Project 在线能力还需专用测试服务和账号。复用隔离环境，不能让会清库的测试接入业务库。

对改动文件执行 `yarn lint:ox`、Prettier 和相关类型检查；共享类型/属性变更需要覆盖消费者。全仓检查若有基线问题，记录具体文件和诊断，证明本次变化未新增相关错误，不能仅称“历史问题”。GraphQL/i18n 变化使用仓库真实生成命令。

### 7.2 容器与原生端分工

共享代码、AI 路径和相关集成验证遵守 Linux 容器基线，优先复用 `localmind-affine:test` 或已有容器。桌面包与原生窗口验证使用对应宿主平台。容器测试、浏览器截图和原生包冒烟各自证明不同事项，不互相替代。

只有打包/native/工具链等具体需要时考虑重建；先检查 `docker system df`，预计新增超过 30 GB 时停止该构建并报告。固定 tag 仍为 `localmind-affine:dev-base`、`localmind-affine:test`、`localmind-affine:local`。不删除 volume、业务数据或其他项目镜像。

### 7.3 证据与完成判定

证据放在 `/Users/dev2/Documents/project/LocalMind/.codex-artifacts/project-workbench-v10/`，按 reference、screenshots、logs 区分。基线截图、最终五种状态、真实链路和本机包结果必须标明时间、路由、展示模式和测试范围；日志脱敏。

本 Goal 的完成包括代码、适用 A01—A24 和执行记录。原型完成、构建成功、截图漂亮或某一个流程通过均不代表整体完成。遇到真实环境阻塞，继续独立工作并保留未验项，不虚报；Goal 状态按实际工具规则更新。

本期交付为源代码和本机验证产物。更新日常运行容器、替换用户安装的客户端、签名、公网发布、commit、push、PR 等需要另外的明确请求；本 Goal 不从其他任务继承这类授权。

## 8. 当前文档交付状态

- 已整理开发范围、代码位置、工作包、交互状态和验收矩阵。
- 已保留 v10 HTML 的本地原样参考并核对 SHA-256。
- 当前尚未启动 Goal、修改业务代码、构建客户端或执行 A01—A24。
- 开发开始时再创建执行记录并填写实际结果，保留已有工作区改动。
