# Project v10 融合实施与验收记录

日期：2026-10-12。实施基线：`b0dc17d9b4`。用户已确认等待页面树任务完成后按
[融合盘点与方案](project-workbench-v10-fusion-audit-and-design.zh-CN.md)实施，
Web 与 Electron 共用业务布局，分别适配窗口壳。实现保留为本地工作树改动。

现行产品契约以[Project工作台重构](tracks/project-workbench-redesign.md)和
[Project原生资源](tracks/project-native-resources.md)为准；个人工单、上下文/记忆及独立关系图
继续遵守盘点方案列出的各自有效契约。

## 1. 最终实现

采用现有 Project 壳、控件、主题和原生业务组件，调整导航、总览卡片、会话阅读、
上下文分区、资源浏览及编辑宽度。未引入第二套聊天、资源存储、权限或 AI 状态。
协作星图内部模型、布局和交互未改动。参考附件的渲染仍受工具 URL 安全策略限制，
只按其 HTML/CSS 组织方式选择性借鉴，不声称完成像素比对。

- 总览：项目/个人工单筛选下沉至服务端；列条件在分页前执行，计数与列表采用相同
  actor、未删会话、有效项目成员和范围条件。授权项目列表确认失效后重置范围并反馈不可用，
  屏蔽旧项目卡片缓存，保留私人订单快照。固定会话仍优先，游标绑定筛选范围。
  新筛选拒绝旧范围游标；原无范围请求仍兼容旧游标。分页去重，晚到响应不跨范围串页。
- 壳与导航：宽窗口可主动收起导航；1040px 以下为抽屉。总览可用宽度不足900px时
  切换三类会话；资源工作区不足980px时使用主视图切换。分隔条继续可调宽。
  两端复用同一页面，Electron 保留既有原生标题栏，Web 不增加窗口控制。
  次要文案使用现有主题tokens的混色提升对比度，完成标签保留状态底色并使用可读文字。
- 会话：沿用 AIChatRuntime、消息与输入组件；标题两行及全文提示，正文与输入同轴。
  打开资源时保持 URL 中的原 sessionId、会话运行时和上下文绑定。
- 上下文：当前引用、冻结/最新版本与不可用状态、私人附件、相关工单、共享信息和
  项目级发布历史分区。交付方向使用接单人→发单人；没有名称、大小或状态数据时
  使用可读的未知/不可用说明，避免裸 ID 和假零。
- 文件：保留完整树、上传队列、导入、回收站及对象菜单，新增授权项目资源搜索和
  分页、多选、批量移动/移入回收站。最多50项；写入使用真实元数据版本和幂等键。
  先解析祖先，选中文件夹覆盖已选后代，避免重复写入或拆散目录；失败项保留选择。
  取消搜索选择是本地操作，不因资源已不可用而无法取消，也不产生读取或写入。
  内容版本与目录元数据版本分开。发生版本冲突时需重新选择核对，不自动覆盖新版本。
- 编辑：原生 DOCX/Sheets/Slides/PDF、Page/Edgeless、普通文件组件继续使用。
  默认资源面板约640px起，可展开编辑区；窄窗口原生编辑器占主区，内部导航按原机制收起。
  离开保护提升至 Project 壳，关闭/切换/返回/批量管理先处理未保存内容。
  普通文件 guard 改为同步读取真实 dirty 引用，修复保存成功后第一次返回仍被阻挡的竞态。
  700px以内的编辑区让资源标题单独占一行，保留直接可见的操作。
  Project修订响应头加入既有CORS可读列表，使Electron取得保存所需的真实版本，
  不扩大允许来源、成员权限或写入资格。
- 工单与记忆：保留冻结要求、私人会话、草稿检查、正式确认、不可变回执、追问/拒绝及采用。
  未加载角色时不假设为发件人。共享记忆增加最近贡献历史与服务端 canUndo 允许的撤销入口，
  继续经过确认和已有受版本/贡献关系约束的领域操作。
- 未登录状态：收到 `currentUser: null` 时明确显示登录提示，复用现有登录弹窗；
  隐藏并清空旧分页、使在途页过期，不把未登录显示成没有项目，也不在重新登录后恢复旧私人分页。
- 账号与窗口壳：Project 查询缓存和会话视图按服务器/账号重新建立；同一账号刷新保留
  当前会话状态。Electron复用 ViewTitle/ViewIcon，以真实资源、工单、会话或项目标题同步标签页，
  不保留上一份 Workspace 文档的标题。

## 2. 功能保留追踪

下面每项沿用设计表的 F 编号。保留表示继续由原业务组件承载，不表示本轮重新实现
其全部领域逻辑，也不代表每种 Office 功能都重新进行了人工验收。

