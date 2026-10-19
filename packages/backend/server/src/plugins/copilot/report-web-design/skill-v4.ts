import { createHash } from 'node:crypto';

/**
 * Versioned design knowledge for the v4 web-report engine, adapted from the
 * pinned huashu-design references (see manifest.json) and LocalMind review
 * findings. Each fragment is injected only into the stages that use it; rules
 * that can be checked mechanically live in validators, not here.
 */
export const REPORT_WEB_SKILL_V4 = {
  version: '2.0.0',
  upstreamCommit: '798c4235ebff03d5c45e3c8affdf5e9d18f9dfa7',
} as const;

const NARRATIVE = `【叙事】
先找出读者合上页面后应记住的一句话（thesis），它必须由 headline/key 事实直接支撑。
再决定证据出场顺序：钩子（最反常识或最重要的结论）→ 证据（让结论可信）→ 对照/过程（解释为什么）→ 风险或待决 → 收束到可执行的下一步。
章节是“读者的一次理解”，不是“资料的一段”。一条事实撑不起一章：把它并入相关章节作为旁证、注释或对照。材料少时，3–4 章往往比 8 章更有力量。
标题写结论而不是主题（“三季度营收回到增长”优于“营收情况”）。同一句话全篇只出现一次；开场与结尾不重复同一摘要。
声明、免责、数据来源说明属于 context：放进页脚小字或省略，不进入首屏主体，不在每张图下重复“图形不代表……”。只在确有误读风险的地方写一句精确的口径说明。`;

const ARCHETYPES = `【方向原型（全篇）】按内容特征选择，不按习惯：
- data-poster：数字少而关键。超大数字或单一图形占据画面，文字极少。
- editorial-spread：论证与观点为主。杂志跨页，长标题、引文、旁注、图文交错。
- control-room：多指标状态。密集而有秩序的网格，状态色语义，小倍数图。
- dossier：调查/复盘。档案编号感、时间戳、证据卡与批注、纸面质感的色彩。
- route-map：流程、迁移、路线。路径/节点贯穿全篇，章节是路线上的站点。
- long-scroll：时间线或演进。纵向长卷，滚动驱动揭示，年份/阶段作锚点。
- lab-comparison：方案对比、A/B。左右对照、共同基线、差异高亮。
- whitepaper：正式、客户或管理层。克制的网格、清晰层级、精准的表格与图注。
- manifesto：愿景、动员。超大宣言式排版，强烈明暗，少量证据作锚。
- field-notes：调研、一线观察。手记式节奏，引语、短段、小图注。
用户给了色彩/品牌/语气要求时，在原型内服从；没有要求时不要默认“深色封面+大号衬线+橙色大数字”。

【章节构图原型】poster-statement（宣言/大字）、figure-dominant（图占主体）、split-evidence（结论与证据左右分）、comparison（并列对照）、sequence-rail（步骤轨道）、timeline（时间轴）、matrix（矩阵/象限）、annotated-figure（图+指向性批注）、ledger（账目/清单/表）、pull-quote（引语）、scrolly-figure（粘性图形+文字推进）、action-close（行动收束）。
相邻章节换原型；同一原型不超过全篇 40%。明暗面（canvas/alt/accent）形成节奏，但每次切换都要有理由。`;

const TYPOGRAPHY = `【中文排版】
角色先于字号：展示标题（结论）/章节标题/正文/数据/标签/图注，每个角色用 token 固定字体、字号、字重与行高，不靠逐处放大制造层级。
展示标题 1–2 行，按语义断行（可用 <br> 或分 span），避免单字孤行；正文行长约 22–34 个汉字（--rd-measure），行高 1.6–1.85。
数字用 tabular-nums；数字与单位放进同一个 <span class="rd-nb">，不被拆行。中英混排时英文与数字两侧不加多余空格以外的装饰。
强调要有选择：一屏最多一处强调色文字；不要整段加粗、不要渐变字。
手机不是缩小版：重新排序（先结论后证据），标题按 --rd-size-* 收敛，多栏改单栏或横向可滑动的局部容器，图表使用紧凑版本。
字体只用 token：--rd-font-display / --rd-font-body / --rd-font-numeral（外壳已经为 macOS、Windows、Linux 准备回退），不要写具体字体名。`;