| 功能                                                                    | 最终落点   | 实施处理                                               | 代码/测试证据组 |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------ | --------------- |
| F01 独立 Project 路由、返回 Workspace、深链                             | H/N/P      | 资源打开/返回继续绑定原session，壳层离开保护           | C1/C2/C9        |
| F02 我的项目、项目展开、多项目会话树                                    | H/N/P      | 多项目展开和选中保留；宽窗可收导航、窄窗抽屉           | C1/C2/C9        |
| F03 新会话前明确选择项目、创建项目                                      | H/N/P      | 壳与项目导航、设置原入口保留                           | C1/C2/C9        |
| F04 会话固定、取消固定、固定优先                                        | H/N/P      | 壳与项目导航、设置原入口保留                           | C1/C2/C9        |
| F05 会话重命名、自动标题与手动标题版本冲突                              | H/N/P      | 壳与项目导航、设置原入口保留                           | C1/C2/C9        |
| F06 历史会话、删除会话与确认                                            | H/N/P      | 壳与项目导航、设置原入口保留                           | C1/C2/C9        |
| F07 项目重命名、归档、归档列表、恢复                                    | H/N/P      | 壳与项目导航、设置原入口保留                           | C1/C2/C9        |
| F08 成员身份、Owner/member、邀请、移除、转移所有权、退出                | H/N/P      | 真实成员人数明确入口；保留角色管理、所有权与退出       | C1/C2/C9        |
| F09 全局搜索、通知、账户、主题语言                                      | H/N/P      | 保持真实搜索、通知、账户、主题和语言入口               | C1/C2/C9        |
| F10 总览三列、一会话一卡、标记完成/再打开                               | O/C        | 一会话一卡；分栏条件在服务端分页前计算                 | C3              |
| F11 项目/个人工单筛选、列表/关系视图切换                                | O/C        | 筛选下沉服务端，筛选后仍可分页                         | C3              |
| F12 服务端列计数、分页、刷新、加载/错误                                 | O/C        | 相同权限/范围的DB计数；未知显示—；迟到页隔离和错误重试 | C3              |
| F13 关注原因、活跃执行数、最近业务时间、工单来源与缺项                  | O/C        | 真实来源/缺项/活跃执行保留，内部原因转业务文案         | C3              |
| F14 Workspace 来源本人会话及原有跳转                                    | O/C        | 保留Workspace来源卡及原域导航，不混入项目内资源        | C3              |
| F15 任务抽屉与完整任务页、状态分类                                      | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F16 需要我操作/等待他人、截止时间与逾期                                 | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F17 手动阻塞项、AI 建议确认、待回复/资料/决策/自定义、解决/放弃         | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F18 文件请求、授权申请、邀请处理与撤回                                  | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F19 AI 执行详情、步骤/时间线/预览/失败证据/产物                         | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F20 批准、拒绝、取消、继续、放弃等服务端允许动作                        | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F21 等待编辑权、占用者、重试/等待信息                                   | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F22 实时刷新、重连、状态变更后的失效处理                                | T/C/E      | 任务、审批、运行详情与实时继续由原组件承载             | C5              |
| F23 协作星图、本人/协作者、真实头像降级                                 | G          | 现有星图及其内部交互完整保留                           | C6              |
| F24 工单胶囊、收/交付方向、历史/草稿、原位详情与自有会话跳转            | G          | 现有星图及其内部交互完整保留                           | C6              |
| F25 星图缩放、平移、适配视图、选择和减弱动画                            | G          | 现有星图及其内部交互完整保留                           | C6              |
| F26 消息历史、流式回答、Markdown/表格/代码、复制与重试                  | C/X/E      | 调整正文/输入阅读宽度，原消息组件完整保留              | C4/C8           |
| F27 输入、附件、引用 chips、发送、停止、错误后重试                      | C/X/E      | 原聊天运行时、输入、选区及引用流程保留                 | C4/C8           |
| F28 引用选择/移除、树选、多选、搜索及上限                               | C/X/E      | 原聊天运行时、输入、选区及引用流程保留                 | C4/C8           |
| F29 引用冻结版本/最新版本、刷新、不可用资料                             | C/X/E      | 右上下文增加冻结/最新版本、失效提示和显式刷新          | C4/C8           |
| F30 私人上传附件与项目资源不同来源                                      | C/X/E      | 私人blob附件单独分组，真实名称/大小，缺失不写0         | C4/C8           |
| F31 Office 当前修订/选区 AI 上下文                                      | C/X/E      | 原聊天运行时、输入、选区及引用流程保留                 | C4/C8           |
| F32 项目共享记忆、本人贡献过滤、项目级自动贡献                          | P/H        | 项目级设置/本人贡献/共享边界保留，新增贡献历史         | C9              |
| F33 记忆删除/版本检查、贡献与冲突审核                                   | P/H        | 删除/冲突保持原规则；新增canUndo确认撤销               | C9              |
| F34 项目摘要列表与创建                                                  | P/H        | 共享记忆、贡献/冲突和项目摘要保留                      | C9              |
| F35 上下文整理状态、摘要查看、取消/重试/关闭提示                        | C          | 沿用已有上下文整理组件                                 | C4              |
| F36 工单草拟、统一要求模板、修改意见、发单确认、取消草稿                | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F37 通知/个人工单入口与独立私人接单会话                                 | C/W/T      | 私人会话独立；窄窗对话/要求切换，不开放来源树          | C10             |
| F38 目的、来源项目名快照、关系类型、版本、冻结要求                      | C/W/T      | 冻结目的、来源快照、关系/版本完整，状态/关系业务化     | C10             |
| F39 按要求填文字/上传文件、格式数量大小、生成支持/失败状态              | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F40 保存/重检交付草稿、逐项缺失原因                                     | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F41 ready 后会话内确认完成并发回                                        | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F42 不可变交付回执、版本历史、下载、准备新版本                          | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F43 收件人追问/拒绝、发件人回复/取消                                    | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F44 发件人采用交付、整组释放门槛、来源会话绑定                          | C/W/T      | 完整草拟、私人交付和采用流程保留                       | C10             |
| F45 Project 全局 BYOK 缺失/停用及可操作错误                             | C/W        | 全局 Project BYOK 与错误阻断规则保留                   | C4/C10          |
| F46 独立项目树、文件夹展开、懒加载/分页、路径、当前选中                 | F          | 完整树和分页保留；新增全项目搜索、宽浏览               | C7/C11          |
| F47 新建原生文件、Page、Edgeless、文件夹                                | F          | 原生项目树及管理、导入流程保留                         | C7/C11          |
| F48 多文件上传、拖入文件夹、逐文件进度/错误/重试                        | F          | 原生项目树及管理、导入流程保留                         | C7/C11          |
| F49 单资源重命名、移动、上下排序、拖动换父级                            | F          | 原单项菜单/拖放保留，多选模式提供批量移动              | C7/C11          |
| F50 回收站、恢复、永久删除及确认                                        | F          | 原生项目树及管理、导入流程保留                         | C7/C11          |
| F51 Workspace 导入、来源搜索分页、直接/申请/禁止、状态与重试            | F          | 原生项目树及管理、导入流程保留                         | C7/C11          |
| F52 从树、引用、消息/产物打开同一资源                                   | E/C/F      | 同resourceId打开，session保持；打开与引用仍分开        | C8              |
| F53 面板调宽、编辑区展开、关闭返回、来源/焦点恢复                       | E/C/F      | 编辑区约640px起，展开/关闭/调宽/来源焦点和单主视图     | C8              |
| F54 Page/Edgeless原生编辑、保存同步                                     | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F55 TXT/Markdown/CSV/JSON文本编辑、保存/替换、媒体预览、下载            | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8/C13          |
| F56 DOCX连续编辑、格式、结构、布局、撤销重做、审阅与比较                | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F57 XLSX单元格/公式/范围格式/行列/表/图表/工作表                        | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F58 PPTX形状/文字/图片/页序/备注/主题                                   | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F59 PDF渲染/搜索/批注/表单/页操作/可视签名/永久遮盖                     | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F60 Office修订、评论/回复/协作者、下载/打印、DOCX导出PDF                | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F61 普通资源历史、历史只读、恢复版本、复制版本                          | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F62 保存中/已保存/未保存/冲突、远端更新、离开保护                       | E/C/F      | 统一离开保护；普通文件同步dirty getter修复保存返回竞态 | C8              |
| F63 每标签页编辑租约、他人占用、续租/失效/只读、编辑结束通知            | E/C/F      | 原生表面、历史、保存和租约能力完整保留                 | C8              |
| F64 从来源刷新、具体来源选择与覆盖确认                                  | E/X        | 显式来源更新和发布流程保留                             | C11             |
| F65 发布/更新Workspace、选目标、预览差异/受众、确认/取消/重开、执行结果 | E/X        | 原发布全流程保留，项目发布历史明确范围，缺名不露ID     | C11             |
| F66 加载/空/无权限/不可用/失败、重复提交与友好提示                      | 各对象区域 | 各异步状态保留并增强失败/未知提示                      | C1—C11          |
| F67 文件管理多选；批量移动/删除的具体交互                               | F          | 本轮补齐管理多选和批量移动/回收；部分失败可恢复        | C7              |
| F68 人工编辑向AI写入交接、先保存再审阅、审批未知结果恢复                | E/C/T      | 原编辑→AI交接流程保留，统一guard可被调用               | C8/C5           |

代码组的路径均在 `packages/frontend/core/src/desktop/pages/intelligence/`（另有明确路径时除外）：

| 证据组 | 实现与聚焦验证入口                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1     | index.tsx / index.css.ts / index.spec.tsx；既有原生标题栏                                                                                           |
| C2     | project-tree.tsx / CSS / project-tree.spec.tsx；创建、归档和会话管理回调                                                                            |
| C3     | conversation-board / use-conversation-cards及测试；backend/server/src/models/copilot-work-order.ts；project-workbench-v9.e2e.ts                     |
| C4     | workbench-conversation；core/src/blocksuite/ai/runtime/chat/runtime.ts / state.ts / runtime.spec.ts；new-conversation及IME测试                      |
| C5     | task-panel、workbench-task-action、use-project-task-decision及测试；既有任务完整页                                                                  |
| C6     | collaboration-orbit-board/model/orders/motion/camera及相关测试，内部实现无diff                                                                      |
| C7     | project-files / project-resource-search / project-resource-icon及测试；project-files-data、upload-queue与import原入口                               |
| C8     | project-resource-preview、project-document/file/office；modules/project-resources/edit-guard/edit-lease/task-handoff及测试；原OfficeResourceSurface |
| C9     | project-shell-settings / project-shell-settings.spec.tsx、project-collaboration、project-summary；新增GraphQL undo-project-context-memory-event.gql |
| C10    | work-order-conversation/panel、work-order-delivery与generation-status测试；既有私人文件输入和确认卡；服务端完整工单e2e                              |
| C11    | project-publications、project-source-refresh、project-workspace-import及测试；各自既有GraphQL/领域服务                                              |
| C12    | tools/cli/src/rspack/di-minimizer-options.ts / spec；共用生产压缩配置保留扩展工厂类名，避免页面树扩展注册失败导致编辑器无法启动                     |
| C13    | backend/server/src/base/cors.ts、src/**tests**/core/cors.spec.ts；Project修订头对既有允许来源可读，未授权来源仍不放行                               |

## 3. 真实展示与数据口径

M01—M30 的详细业务映射以原方案第5节为准；本轮逐项落实如下。