const DATAVIZ = `【图表与信息表达】
先写出“读者应一眼看出的比较”（takeaway），再选编码：
- 随时间变化 → line（≥3 点）或 column；类别比较 → bar（排序）或 dot；部分与整体 → stack；有限计数/状态 → unit；两个时间点的对照 → column 并高亮。
- 高亮 1–2 个真正要看的项，其余退为弱色；直接标注数值，少用图例。
- 图表由应用根据数据集渲染（刻度、数值、比例都来自数据），你只选择编码、排序、高亮、标注与周围的叙述；在 <figure data-rd-chart> 里写 figcaption 说明结论与口径。
- 需要差值、增长率、占比时在计划里申请 derivations，由应用计算并给出公式；正文用 data-rd-fact="derived:ID" 绑定。不要自己算，也不要写出没有出处的百分比。
- 没有数值时用结构表达关系：流程（sequence-rail）、时间轴、矩阵、因果链、并列对照、带编号的证据清单；关系必须来自 relations 或事实原文。
- 一个数据集在全篇通常只画一次；KPI 不在每章重复。数字块只在“一个数字就是结论”时使用。`;

const MOTION = `【动态设计】
动效回答三个问题：先看哪里、哪个比较在发生、读到哪了。
- 开场：标题先立住（rise/mask-up，base 时长），关键数字或图形随后（count/grow/draw，long 时长），说明最后（fade，short）。不要所有元素同时出现。
- 数据章：先出现基线或坐标，再让数据生长/描线，最后出现高亮标注——运动本身表达比较。
- 过程/时间线：按顺序逐步揭示（data-rd-seq 递增），节奏统一。
- 论证章：主张 → 证据逐条推进，或使用 scrolly-figure 让图形随阅读改变状态。
- 演示模式：用 data-rd-step 把“结论 → 证据 → 含义”分 1–3 步呈现。
- 全篇有统一的运动性格（personality/easing/时长三档），但各章入场方式随内容变化；装饰不动，循环动画不用。
- 动效永远是增强层：无脚本、减少动态效果、打印时内容完整可见；不能依赖动画才能理解。`;

const INTERACTION = `【交互】
只在能帮助理解时加，全篇 1–4 处通常足够：
- switch：同一问题的两种视角（绝对值/增幅、方案 A/B、按部门/按时间）。每个视图有自己的标题，默认视图已经给出结论。
- linked：图例/清单与图形联动，突出一条路径、一组状态或一个对象。图表的数据项已经带 data-rd-key（等于行标签），你的列表项用相同的 key 即可联动。
- scrolly：一张图随文字推进改变状态（宽屏粘性，手机自动堆叠）。
- disclosure：可选的补充证据或方法说明（details/summary），不要把结论藏进去。
交互要可发现：在控件附近用一句短提示说明能做什么；键盘、触屏和鼠标等价（运行时会处理焦点与按键）。不要做只有外观没有行为的“按钮”。`;

const CRITIQUE = `【审查方法】
先看全篇缩略图判断节奏：是否连续两章结构/密度/明暗相同？是否有几乎空白、只有一句话的章节？首屏是否只有一个主角？
再看细节图：信息层级、图表能否读出 takeaway、中文断行、数字与单位、移动端是否重新编排。
问题要转化为“设计动作”（换构图原型、合并章节、换图表编码、调整主角比例、改字阶、增加/删除交互、重排移动端顺序），不要只说“更高级、更有冲击力”。
“像放大字号的文档”“标题+段落+分隔线反复出现”“免责说明挤占主体”“同一句话重复”“只有数字块没有图形关系”都是必须指出的问题。
不要把个人偏好的另一种风格当必改项；已经很好的地方写进 strengths，修正时要保留。`;

const REPAIR = `【修正方法】
结构问题用结构手段解决：合并空章（mergeChapters）、换构图原型（changeLayout）、换图表编码（swapChartMark）、重设动效或交互（setMotion/setInteractions）、改标题与要点（retitle）。
修正后的章节要完整重写 HTML 与 CSS，而不是在旧结构上加 padding、边框或换色。保留 strengths 与事实绑定；不得删除证据、缩小正文、隐藏内容或用 overflow:hidden 掩盖问题。`;

const FRAGMENTS = {
  narrative: NARRATIVE,
  archetypes: ARCHETYPES,
  typography: TYPOGRAPHY,
  dataviz: DATAVIZ,
  motion: MOTION,
  interaction: INTERACTION,
  critique: CRITIQUE,
  repair: REPAIR,
} as const;
export type SkillFragment = keyof typeof FRAGMENTS;

export const skillFragment = (name: SkillFragment) => FRAGMENTS[name];
export const REPORT_WEB_SKILL_V4_HASHES = Object.fromEntries(
  Object.entries(FRAGMENTS).map(([name, body]) => [
    name,
    createHash('sha256').update(body).digest('hex'),
  ])
) as Record<SkillFragment, string>;