| 映射                     | 实际区域 | 实施口径                                                           |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| M01 项目标题/列表        | H/N      | 授权项目查询；不增加虚构项目                                       |
| M02 导航会话标题/标记    | N/C      | 本人会话标题、pinned、titleRevision；长名可读                      |
| M03 三列数字             | O        | DB过滤后列总量，actor/未删/有效成员/项目或工单范围同列表           |
| M04 卡片任务类型/来源    | O/C/W    | 真实scopeType与来源；保留各自导航                                  |
| M05 需要你处理           | O→C/T    | attention业务字典；打开原对象，不猜批准                            |
| M06 进行中/等待他人      | O/C/T/W  | 会话column、工单角色状态、任务等待状态分别显示                     |
| M07 AI执行中数量         | O/C/T    | 沿用activeRunCount口径，未解释为计算百分比                         |
| M08 最近时间             | O/W/E/T  | 使用lastBusinessAt及各对象真实时间                                 |
| M09 完成度/四段进度条    | 不新增   | 无统一完成比；使用真实业务阶段/步骤                                |
| M10 “已读12份/节省8分钟” | 不新增   | 无可信读取量/节省时间口径，按方案不采用                            |
| M11 项目成员头像         | H/P      | 成员按钮取当前授权members.length；完整成员列表和角色仍可达         |
| M12 工单参与者           | X/G/W    | 工单双方来自同一graph/工单事实；接单人→发单人                      |
| M13 AI头像/执行者        | C/T      | 沿用助手和实际run授权/执行信息，不把助手当项目成员                 |
| M14 引用来源列表         | X/C      | runtime ProjectChatContext doc项；冻结/最新序号、可用性、显式刷新  |
| M15 私人附件             | X/C      | runtime private blob项；name/byteSize，独立私人说明                |
| M16 “全部文件”与数量     | F        | 完整项目资源树/服务器搜索分页，无假“所有文件总数”                  |
| M17 文件类型与大小       | F/X/E    | 真实kind类型图标；私人附件真实字节，未知大小明确说明；原生头部保留 |
| M18 AI产出               | C/T/W/E  | 继续真实资源和工单正式文件入口，未新增统一产物统计                 |
| M19 执行记录             | C/T      | 原run/step/timeline/失败与审批详情                                 |
| M20 待交付数量           | O/W      | 真实必填缺项提示；不当作交付成功判断                               |
| M21 工单进度             | W/X/G    | 工单status经现有双角色字典；不伪装为会话或AI进度                   |
| M22 确认成果/采用        | W/C/T    | 收件人确认和发件人采用原流程保留，发布独立                         |
| M23 交付历史             | W/C      | 不可变回执及revision原历史；不使用暂存代替                         |
| M24 图中方向与数字       | G/X      | 原图方向/数量口径；上下文交付方向修正，truncated提示               |
| M25 共享记忆/项目摘要    | P/H/X    | 项目共享事实与摘要原查询；新增有界贡献事件和canUndo操作            |
| M26 整理提示             | C        | 原私人会话整理状态组件与持久任务                                   |
| M27 保存/只读/占用       | E        | 真实资源状态、编辑资格、租约；统一离开确认，保留同步dirty状态      |
| M28 发布到Workspace      | E/X      | 真实目标Workspace/版本/受众和独立副本流程；名称缺失不露ID          |
| M29 通知/任务角标        | H/T      | 沿用真实通知与任务集合；不混算成会话总览数字                       |
| M30 导入/来源更新        | F/E      | 来源许可、复制申请、导入进度和明确版本更新原流程                   |

加载、确实为空、权限/资源不可用和加载失败保持不同表现。总览数量在加载中显示“—”，
不使用已加载卡片数冒充总量；分页失败保留可显示内容并给重试。搜索失败不显示“无匹配”。
引用 available 布尔无法安全区分删除/失权/版本回收时采用通用不可用说明，不猜原因。

## 4. 缺口与取舍

| 编号 | 本轮处理                                           | 实际边界                                                                                                    |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| G01  | 已修复服务端筛选、列内分页、计数和前端续页         | 不按已加载页计算总数；拒绝范围错配的游标                                                                    |
| G02  | 已增加业务字典和未知态兜底                         | 不改写历史 AI 自然语言回答或审计原文                                                                        |
| G03  | 已修正上下文交付方向                               | 星图内部契约保持原实现                                                                                      |
| G04  | 已接完整上下文投影、私人附件、版本和截断提示       | 细分拒绝 reasonCode 仍无接口；不据布尔值推断具体原因                                                        |
| G05  | 已实现项目资源搜索、多选、批量移动/回收            | 批量操作逐资源授权/CAS，非整批事务；结果明示部分失败                                                        |
| G06  | 按方案采用现有类型专属真实产物入口                 | 未增加统一 AI 产物列表或总数。未来统一投影需 ownerType、所属域、资源/回执 ID、修订、run/step 来源和授权动作 |
| G07  | 采用打开会话/查看任务的真实路径                    | 卡接口尚不含动作对象 ID/版本/availableActions，不增加卡片内猜测的批准按钮                                   |
| G08  | 不采用装饰百分比、已读数和节省时间                 | 没有可信统计口径，保留业务状态和证据                                                                        |
| G09  | 已提升编辑宽度、收导航、主视图切换                 | 600px/820px/1280px 实测；其他 Office 类型沿用完整原生表面                                                   |
| G10  | 已接 canUndo 贡献历史和确认撤销                    | 生产迁移、长期归档及完整 A01—A40 独立验收仍不属于页面融合                                                   |
| G11  | 已更新导航文档及当前状态，保留历史盘点             | 旧 Electron-only/Circuit 方案不作为本次范围；没有启动旧 Goal                                                |
| G12  | 已移除发布记录中名称缺失时的裸 ID 回退             | 通用不可用说明；不扩大可披露数据，不跳过目标 ACL                                                            |
| G13  | 实施基于依赖任务完成后的源码及 bind mount 本地环境 | 参考文件像素比对未验；Electron 本地登录后已实测会话、文件保存返回、引用、历史只读、私人工单及窄窗，见第6节  |
| G14  | 已沿用 b0dc17d9b4 的输入、工单、Office 和树改动    | 不覆盖依赖任务的提交，不改变独立关系图                                                                      |

## 5. 场景验收

| 场景                       | 证据与结果                                                                                                                                                | 本轮验证界限                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| V01 找项目并继续原会话     | 本地总览选项目后进入既有会话；导航、固定/改名/深链/壳相关测试通过                                                                                         | 未在日常库归档或变更成员；原流程保留                          |
| V02 待处理与对应动作       | 本地卡片有真实缺项；任务抽屉区分需要我处理/等待其他人；服务端筛选先于分页，游标错域/权限撤销验证通过                                                      | 未在日常库批准或取消既有任务                                  |
| V03 查找、引用、编辑再返回 | 搜索 A.docx 打开约640px编辑面板；创建专用 TXT 验收资源，取消保留草稿，保存后一次返回原会话，重开同 ID 内容完整；显式引用显示 v3                           | 没有修改已有项目文件。验收引用已移除；保留专用 TXT 样本供查看 |
| V04 长会话和上下文         | 长历史消息、原输入区、当前引用/附件/version 投影测试；真实引用选择/移除往返                                                                               | 未向模型发送验收消息；IME/重试由既有和修复后的聚焦测试覆盖    |
| V05 AI失败/审批/产物       | 本地失败详情与等待编辑权状态可达；任务动作、交接及私人工单文件生成/验证/失败/取消测试通过                                                                 | 不声称实测所有真实 provider；运行状态和产物沿用原入口         |
| V06 协作星图               | 现有星图仍接入；图/相机/胶囊/方向/权限测试通过                                                                                                            | 本轮没有改图内部布局，也没有发送演示工单                      |
| V07 私人工单边界           | 600px 长标题工单切“要求与交付”，冻结要求、缺文字/文件、检查和沟通入口完整；隔离服务端覆盖交付确认、不可变回执、整组采用和拒绝                             | 没有对日常工单上传、发送、确认或拒绝                          |
| V08 大量文件/空数据        | 分页、搜索错误/空态、多选父子去重、部分失败/幂等重试测试；服务端1000历史会话和500关系边的有界投影测试                                                     | 未向日常库造大量样本；不把截断视图当全量                      |
| V09 权限/只读/跨域         | 服务端撤成员后列表/计数清空，前端失效筛选重置且屏蔽旧项目卡片；私人工单来源权限检查；前端导入/发布/租约/审批/记忆撤销失败测试通过                         | 未人工撤销日常成员、公开资源或跑生产记忆迁移                  |
| V10 长标题/窄窗/两端       | Web 1280×720、820×900、600×800；分类切换、键盘箭头、编辑优先、长工单和深色引用面板实测；Electron已登录实测约820px/640px及宽屏的文件、工单、导航和分类入口 | 未声称150%缩放和全类型人工验收                                |

本机截图位于 `.codex-artifacts/project-fusion/screenshots/`：
01总览、02会话上下文、03桌面DOCX、04窄窗DOCX、05窄窗会话、06保存重开TXT、
07深色上下文、08私人工单要求、09失败任务详情、10窄窗总览、11协作星图、12最终总览、
13原生生产包文档编辑器恢复、14原生820px布局（登录提示修复前，不能作为真实空数据证据）、
15/16本地登录框恢复、17原生未保存保护、18原生引用v2、19原生820px私人工单、
20原生失败执行详情、21原生820px保存重开TXT、22最终包登录框、
23 Web640px资源标题、24最终包原生640px资源标题与正文。
截图中的人员、数量和文档来自本地授权样本，不是新界面默认数据。

## 6. 验证命令与环境

Linux 验证复用 `localmind_hot_web` 的 `localmind-affine:dev-base` 和现有 Node 22/Yarn4
运行环境；源码 bind mount，变更自动进入开发页面与后端。没有执行 runtime sync
脚本或构建 `localmind-affine:local` 镜像，也没有更新业务部署。

- GraphQL：容器中 `yarn build`（`packages/common/graphql`）生成 schema/client；
  i18n：同命令在 `packages/frontend/i18n` 生成；`yarn tsc -b packages/common/graphql
packages/frontend/i18n --pretty false` 生成引用声明。
- 前端：`yarn vitest run --maxWorkers=3 packages/frontend/core/src/desktop/pages/intelligence
packages/frontend/core/src/modules/project-resources/edit-guard.spec.tsx
packages/frontend/core/src/modules/project-resources/edit-lease.spec.tsx
packages/frontend/core/src/modules/project-resources/task-handoff.spec.ts
packages/frontend/core/src/blocksuite/ai/runtime/chat/runtime.spec.ts`：36文件、280项全域通过；最终权限/搜索边界补丁聚焦重跑通过，新增3例（合计去重283项）。
  后两组命令为 `yarn vitest run --maxWorkers=2` 加 index/conversation-board/use-conversation-cards
  三个spec（37项），以及 project-resource-search/project-files 两个spec（14项）。
  Electron补验新增未登录展示/分页缓存2例，以及标签标题/账号隔离2例；三组件当前41项通过，
  前端去重合计287项。壳专项最后32项通过。
- 后端：一次性 dev-base 容器在独立数据库 `localmind_project_fusion_20261012` 和专用
  Redis 上执行 `yarn ava --timeout=3m src/__tests__/copilot/project-workbench-v9.e2e.ts`：
  28项通过。该独立数据库已应用全部当前迁移；日常业务数据库未被测试 fixture 清空。
  另在现有容器运行 `yarn ava src/__tests__/core/cors.spec.ts`：2项通过；该文件无需数据库，
  验证桌面来源可读修订头及未授权来源不放行。先执行回归得到修复前失败，再补入响应头后通过。
- 改动文件 TypeScript：基于各 package 正式 tsconfig/project references 检查全部改动文件，
  前端34文件、后端3文件通过；不是全仓 `yarn typecheck`。
- 官方后端专项检查：`node scripts/typecheck-copilot-tests.mjs --file
src/__tests__/copilot/project-workbench-v9.e2e.ts`：通过。一次全量专项检查
  已停止并改用此聚焦模式，不声称全量专项通过。
- `yarn lint:ox <全部改动TS文件>`、`yarn eslint --report-unused-disable-directives-severity=off
<改动非生成TS文件>`、Prettier 和 `git diff --check`：通过（全部改动TS文件oxlint无警告/错误；非生成TS文件及最后补丁eslint通过）。
- 两端构建：容器中 `node tools/cli/src/affine.ts bundle -p @affine/web` 与
  `-p @affine/electron-renderer`；`NODE_ENV=production`、Node heap4GiB，R2/Sentry上传凭据
  置空防止构建发布。两端最终源码构建通过。各有2条资源/入口体积警告，不作为运行行为验收。

本机执行日志在 `.codex-artifacts/project-fusion/`。初次失败分别为隔离 fixture 的
完成状态约束/最后Owner保护、旧测试的输入与重命名查询假设、旧IME辅助函数 mock 缺失；
已修正测试并重跑。真实保存返回竞态在产品代码修复，不能用改断言掩盖。

重型验证未重建镜像；`docker system df` 显示镜像18.64GB、volume17.09GB、缓存6.414GB。
只创建本轮隔离测试数据库和Redis；专用Redis已清理，数据库保留用于复核。
未删除持久化volume或其他项目服务。

### 6.1 解锁后的 Electron 补验

用户已回复“已解锁”，原生应用读取成功。没有使用9月30日的旧桌面包代替本轮验证。
使用宿主 Node22.23.0 执行官方 `scripts/build-layers.ts`，renderer 在既有 Linux
容器中通过官方 bundle 命令重建；两者均设置 `BUILD_TYPE=internal` 和
`LOCALMIND_CLOUD_URL=http://localhost:3011`。通过 Electron Forge 官方 package API
生成独立验收包，不覆盖原 stable 包或其用户配置，也没有生成发布用 DMG/ZIP。

补验发现生产压缩会把 `return class PageTreeInteractions` 的类名消除，导致
BlockSuite DI 报 `Input is not a service identifier`，继而文档编辑器无法初始化。
新增真实 Rspack 生产压缩回归测试：修复前失败（构造器名为空），修复后通过；
压缩与混淆两阶段均保留类名。配置由主前端、worker 和原生入口共用。
不通过关闭压缩或绕过 DI 来掩盖错误。
修复包在真实 Electron 原生窗口中已成功显示 Demo 文档正文，原错误消失，
对应截图13。原生缩窄到约820px后，分类切换出现且导航可收起；原生窗口缩放回宽屏
后三列与常驻项目导航恢复。这些布局检查在未登录配置中进行，不替代已登录业务流程。

同时补齐未登录语义：GraphQL明确返回 `currentUser: null` 时提供登录入口并清空旧分页；
新增回归验证登录态恢复后不复用旧私人分页。与壳/分页/桌面依赖相关的最终聚焦组为
5文件42项通过，最后的分页缓存补丁6项再次通过；其中3项属于构建工具测试。
原生标签页接入既有 ViewTitle/ViewIcon，避免保留上一文档名；Project 的独立 SWR 缓存
按服务器/账号隔离，身份变化重建会话视图。新增真实缓存标记与会话生命周期回归，验证
同一账号不重建，换账号或退出后不复用原缓存。最终壳专项32项通过；上述5文件当前合计44项，
分别经聚焦命令验证（前端41项，构建工具3项）。

- `yarn vitest run --maxWorkers=1 tools/cli/src/rspack/di-minimizer-options.spec.ts
tools/cli/src/rspack/desktop-context-aliases.spec.ts`：2文件、3项通过。
- CLI改动3文件 TypeScript 与 oxlint通过；最终两端生产 bundle 重建通过，
  仍为既有2条资源/入口体积警告。
- 登录提示改动6文件 TypeScript、ESLint通过；最后的分页缓存补丁2文件再次完成
  TypeScript检查；合并改动9文件oxlint无警告/错误。两端最终 sourcemap 中的分页源码
  与当前文件完全一致，避免把修复前的产物用于最终交付。
- 用户已在 `native-verified/` 包完成本地登录。实际账号的项目「1」
  （`4776a1ea-2df9-4e30-8498-25f82b58e029`）与Web验收账号的同名项目属于不同资源域，
  没有用同名项目或工单来源名称推断成员权限。实测进入原会话
  `b579b7b6-2c24-4946-88dc-b01e166217da`，原历史、私人草稿和输入区保留。
- 原生补验发现文件响应已有 `x-project-content-version`，但既有CORS未向桌面来源暴露，
  导致空TXT只能显示空正文，替换/保存无法操作。仅把修订头加入现有可读头列表，
  不改允许来源或资源授权。容器2项HTTP回归先失败再通过；未授权来源仍没有允许/暴露头。
  本地热加载后端已生效，Electron实际输入、保存和重开验证通过。
- 在该账号自己的Project新建专用TXT：取消关闭后正文草稿完整；再次关闭并选择保存，
  一次返回原session；项目搜索重开同resourceId，正文和真实v2完整。历史v2预览正文只读、
  保存/替换禁用。显式引用显示「Pinned to v2」，再移除验收引用，恢复原会话空引用范围。
  只有专用验收资源被创建/编辑，没有发送AI消息、发送工单或采用/批准历史产物。
- 原生约820px窗口的项目导航抽屉、待处理/进行中/完成分类均可达；个人工单
  `a6bd0bcb-45bc-4f04-a240-36354ebb4981`进入独立私人对话，冻结v1要求、缺文字提示、
  草稿检查与沟通入口保留。任务抽屉可进入真实失败run `cc25b701-1d3b-4beb-a9b7-de3eaff6d105`，
  不把历史AI声称已生成PPT当成成功产物；沿用既有任务页的Approval分类路径，不据该筛选推断
  run正在等待批准。关系图显示当前账号真实的对我交付12/由我交付1方向。
- 原生约640px文件标题曾被操作挤成窄列；新增700px以内编辑容器的标题独占行，操作保持直接可见。
  Web640×800复核通过，见截图23。最后4文件的ESLint、oxlint、Prettier通过；
  前/后端各2文件TypeScript检查通过。两端最终Linux生产bundle通过，仍为各2条体积警告。
- 最终包：`.codex-artifacts/project-fusion/native-final/LocalMind-internal-darwin-arm64/LocalMind-internal.app`。
  官方Forge generate-assets随后在Node22宿主生成并移动renderer至web-static，官方package完成。
  `verify-native-package.cjs`逐字节对比当前web-static与ASAR：1231文件、94,394,548字节一致；
  当前main/preload/helper及Darwin addon也一致，来源hash在 `electron-native-package-verification.json`。
  原生进程路径已确认。切换最终包后本地登录态没有恢复，用户再次完成本地登录。
  最终包约640px原生复核通过：标题完整独占行，操作直接可见；同resourceId的正文完整、
  编辑资格正常，关闭后一次返回原session。截图24来自最终包，未用Web截图代替原生复核。
  窗口已恢复宽屏，保持登录和原会话。切换包后登录态未恢复的原因尚未确认，
  不声称本轮证明了重启保持登录；未读取/复制浏览器凭据、修改密码或扩大账号权限。

本次补验仍未重建 Docker 镜像；磁盘证据更新为镜像18.65GB、volume16.91GB、
构建缓存6.414GB。没有修改生产部署、稳定版安装或现有稳定版账号配置。

## 7. 交付状态与保留事项

融合代码覆盖全部 F01—F68 落点，M01—M30 每项均有数据依据或明确不采用的理由。
统一产物列表与总览卡片内直接审批按推荐保留真实专属入口，没有补虚构协议或装饰数据。
已完成共享布局实施及Web/Electron关键业务闭环验收。全类型Office逐项人工验收、150%缩放、
生产记忆迁移/归档、参考像素比对和原生重启保持登录仍未完成，不扩大本轮通过声明。

本轮未 commit、push、创建PR或发布。与前一页面树任务的授权分开处理。
两个不同账号的同名项目「1」分别保留专用验收文件：Web为 `融合布局验收-20261012.txt`
（resourceId：`e3899bbc-d46b-4653-9b2c-69e80efbed7e`）；Electron为
`Electron融合验收-20261012.txt`（resourceId：`bc1d78c2-82c6-4429-a625-88cabc9cadb4`）。
均只含验收文字，未发布到Workspace。
原会话引用范围和主题已恢复；没有发送 AI 消息或通知给其他人。

## 8. 条目／关系切换位置修复（2026-10-12）

用户反馈两种视图的切换按钮发生位移。本地907px窗口实测旧布局切换时横移84.5px、
纵移12px：两种内容壳的宽度、顶部间距不同，且关系项目的长选项撑宽原生筛选框。

仅调整 `conversation-board.tsx` 和 `conversation-board.css.ts` 的共用布局：工具栏移到
内容滚动区外；辅助操作、切换按钮、项目筛选使用独立网格列；项目筛选列固定272px，
其中选择框240px，选中名称保留title。内容区宽度不影响工具栏位置。可用宽度680px以内，
切换保持第一行右侧，筛选位于第二行；关系图与条目原有业务、权限和筛选来源保持原样。

本地Web实际验证：

| 视口   | 条目按钮坐标 | 关系按钮坐标 | 切换结果                     |
| ------ | ------------ | ------------ | ---------------------------- |
| 907px  | (491, 88)    | (545, 88)    | 两种视图完全一致             |
| 1440px | (1024, 88)   | (1078, 88)   | 两种视图、展开工作区完全一致 |
| 640px  | (516, 80)    | (570, 80)    | 两种视图、内容滚动后完全一致 |

两按钮均为52×30.5px；筛选选项从3项变为15项时不改变宽度。
截图与坐标记录在 `.codex-artifacts/project-tabs-stability-20261012/`。
已恢复浏览器原始窗口尺寸、全部项目筛选和关系视图，没有修改业务数据。

复用 `localmind_hot_web`（`localmind-affine:dev-base`）进行聚焦验证：

- `docker exec localmind_hot_web yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/conversation-board.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/index.spec.tsx`：35项通过。
- 两处源码的容器oxlint、聚焦TypeScript，以及Prettier、`git diff --check`通过。
- 容器直接ESLint达到默认Node堆上限；改用仓库规定的 `NODE_OPTIONS=--max-old-space-size=16384 yarn eslint` 在宿主执行同两文件检查通过。

本次未重建Docker镜像，也未重新打包或切换Electron应用。Electron共用源码已包含修复，
现有原生安装包仍为上一轮产物，本节不声称已完成更新后的原生窗口验收。

## 9. 条目／关系切换位置回归修复（2026-10-14）

当前工作区的样式迭代再次出现按钮位移：关系视图才显示展开操作，切回条目时会自动
恢复侧栏，长项目选项会撑宽筛选框，两种内容壳的宽度及滚动也会影响工具栏。

本轮调整 `conversation-board.tsx`、`conversation-board.css.ts`：两种视图共用独立于
内容滚动区的工具栏及相同宽度，展开操作始终可用，项目筛选固定180px；切换视图保留
当前侧栏状态。`index.spec.tsx` 补充跨视图保留展开状态、显式恢复导航及保存宽度的验证。
本节记录当前实现，第8节保留当时的布局及验收历史。

在 `http://localhost:3011/project` 实测，两种视图中按钮坐标完全相同：

| 视口      | 条目按钮坐标 | 关系按钮坐标 | 切换位移 |
| --------- | ------------ | ------------ | -------- |
| 390×844   | (213, 113)   | (291, 113)   | 0px      |
| 812×900   | (611, 121)   | (689, 121)   | 0px      |
| 1280×900  | (891, 89)    | (969, 89)    | 0px      |
| 1800×1000 | (1315.5, 89) | (1393.5, 89) | 0px      |

按钮均为74×34px。812px展开工作区后切换仍保持同位，内容滚动不带动工具栏。
截图和坐标记录在 `.codex-artifacts/project-tabs-stability-20261014/`。
浏览器已恢复原始窗口尺寸及项目导航，保持全部项目筛选，未修改业务数据。

验证命令与结果：

- `docker exec -w /workspace localmind_report_validation yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/conversation-board.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/index.spec.tsx --maxWorkers=1`：2文件、38项通过。
- `yarn lint:ox` 检查上述3处源码、`yarn prettier --ignore-unknown --check` 检查改动源码及本文档、`git diff --check`：通过。

复用 `localmind-affine:dev-base` 容器，未重建镜像；本地 `localmind_hot_web` 通过源码
热更新生效，未重启服务或运行同步脚本。未执行全仓类型检查，未更新Electron安装包或
生产环境，本轮结论限于聚焦测试和Web交互验证。

## 10. 会话消息左右分侧与限宽（2026-10-15）

按用户确认的方案调整项目会话：用户消息和头像靠右，短消息随内容收缩，正文仍左对齐；
AI消息和头像靠左。消息区域和输入区域最大960px，用户气泡最大560px，AI正文最大760px，
含头像的消息行分别不超过可用宽度的70%和85%。窄聊天面板放宽至90%和95%，消息间隔24px，
头像28px。按用户后续反馈，用户消息与AI正文均使用白底（深色主题沿用对应表面色）；
宽内容在AI气泡内部横向滚动。

修改集中于 `workbench-conversation.css.ts`，并在 `workbench-conversation.tsx` 移除多余的
AI名称变量，避免已有头像组件的名称被重复绘制。只读富文本预览取消内部尺寸隔离，
让正文参与气泡的内容宽度计算；没有改变编辑器正文、消息内容或数据模型。

本地真实会话验证覆盖1407×902、812×900和390×844视口。宽屏消息区域960px，
“你好”气泡64px，AI长回复正文760px；窄屏消息仍分居两侧，页面没有水平溢出。
截图及几何记录保存于 `.codex-artifacts/project-chat-layout-20261015/`。

验证：

- `docker exec -w /workspace localmind_report_validation yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/index.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/work-order-delivery.spec.tsx --maxWorkers=1`：2文件、41项通过。
- 两处源码的 `yarn lint:ox`、改动源码和文档的Prettier检查，以及 `git diff --check`通过。
- 复用 `localmind-affine:dev-base` 容器及当前源码热更新，未重建镜像，未重启业务服务。

未发送验收消息或修改历史内容，未执行全仓类型检查，未重新打包Electron或更新生产环境。
浏览器验证证明当前会话的短用户消息、长AI回复及现有工具结果布局；没有对所有富文本
块、全部附件类型或真实生成中的动画逐项验收。

## 项目文档导航修复（2026-10-15）

用户指出系统栏的文档按钮错误进入 Workspace 文档。此次修复遵循
`tracks/project-workbench-redesign.md` 与 `tracks/project-native-resources.md`：

- 系统栏文档入口更名为“项目文档”，与项目协作台分别标记选中状态。
- `/project?view=files` 展示当前用户可访问的活动项目；已选择项目时直接进入
  `/project/:projectId?view=files`，复用原生项目文件树与编辑器。
- 项目切换、文件打开、文件夹导航、关闭与深链返回保留文件视图；离开编辑器仍检查
  未保存内容。没有 Workspace 也可进入；不改变资源归属、权限、存储或后端协议。
- 修改集中于 `system-rail.tsx`、`project-documents-index.tsx`、`index.tsx`、
  `desktop/route-paths.ts`、对应测试及中英文翻译；i18n 生成文件由既有命令更新。

验证：

```sh
docker exec -w /workspace localmind_report_validation yarn vitest run packages/frontend/core/src/desktop/pages/intelligence/system-rail.spec.tsx packages/frontend/core/src/desktop/pages/intelligence/index.spec.tsx
docker exec -w /workspace localmind_report_validation yarn workspace @affine/i18n build
```

- 2 个测试文件、43 项测试通过，退出码 0；覆盖入口分离、当前项目、无 Workspace、
  打开/关闭、未保存拦截、加载、错误重试、空项目和归档过滤。测试结束有 fork worker
  终止超时提示，断言通过；不将该提示视作额外行为验收。
- 变更文件 Oxlint、聚焦 ESLint、Prettier、`git diff --check` 通过；
  Impeccable 检测无发现。本轮未运行全仓类型检查。
- 浏览器在 `localhost:3011` 实测协作台与文档入口不同、项目选择、真实 TXT 文件打开
  和关闭返回；1407×902 与 740×900 视口确认列表可见。复用现有主题 token，未单独切换深色。
- 浏览器证据：`.codex-artifacts/project-documents-navigation/desktop.jpg` 与 `narrow.jpg`。
  本地源码挂载实例热更新生效；GraphQL `{ __typename }` 返回 `Query`。
- 复用 `localmind_report_validation`（`localmind-affine:dev-base`）和既有热启动实例；
  未重建镜像、未运行部署同步、未改业务数据、未发布生产或提交 Git。
