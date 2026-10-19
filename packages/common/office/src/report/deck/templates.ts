import type { DeckConfig } from './contracts';
import { deckMotionForTemplate, type DeckMotionStyle } from './motion';
import type { DeckBlock, DeckSpec } from './schema';

/**
 * Template = theme + layout CSS overrides + motion language + sample spec
 * (plan §6.3). The sample feeds gallery covers and previews.
 */
export type DeckTemplateTheme = {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  accent: string;
  accent2: string;
  fontStyle: 'sans' | 'serif';
  /** Inline SVG markup (no external references), drawn behind cover/section/closing slides. */
  decor?: string;
};

export type DeckTemplate = {
  key: string;
  name: string;
  description: string;
  purposes: DeckConfig['purpose'][];
  motion: DeckMotionStyle;
  theme: DeckTemplateTheme;
  /** Template-specific layout CSS appended after the shared layout CSS. */
  css?: string;
  sample: DeckSpec;
};

/* ---------------------------------------------------------------- helpers */

const p = (text: string): DeckBlock => ({ type: 'paragraph', text });
const list = (items: string[], ordered = false): DeckBlock =>
  ordered ? { type: 'list', items, ordered } : { type: 'list', items };
const metric = (
  label: string,
  value: string,
  unit?: string,
  delta?: string,
  trend?: 'up' | 'down' | 'flat'
): DeckBlock => ({
  type: 'metric',
  label,
  value,
  ...(unit ? { unit } : {}),
  ...(delta ? { delta } : {}),
  ...(trend ? { trend } : {}),
});
const callout = (
  tone: 'info' | 'risk' | 'decision',
  text: string
): DeckBlock => ({ type: 'callout', tone, text });
type Entry = {
  date: string;
  title: string;
  detail?: string;
  status?: 'done' | 'active' | 'planned' | 'risk';
};
const timeline = (entries: Entry[]): DeckBlock => ({
  type: 'timeline',
  entries,
});
const chart = (
  chartType: 'bar' | 'line' | 'pie' | 'donut',
  title: string,
  labels: string[],
  series: { label: string; values: number[] }[],
  unit?: string
): DeckBlock => ({
  type: 'chart',
  chartType,
  title,
  labels,
  series,
  ...(unit ? { unit } : {}),
});

const svg = (body: string) =>
  `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

/* ---------------------------------------------------------------- templates */

const periodic: DeckTemplate = {
  key: 'periodic',
  name: '周期进展汇报',
  description: '每周或每个迭代同步团队进展：成果、进度、阻塞与下期计划。',
  purposes: ['periodic', 'progress'],
  motion: deckMotionForTemplate('periodic'),
  theme: {
    background: '#f6f4ef',
    surface: '#fffdf8',
    foreground: '#1b2733',
    muted: '#68717b',
    accent: '#c8862a',
    accent2: '#2f5d7c',
    fontStyle: 'sans',
    decor: svg(
      '<rect class="da" x="1030" y="0" width="250" height="720"/><rect class="da2" x="1030" y="520" width="250" height="200" opacity=".9"/><g class="sfg" stroke-width="1" opacity=".07"><path d="M0 144H1030M0 288H1030M0 432H1030M0 576H1030"/></g><circle class="sa" cx="1030" cy="250" r="132" stroke-width="2" opacity=".55"/><circle class="dfg" cx="1030" cy="250" r="7" opacity=".7"/>'
    ),
  },
  css: `
.slide-head .kicker::before{content:"";display:inline-block;width:28px;height:3px;background:var(--accent);margin-right:12px;vertical-align:middle;border-radius:2px}
.b-metric{border-color:transparent;box-shadow:0 1px 0 rgba(27,39,51,.04),0 18px 40px -26px rgba(27,39,51,.45)}
.compare-card,.b-table{border-color:transparent;box-shadow:0 18px 40px -28px rgba(27,39,51,.45)}
`,
  sample: {
    title: '第 42 周项目进展同步',
    subtitle: 'LocalMind 桌面端 · 研发团队周报',
    period: '2026.10.06 – 10.12',
    slides: [
      {
        layout: 'cover',
        title: '第 42 周项目进展同步',
        kicker: '研发周报',
        blocks: [
          p(
            '整体进度符合预期：离线同步与导出模块按计划推进，1 项跨组依赖需要本周内协调。'
          ),
        ],
      },
      {
        layout: 'metrics',
        title: '本周关键数字',
        kicker: '总体状态',
        blocks: [
          metric('迭代完成率', '92', '%', '较上周 +6pt', 'up'),
          metric('合并 PR', '47', '个', '较上周 +12', 'up'),
          metric('线上缺陷', '3', '个', '较上周 -4', 'down'),
          metric('平均评审时长', '5.2', '小时', '较上周 -1.3h', 'down'),
          callout(
            'info',
            '本周新增 2 名成员加入导出模块，评审效率提升主要来自自动化检查前置。'
          ),
        ],
      },
      {
        layout: 'chart',
        title: '燃尽趋势：实际略慢于计划，周五已追平',
        kicker: '迭代进度',
        blocks: [
          chart(
            'line',
            '剩余故事点',
            ['周一', '周二', '周三', '周四', '周五'],
            [
              { label: '计划', values: [80, 64, 48, 32, 16] },
              { label: '实际', values: [80, 70, 54, 35, 17] },
            ],
            '点'
          ),
          p('周二因接口变更返工 6 个点，周三起通过拆分任务恢复节奏。'),
          callout('decision', '下周维持当前范围，不再追加需求。'),
        ],
      },
      {
        layout: 'timeline',
        title: '各工作流进度',
        kicker: '成员进度',
        blocks: [
          timeline([
            {
              date: '10.06',
              title: '离线同步',
              detail: '冲突合并策略上线灰度',
              status: 'done',
            },
            {
              date: '10.08',
              title: 'PDF 导出',
              detail: '中文字体子集化完成',
              status: 'done',
            },
            {
              date: '10.10',
              title: '模板库',
              detail: '10 套模版联调中',
              status: 'active',
            },
            {
              date: '10.13',
              title: '权限迁移',
              detail: '依赖平台组 API 冻结',
              status: 'risk',
            },
            {
              date: '10.17',
              title: '发布候选',
              detail: 'RC1 打包与回归',
              status: 'planned',
            },
          ]),
        ],
      },
      {
        layout: 'bullets',
        title: '风险与阻塞',
        kicker: '需要支持',
        blocks: [
          list([
            '权限迁移依赖平台组 API 冻结时间，目前尚未确认',
            'Windows 打包签名证书将于 11 月到期，需要提前续期',
            '性能基线测试环境本周两次不可用，影响回归节奏',
          ]),
          callout(
            'risk',
            '请平台组在 10 月 15 日前确认 API 冻结时间（负责人：王磊）。'
          ),
        ],
      },
      {
        layout: 'closing',
        title: '下一期计划',
        kicker: '第 43 周',
        blocks: [
          list(
            [
              '完成模板库全部 10 套模版验收',
              '权限迁移进入联调，周三前给出结论',
              '发布 RC1 并启动全量回归测试',
            ],
            true
          ),
        ],
      },
    ],
  },
};

const management: DeckTemplate = {
  key: 'management',
  name: '管理者决策汇报',
  description: '向管理层要决策：结论先行，只讲偏差、风险和需要拍板的事。',
  purposes: ['decision', 'progress'],
  motion: deckMotionForTemplate('management'),
  theme: {
    background: '#1b2733',
    surface: '#223244',
    foreground: '#f3f5f8',
    muted: '#9fb0c2',
    accent: '#e3b04b',
    accent2: '#7fa7d9',
    fontStyle: 'sans',
    decor: svg(
      '<g class="sa" stroke-width="1.2" opacity=".55"><circle cx="1180" cy="720" r="220"/><circle cx="1180" cy="720" r="320"/><circle cx="1180" cy="720" r="420" opacity=".6"/></g><path class="da" d="M96 640h120v3H96z"/><g class="sfg" stroke-width="1" opacity=".05"><path d="M0 0L1280 720M200 0L1280 610M0 180L960 720"/></g>'
    ),
  },
  css: `
.slide-head{padding-bottom:18px;border-bottom:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
.slide-title{font-weight:700}
.b-metric{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.015));border-color:color-mix(in srgb,var(--accent) 28%,transparent)}
.b-metric::before{height:2px;background:var(--accent)}
.compare-card{background:rgba(255,255,255,.04)}
.compare-card.is-last{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.compare-vs{background:var(--accent);color:var(--bg)}
.trend-down .metric-delta,.tone-risk .callout-label,.status-risk .tl-status{color:#ff9b9b}
.b-table{background:rgba(255,255,255,.03)}
.hero-rule{background:var(--accent);height:3px;width:120px}
`,
  sample: {
    title: 'Q3 交付与经营决策汇报',
    subtitle: '结论：按期交付概率 85%，需追加 2 名后端支持并确认范围调整',
    period: '2026 年第三季度',
    slides: [
      {
        layout: 'cover',
        title: 'Q3 交付与经营决策汇报',
        kicker: '管理层决策会',
        blocks: [],
      },
      {
        layout: 'metrics',
        title: '结论先行：整体可控，进度偏差需要资源介入',
        kicker: '核心指标',
        blocks: [
          metric('按期交付概率', '85', '%', '较 Q2 -7pt', 'down'),
          metric('预算执行率', '78', '%', '计划 80%', 'flat'),
          metric('范围完成', '64/80', '项', '+11 项', 'up'),
          metric('进度偏差', '+9', '天', '关键路径', 'down'),
        ],
      },
      {
        layout: 'comparison',
        title: '计划与实际的偏差',
        kicker: '计划偏差',
        blocks: [
          p('计划'),
          list([
            '9 月底完成支付与对账两条主链路',
            '后端 6 人，前端 4 人',
            '云资源预算 120 万元',
          ]),
          p('实际'),
          list([
            '对账链路延后至 10 月中旬',
            '后端实际可用 4.5 人（2 人支援客户项目）',
            '云资源支出 94 万元，节余 26 万元',
          ]),
        ],
      },
      {
        layout: 'chart',
        title: '成本结构稳定，人力是唯一缺口',
        kicker: '资源投入',
        blocks: [
          chart(
            'bar',
            '季度成本构成',
            ['7 月', '8 月', '9 月'],
            [
              { label: '人力', values: [168, 172, 181] },
              { label: '云资源', values: [31, 30, 33] },
              { label: '外包', values: [12, 18, 9] },
            ],
            '万元'
          ),
          callout(
            'decision',
            '建议：追加 2 名后端（可从平台组借调 6 周），预计将偏差缩短至 2 天。'
          ),
        ],
      },
      {
        layout: 'bullets',
        title: '三项重要风险',
        kicker: '风险与应对',
        blocks: [
          list(
            [
              '对账链路延期 → 影响 11 月客户上线；应对：追加人力并拆分发布',
              '第三方支付接口变更 → 需重新认证；应对：已提前提交测试申请',
              '核心成员离职风险 → 关键知识集中；应对：本月完成交接文档',
            ],
            true
          ),
          metric('风险敞口', '320', '万元', '若延期 1 个月', 'flat'),
        ],
      },
      {
        layout: 'timeline',
        title: '决策后的执行节奏',
        kicker: '时间节点',
        blocks: [
          timeline([
            { date: '10.20', title: '确认资源方案', status: 'active' },
            { date: '10.27', title: '借调人员到岗', status: 'planned' },
            { date: '11.10', title: '对账链路联调', status: 'planned' },
            { date: '11.24', title: '客户上线', status: 'planned' },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '请管理层决策',
        kicker: '待决策事项',
        blocks: [
          list(
            [
              '方案 A：借调 2 名后端 6 周，按期上线',
              '方案 B：维持现状，上线顺延 3 周',
              '方案 C：缩减对账范围，首期仅支持 2 家银行',
            ],
            true
          ),
          callout('decision', '请于 10 月 20 日前给出选择，以便锁定借调人员。'),
        ],
      },
    ],
  },
};

const customer: DeckTemplate = {
  key: 'customer',
  name: '客户阶段成果汇报',
  description: '向客户展示阶段交付：目标、成果演示、待确认事项与后续安排。',
  purposes: ['customer', 'progress'],
  motion: deckMotionForTemplate('customer'),
  theme: {
    background: '#ffffff',
    surface: '#f4f7ff',
    foreground: '#1f2a37',
    muted: '#6b7685',
    accent: '#2f6fed',
    accent2: '#18b8a6',
    fontStyle: 'sans',
    decor: svg(
      '<circle class="da" cx="1170" cy="170" r="300" opacity=".95"/><circle class="da2" cx="1010" cy="520" r="120" opacity=".85"/><circle class="dsf" cx="1170" cy="170" r="150" opacity=".18"/><g class="dfg" opacity=".12"><circle cx="860" cy="610" r="4"/><circle cx="890" cy="610" r="4"/><circle cx="920" cy="610" r="4"/><circle cx="860" cy="640" r="4"/><circle cx="890" cy="640" r="4"/><circle cx="920" cy="640" r="4"/></g>'
    ),
  },
  css: `
:root{--hero-max:720px}
.b-metric{border:0;border-radius:24px}
.b-metric::before{display:none}
.metric-num{color:var(--accent)}
.b-table{border:0}
.compare-card{border:0}
.slide-title{font-weight:720}
`,
  sample: {
    title: '智慧仓储平台二期 · 阶段成果汇报',
    subtitle: '面向华东物流集团 · 第二阶段交付回顾与下一步安排',
    period: '2026 年 9 月',
    slides: [
      {
        layout: 'cover',
        title: '智慧仓储平台二期阶段成果',
        kicker: '阶段汇报',
        blocks: [p('本阶段目标：完成 3 个区域仓的拣货优化与库存可视化上线。')],
      },
      {
        layout: 'metrics',
        title: '上线三周，效率提升已经可见',
        kicker: '业务价值',
        blocks: [
          metric('拣货效率提升', '31', '%', '目标 25%', 'up'),
          metric('库位利用率', '87', '%', '上线前 72%', 'up'),
          metric('系统可用性', '99.95', '%', 'SLA 99.9%', 'flat'),
        ],
      },
      {
        layout: 'bullets',
        title: '本阶段交付成果',
        kicker: '交付清单',
        blocks: [
          list([
            '智能波次拣货：按订单结构自动合并波次，减少往返路径',
            '库存可视化大屏：实时展示 3 个区域仓的库位与周转情况',
            '移动端盘点：支持离线扫码，网络恢复后自动同步',
            '运营日报：每日 8 点自动推送关键指标',
          ]),
          callout('info', '所有功能已在嘉兴、昆山、南通三个仓完成培训与上线。'),
        ],
      },
      {
        layout: 'chart',
        title: '作业量结构：出库与入库占九成',
        kicker: '成果展示',
        blocks: [
          chart(
            'donut',
            '9 月作业量分布',
            ['入库', '出库', '移库', '盘点'],
            [{ label: '作业量', values: [128, 116, 37, 24] }],
            '万单'
          ),
          list(['出库高峰集中在 18:00–22:00', '移库作业较 8 月下降 18%']),
        ],
      },
      {
        layout: 'table',
        title: '需要贵方确认的事项',
        kicker: '待确认',
        blocks: [
          {
            type: 'table',
            columns: ['事项', '需要配合', '期限'],
            rows: [
              ['三期范围', '确认是否纳入冷链仓', '10 月 18 日'],
              ['数据接口', '提供 ERP 测试账号', '10 月 22 日'],
              ['验收标准', '签署二期验收单', '10 月 25 日'],
            ],
          },
        ],
      },
      {
        layout: 'timeline',
        title: '后续安排',
        kicker: '下一阶段',
        blocks: [
          timeline([
            {
              date: '10 月',
              title: '二期验收',
              detail: '签署验收单',
              status: 'active',
            },
            {
              date: '11 月',
              title: '三期方案',
              detail: '冷链仓需求调研',
              status: 'planned',
            },
            {
              date: '12 月',
              title: '三期开发',
              detail: '预计 8 周',
              status: 'planned',
            },
            {
              date: '2027.02',
              title: '全面上线',
              detail: '覆盖 6 个区域仓',
              status: 'planned',
            },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '感谢贵方的信任与配合',
        kicker: '谢谢',
        blocks: [p('项目组将在每周五同步进展，如有问题请随时联系项目经理。')],
      },
    ],
  },
};

const milestone: DeckTemplate = {
  key: 'milestone',
  name: '里程碑与验收汇报',
  description: '里程碑节点或验收会使用：逐项对照验收要求，给出完成证据。',
  purposes: ['progress', 'customer', 'decision'],
  motion: deckMotionForTemplate('milestone'),
  theme: {
    background: '#f3f6f4',
    surface: '#ffffff',
    foreground: '#17322a',
    muted: '#5d736a',
    accent: '#2f7d5b',
    accent2: '#c9a227',
    fontStyle: 'sans',
    decor: svg(
      '<g class="sa" stroke-width="2" opacity=".35"><path d="M900 0v720M1000 0v720M1100 0v720M1200 0v720"/></g><path class="sa" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" d="M940 380l90 90 170-200" opacity=".9"/><rect class="da2" x="900" y="600" width="300" height="10" rx="5"/><rect class="da" x="900" y="600" width="220" height="10" rx="5"/>'
    ),
  },
  css: `
:root{--hero-max:760px}
.b-metric::before{background:var(--accent)}
.status-done .tl-node::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2.5px 2.5px 0;transform:rotate(45deg)}
.tl-horizontal .tl-rail{height:6px;top:8px}
.b-table td:nth-child(2){color:var(--accent);font-weight:700}
`,
  sample: {
    title: 'M3 里程碑验收汇报',
    subtitle: '数据中台 · 指标服务上线验收',
    period: '2026.09.30',
    slides: [
      {
        layout: 'cover',
        title: 'M3 里程碑验收汇报',
        kicker: '指标服务上线',
        blocks: [
          p('验收结论：20 项要求中 18 项通过，2 项有差异并已给出处理计划。'),
        ],
      },
      {
        layout: 'metrics',
        title: '总体验收结果',
        kicker: '里程碑概览',
        blocks: [
          metric('验收项通过', '18/20', '项', '通过率 90%', 'up'),
          metric('接口 P99 时延', '120', 'ms', '要求 ≤ 200ms', 'down'),
          metric('数据准确率', '99.7', '%', '要求 ≥ 99.5%', 'up'),
        ],
      },
      {
        layout: 'table',
        title: '逐项完成证据',
        kicker: '验收对照',
        blocks: [
          {
            type: 'table',
            columns: ['验收要求', '结果', '证据'],
            rows: [
              ['核心指标 120 个全部上线', '通过', '指标目录 v3.2'],
              ['查询 P99 ≤ 200ms', '通过', '压测报告 0926'],
              ['权限按部门隔离', '通过', '安全测试记录'],
              ['告警 5 分钟内触达', '差异', '平均 7 分钟'],
              ['运维文档完整', '差异', '缺 2 章'],
            ],
          },
        ],
      },
      {
        layout: 'chart',
        title: '各模块完成度',
        kicker: '完成情况',
        blocks: [
          chart(
            'bar',
            '模块完成度',
            ['指标定义', '计算引擎', '权限', '监控告警', '运维文档'],
            [{ label: '完成度', values: [100, 100, 100, 85, 70] }],
            '%'
          ),
        ],
      },
      {
        layout: 'bullets',
        title: '未完成项与差异',
        kicker: '差异说明',
        blocks: [
          list([
            '告警触达平均 7 分钟：短信通道排队导致，改为企业微信优先',
            '运维文档缺“容量规划”“灾备演练”两章：依赖 10 月演练结果',
          ]),
          callout('risk', '两项差异均不影响业务使用，建议有条件通过验收。'),
        ],
      },
      {
        layout: 'timeline',
        title: '后续处理计划',
        kicker: '整改安排',
        blocks: [
          timeline([
            { date: '09.30', title: '提交验收材料', status: 'done' },
            {
              date: '10.10',
              title: '告警通道切换',
              detail: '负责人：赵敏',
              status: 'active',
            },
            {
              date: '10.20',
              title: '灾备演练',
              detail: '负责人：陈立',
              status: 'planned',
            },
            { date: '10.31', title: '文档补齐复验', status: 'planned' },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '建议：有条件通过 M3 验收',
        kicker: '验收结论',
        blocks: [
          callout(
            'decision',
            '请验收组确认：两项差异于 10 月 31 日前完成整改后复验。'
          ),
        ],
      },
    ],
  },
};

const closure: DeckTemplate = {
  key: 'closure',
  name: '项目结项汇报',
  description: '项目收尾时使用：目标达成情况、最终交付、遗留事项与交接维护。',
  purposes: ['customer', 'retrospective', 'other'],
  motion: deckMotionForTemplate('closure'),
  theme: {
    background: '#fbfaf7',
    surface: '#f3efe7',
    foreground: '#2a2622',
    muted: '#7a7066',
    accent: '#8a5a2b',
    accent2: '#4f6b5a',
    fontStyle: 'serif',
    decor: svg(
      '<rect class="sa" x="36" y="36" width="1208" height="648" stroke-width="1.5" opacity=".55"/><rect class="sa" x="48" y="48" width="1184" height="624" stroke-width=".8" opacity=".4"/><g class="da" opacity=".85"><path d="M640 84l8 8-8 8-8-8z"/><path d="M640 620l8 8-8 8-8-8z"/></g>'
    ),
  },
  css: `
.layout-cover .slide-fit,.layout-section .slide-fit,.layout-closing .slide-fit{align-items:center;text-align:center}
.cover-main,.section-main,.closing-main{align-items:center}
.hero-rule{width:160px;height:6px;background:none;border-top:1px solid var(--accent);border-bottom:1px solid var(--accent);border-radius:0}
.slide-title,.cover-title,.section-title,.closing-title{font-weight:700;letter-spacing:0}
.kicker{letter-spacing:.3em;font-weight:600}
.b-metric{border-radius:6px;background:transparent;border:1px solid color-mix(in srgb,var(--accent) 30%,transparent)}
.b-metric::before{display:none}
.metric-num{font-weight:600;color:var(--accent)}
.compare-card,.b-table,.b-callout{border-radius:6px}
.b-quote p{font-style:italic;font-weight:500}
.closing-blocks .b-list>li{border-radius:6px;text-align:left}
.section-index{font-style:italic;font-weight:500}
`,
  sample: {
    title: '企业知识库项目结项报告',
    subtitle: '历时 9 个月，6 项目标全部达成，进入运维交接阶段',
    period: '2026.01 – 2026.09',
    slides: [
      {
        layout: 'cover',
        title: '企业知识库项目结项报告',
        kicker: '项目回顾',
        blocks: [],
      },
      {
        layout: 'metrics',
        title: '目标达成情况',
        kicker: '最终成果',
        blocks: [
          metric('目标达成', '6/6', '项', '全部达成', 'up'),
          metric('文档迁移', '12.4', '万篇', '计划 10 万篇', 'up'),
          metric('检索满意度', '91', '%', '基线 63%', 'up'),
          metric('预算结余', '4.2', '%', '未超支', 'flat'),
        ],
      },
      {
        layout: 'chart',
        title: '月活跃用户稳步增长',
        kicker: '使用情况',
        blocks: [
          chart(
            'line',
            '月活跃用户',
            ['4 月', '5 月', '6 月', '7 月', '8 月', '9 月'],
            [{ label: '月活', values: [820, 1460, 2210, 2980, 3620, 4150] }],
            '人'
          ),
          p('上线半年覆盖全集团 87% 员工，客服与研发部门使用最活跃。'),
        ],
      },
      {
        layout: 'quote',
        title: '来自业务方的评价',
        kicker: '客户反馈',
        blocks: [
          {
            type: 'quote',
            text: '以前找一份制度要问三个人，现在一句话就能找到原文和出处。',
            by: '集团人力资源部 · 刘总监',
          },
        ],
      },
      {
        layout: 'bullets',
        title: '遗留事项',
        kicker: '尚未关闭',
        blocks: [
          list([
            '海外子公司英文文档迁移（约 3,200 篇），已排入运维计划',
            '与 OA 系统单点登录的二次认证优化',
            '历史扫描件 OCR 准确率提升至 98%',
          ]),
          callout('info', '以上事项均不影响结项，由运维团队按季度跟进。'),
        ],
      },
      {
        layout: 'timeline',
        title: '交接与维护安排',
        kicker: '交接计划',
        blocks: [
          timeline([
            { date: '09.30', title: '结项评审', status: 'done' },
            {
              date: '10.15',
              title: '运维交接',
              detail: '信息中心接手',
              status: 'active',
            },
            { date: '12.31', title: '质保期结束', status: 'planned' },
            { date: '2027 Q1', title: '首次年度评估', status: 'planned' },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '感谢每一位参与者',
        kicker: '致谢',
        blocks: [p('项目组共 14 人、合作部门 9 个，累计组织培训 46 场。')],
      },
    ],
  },
};

const retrospective: DeckTemplate = {
  key: 'retrospective',
  name: '项目复盘',
  description:
    '项目或阶段结束后的团队复盘：计划与实际、做得好的、问题原因与改进。',
  purposes: ['retrospective', 'training'],
  motion: deckMotionForTemplate('retrospective'),
  theme: {
    background: '#fff8f3',
    surface: '#ffffff',
    foreground: '#3a2a22',
    muted: '#8a7366',
    accent: '#d0603a',
    accent2: '#3c7a89',
    fontStyle: 'sans',
    decor: svg(
      '<path class="da" opacity=".9" d="M1280 0v360c-60 40-150 52-220 10-80-48-90-150-170-200C830 132 800 60 820 0z"/><path class="da2" opacity=".85" d="M1280 470c-90-30-190 10-220 90-20 54 0 110 30 160h190z"/><circle class="sa" cx="760" cy="600" r="46" stroke-width="3" opacity=".5"/>'
    ),
  },
  css: `
:root{--hero-max:700px}
.slide-head .kicker,.cover-main .kicker{align-self:flex-start;padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);letter-spacing:.12em}
.b-metric,.compare-card,.b-table{border:0;border-radius:28px;box-shadow:0 22px 44px -30px rgba(208,96,58,.55)}
.b-metric::before{display:none}
.metric-num{color:var(--accent)}
.b-callout{border-radius:22px}
`,
  sample: {
    title: '移动端 3.0 发布复盘',
    subtitle: '对事不对人：我们学到了什么，下次怎么做得更好',
    period: '2026 年第三季度',
    slides: [
      {
        layout: 'cover',
        title: '移动端 3.0 发布复盘',
        kicker: '团队复盘',
        blocks: [p('参与人：产品 2 人、设计 2 人、研发 9 人、测试 3 人')],
      },
      {
        layout: 'comparison',
        title: '计划与实际',
        kicker: '对照',
        blocks: [
          p('计划'),
          list(['8 周完成', '12 项核心功能', '崩溃率 < 0.1%']),
          p('实际'),
          list(['10 周完成（+2 周）', '11 项上线，1 项延后', '崩溃率 0.06%']),
        ],
      },
      {
        layout: 'chart',
        title: '前四周进度持续落后，第六周开始追赶',
        kicker: '进度曲线',
        blocks: [
          chart(
            'line',
            '累计完成故事点',
            ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'],
            [
              {
                label: '计划',
                values: [15, 30, 45, 60, 75, 90, 105, 120, 120, 120],
              },
              {
                label: '实际',
                values: [10, 21, 30, 41, 55, 72, 88, 101, 113, 120],
              },
            ],
            '点'
          ),
        ],
      },
      {
        layout: 'metrics',
        title: '质量结果好于预期',
        kicker: '结果',
        blocks: [
          metric('崩溃率', '0.06', '%', '目标 0.1%', 'down'),
          metric('应用商店评分', '4.8', '分', '+0.3', 'up'),
          metric('线上热修复', '2', '次', '上版本 7 次', 'down'),
        ],
      },
      {
        layout: 'bullets',
        title: '问题及根本原因',
        kicker: '问题分析',
        blocks: [
          list(
            [
              '设计稿评审晚于开发启动，导致前两周返工',
              '第三方地图 SDK 升级未纳入计划，占用 1.5 周',
              '测试环境数据不足，回归测试只能串行',
            ],
            true
          ),
          callout('risk', '共性原因：依赖与前置条件没有在启动会上显式确认。'),
        ],
      },
      {
        layout: 'timeline',
        title: '关键决策回顾',
        kicker: '决策',
        blocks: [
          timeline([
            {
              date: 'W2',
              title: '冻结设计稿',
              detail: '止住返工',
              status: 'done',
            },
            {
              date: 'W4',
              title: '延后离线地图',
              detail: '保住主线',
              status: 'done',
            },
            {
              date: 'W6',
              title: '并行回归',
              detail: '新增 2 套环境',
              status: 'done',
            },
            {
              date: 'W9',
              title: '灰度 10%',
              detail: '提前发现 3 个问题',
              status: 'done',
            },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '改进行动',
        kicker: '下次这样做',
        blocks: [
          list(
            [
              '启动会使用依赖清单逐项确认（负责人：产品经理）',
              '设计评审前置一周（负责人：设计负责人）',
              '测试数据自动生成脚本（负责人：测试组，11 月底）',
            ],
            true
          ),
        ],
      },
    ],
  },
};

const launch: DeckTemplate = {
  key: 'launch',
  name: '科技发布会',
  description: '深色舞台与霓虹光效，适合产品发布、对外宣讲与年度大会。',
  purposes: ['customer', 'other', 'training'],
  motion: deckMotionForTemplate('launch'),
  theme: {
    background: '#06070b',
    surface: '#10131c',
    foreground: '#f5f7ff',
    muted: '#8b93a7',
    accent: '#22d3ee',
    accent2: '#a855f7',
    fontStyle: 'sans',
    decor: svg(
      '<circle class="da2 blur" cx="1060" cy="120" r="210" opacity=".55"/><circle class="da blur" cx="200" cy="640" r="190" opacity=".4"/><g class="sa" stroke-width="1" opacity=".22"><path d="M0 560H1280M0 610H1280M0 670H1280"/><path d="M640 520L100 720M640 520L380 720M640 520L900 720M640 520L1180 720"/></g>'
    ),
  },
  css: `
.slide{background:radial-gradient(1100px 560px at 85% -12%,color-mix(in srgb,var(--accent2) 20%,transparent),transparent 62%),radial-gradient(900px 520px at -5% 112%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 60%),var(--bg)}
.decor .blur{filter:blur(80px)}
.layout-cover .slide-fit,.layout-section .slide-fit,.layout-closing .slide-fit{align-items:center;text-align:center}
.cover-main,.section-main,.closing-main{align-items:center;max-width:1000px}
.cover-title{font-size:88px;font-weight:850;letter-spacing:-.035em}
.cover-title,.section-title,.closing-title,.metric-num,.section-index{background:linear-gradient(100deg,#ffffff 8%,var(--accent) 55%,var(--accent2) 96%);-webkit-background-clip:text;background-clip:text;color:transparent}
.kicker{letter-spacing:.32em;color:var(--accent)}
.slide-title{font-weight:780}
.b-metric{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.1);border-radius:24px}
.b-metric::before{height:2px}
.compare-card,.b-table,.b-callout{background:rgba(255,255,255,.035);border-color:rgba(255,255,255,.1)}
.compare-vs{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#06070b}
.status-done .tl-node{box-shadow:0 0 18px var(--accent)}
.tl-track{background:rgba(255,255,255,.1)}
.closing-blocks .b-list>li{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1)}
.trend-down .metric-delta,.tone-risk .callout-label{color:#ff8fa3}
`,
  sample: {
    title: 'LocalMind 2.0 发布会',
    subtitle: '让每一份资料，都能变成一场好汇报',
    period: '2026 秋季发布',
    slides: [
      {
        layout: 'cover',
        title: 'LocalMind 2.0',
        kicker: '产品发布会',
        blocks: [],
      },
      {
        layout: 'section',
        title: '全新 AI 汇报引擎',
        kicker: '第一章',
        blocks: [p('选中文档、文件夹或整个项目，一键生成可演示的动态汇报。')],
      },
      {
        layout: 'metrics',
        title: '更快、更美、更安全',
        kicker: '核心升级',
        blocks: [
          metric('生成速度', '3', '倍', '对比 1.x', 'up'),
          metric('精选模版', '10', '套', '含 4 套全新风格', 'up'),
          metric('本地处理', '100', '%', '数据不出内网', 'flat'),
        ],
      },
      {
        layout: 'chart',
        title: 'Beta 用户五个月增长 13 倍',
        kicker: '增长',
        blocks: [
          chart(
            'bar',
            'Beta 用户数',
            ['6 月', '7 月', '8 月', '9 月', '10 月'],
            [{ label: '用户', values: [1.2, 2.8, 5.6, 9.4, 15.8] }],
            '万人'
          ),
        ],
      },
      {
        layout: 'bullets',
        title: '三个关键能力',
        kicker: '产品亮点',
        blocks: [
          list([
            '跨项目取材：一次选中多个工作区与项目的资料',
            '模版与自由创作：既能稳定出品，也能大胆发挥',
            '安全分享：链接带密码与有效期，随时撤销',
          ]),
          metric('内测满意度', '96', '%', 'NPS 72', 'up'),
        ],
      },
      {
        layout: 'timeline',
        title: '上线路线图',
        kicker: '路线图',
        blocks: [
          timeline([
            { date: '10.15', title: '公开发布', status: 'done' },
            { date: '11.01', title: '企业版上线', status: 'active' },
            { date: '12.01', title: '移动端演示', status: 'planned' },
            { date: '2027 Q1', title: '多人协作', status: 'planned' },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '现在就开始',
        kicker: 'LocalMind 2.0',
        blocks: [p('今天起，所有工作区免费升级。')],
      },
    ],
  },
};

const minimal: DeckTemplate = {
  key: 'minimal',
  name: '极简黑白',
  description: '黑白两色与大字号排版，去掉一切装饰，让观点本身说话。',
  purposes: ['other', 'decision', 'training'],
  motion: deckMotionForTemplate('minimal'),
  theme: {
    background: '#ffffff',
    surface: '#ffffff',
    foreground: '#0a0a0a',
    muted: '#737373',
    accent: '#0a0a0a',
    accent2: '#a3a3a3',
    fontStyle: 'sans',
    decor: svg(
      '<rect class="dfg" x="96" y="96" width="14" height="14"/><path class="sfg" stroke-width="1" d="M96 624H1184" opacity=".25"/>'
    ),
  },
  css: `
.slide-fit{padding:72px 100px 72px}
.kicker{color:var(--muted);letter-spacing:.26em;font-weight:600;font-size:14px}
.slide-title{font-size:48px;font-weight:650;letter-spacing:-.025em}
.cover-title{font-size:96px;font-weight:700;letter-spacing:-.045em}
.closing-title,.section-title{font-weight:700;letter-spacing:-.04em}
.hero-rule{height:2px;width:64px;background:var(--fg);border-radius:0}
.b-metric{background:none;border:0;border-top:2px solid var(--fg);border-radius:0;padding:22px 0 0}
.b-metric::before{display:none}
.metric-num{font-weight:650;letter-spacing:-.045em}
.metric-delta,.trend-up .metric-delta,.trend-down .metric-delta{background:none;padding:0;color:var(--muted)}
.li-dot{width:16px;height:2px;border-radius:0;background:var(--fg);transform:translateY(-7px)}
.li-num{color:var(--fg)}
.b-table{border:0;border-radius:0;background:none}
.b-table th{background:none;border-bottom:2px solid var(--fg);color:var(--fg)}
.compare-grid{gap:64px}
.compare-card,.compare-card.is-last{background:none;border:0;border-top:2px solid var(--fg);border-radius:0;padding:24px 0 0}
.compare-card.is-last .compare-head{color:var(--fg)}
.compare-vs{display:none}
.b-callout,.tone-risk,.tone-decision{background:none;border-left:2px solid var(--fg);border-radius:0}
.callout-label,.tone-risk .callout-label,.tone-decision .callout-label{color:var(--muted)}
.tl-fill{background:var(--fg)}
.tl-date{color:var(--muted)}
.status-done .tl-node{background:var(--fg);border-color:var(--fg)}
.status-active .tl-node{border-color:var(--fg);box-shadow:none}
.b-quote::before{color:var(--fg)}
.closing-blocks .b-list>li{background:none;border:0;border-top:1px solid var(--fg);border-radius:0;padding:16px 0 0}
.layout-cover .slide-fit{justify-content:flex-end;padding-bottom:120px}
`,
  sample: {
    title: '年度战略回顾',
    subtitle: '少即是多：2027 年只做三件事',
    period: '2026 年度',
    slides: [
      {
        layout: 'cover',
        title: '少即是多',
        kicker: '2026 年度战略回顾',
        blocks: [],
      },
      {
        layout: 'bullets',
        title: '三件事',
        kicker: '聚焦',
        blocks: [
          list(
            [
              '把核心产品的留存率做到行业第一',
              '把交付周期从 6 周压缩到 3 周',
              '把客户成功团队变成增长引擎',
            ],
            true
          ),
        ],
      },
      {
        layout: 'metrics',
        title: '今年最重要的两个数字',
        kicker: '结果',
        blocks: [
          metric('年度收入增长', '48', '%', '连续三年 > 40%', 'up'),
          metric('客户留存率', '93', '%', '+5pt', 'up'),
        ],
      },
      {
        layout: 'chart',
        title: '增长来自老客户扩展',
        kicker: '收入结构',
        blocks: [
          chart(
            'bar',
            '季度收入',
            ['Q1', 'Q2', 'Q3', 'Q4'],
            [
              { label: '新客户', values: [820, 860, 910, 940] },
              { label: '老客户扩展', values: [1240, 1420, 1650, 1880] },
            ],
            '万元'
          ),
        ],
      },
      {
        layout: 'quote',
        title: '一句话',
        kicker: '原则',
        blocks: [
          {
            type: 'quote',
            text: '决定不做什么，和决定做什么一样重要。',
            by: '史蒂夫·乔布斯',
          },
        ],
      },
      {
        layout: 'timeline',
        title: '节奏',
        kicker: '2027',
        blocks: [
          timeline([
            { date: 'Q1', title: '组织调整', status: 'active' },
            { date: 'Q2', title: '留存专项', status: 'planned' },
            { date: 'Q3', title: '交付提速', status: 'planned' },
            { date: 'Q4', title: '复盘', status: 'planned' },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '谢谢',
        blocks: [],
      },
    ],
  },
};

const dashboard: DeckTemplate = {
  key: 'dashboard',
  name: '数据看板',
  description: '卡片式数据看板，指标、趋势与结构一屏看清，适合运营与经营分析。',
  purposes: ['periodic', 'progress', 'decision'],
  motion: deckMotionForTemplate('dashboard'),
  theme: {
    background: '#eef2f7',
    surface: '#ffffff',
    foreground: '#0f172a',
    muted: '#64748b',
    accent: '#2563eb',
    accent2: '#10b981',
    fontStyle: 'sans',
    decor: svg(
      '<g class="dfg" opacity=".07"><rect x="860" y="120" width="320" height="200" rx="18"/><rect x="860" y="350" width="150" height="250" rx="18"/><rect x="1030" y="350" width="150" height="250" rx="18"/></g><g class="da"><rect x="890" y="250" width="26" height="46" rx="5"/><rect x="930" y="220" width="26" height="76" rx="5"/><rect x="970" y="190" width="26" height="106" rx="5"/><rect x="1010" y="230" width="26" height="66" rx="5"/></g><rect class="da2" x="1050" y="160" width="26" height="136" rx="5"/><path class="sa2" stroke-width="5" stroke-linecap="round" d="M890 540l40-50 40 20 40-70" /><circle class="sa" cx="1105" cy="475" r="48" stroke-width="16"/>'
    ),
  },
  css: `
:root{--hero-max:720px}
.slide-fit{padding:48px 64px 56px;gap:24px}
.slide-title{font-size:36px;font-weight:750}
.slide-head{gap:12px}
.slide-head .kicker,.cover-main .kicker{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:9px;background:var(--surface);border:1px solid var(--line);letter-spacing:.08em;font-size:13px}
.slide-head .kicker::before,.cover-main .kicker::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent2)}
.b-metric{border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.06)}
.b-metric::before{right:auto;bottom:0;width:4px;height:auto;background:var(--accent)}
.metric-num{font-family:"SF Mono","JetBrains Mono",Menlo,Consolas,var(--font);font-weight:700;letter-spacing:-.04em}
.b-chart,.b-table,.b-timeline,.b-list,.b-para{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 26px;box-shadow:0 1px 2px rgba(15,23,42,.06)}
.cover-blocks .b-para,.section-blocks .b-para,.closing-blocks .b-para{background:none;border:0;box-shadow:none;padding:0}
.closing-blocks .b-list{background:none;border:0;box-shadow:none;padding:0}
.tl-horizontal{padding-top:26px}
.tl-horizontal .tl-rail{top:34px;left:26px;right:26px;height:6px}
.b-timeline.tl-vertical{padding-left:64px}
.tl-vertical .tl-rail{left:35px;top:30px;bottom:30px}
.layout-cover .slide-fit{padding:72px 88px}
.split{gap:24px}
`,
  sample: {
    title: '10 月运营数据看板',
    subtitle: '内容社区 · 月度运营分析',
    period: '2026.10',
    slides: [
      {
        layout: 'cover',
        title: '10 月运营数据看板',
        kicker: '月度运营分析',
        blocks: [p('活跃与收入双增长；新用户次日留存需关注。')],
      },
      {
        layout: 'metrics',
        title: '核心指标总览',
        kicker: '本月概览',
        blocks: [
          metric('月活跃用户', '1,286', '万', '环比 +8.4%', 'up'),
          metric('日均使用时长', '42.6', '分钟', '环比 +3.1', 'up'),
          metric('付费转化率', '3.8', '%', '环比 +0.4pt', 'up'),
          metric('次日留存', '38.2', '%', '环比 -2.6pt', 'down'),
          metric('内容发布量', '96.4', '万条', '环比 +12%', 'up'),
          metric('客诉率', '0.21', '‰', '环比 -0.05', 'down'),
        ],
      },
      {
        layout: 'chart',
        title: '日活趋势：国庆后快速回升',
        kicker: '活跃趋势',
        blocks: [
          chart(
            'line',
            '日活跃用户（周均）',
            ['9/22', '9/29', '10/06', '10/13', '10/20', '10/27'],
            [
              { label: '2026', values: [402, 455, 371, 428, 446, 463] },
              { label: '2025', values: [356, 398, 340, 372, 380, 391] },
            ],
            '万'
          ),
          metric('峰值日活', '492', '万', '10 月 26 日', 'up'),
          callout('info', '国庆假期日活下降 18%，假期后一周恢复。'),
        ],
      },
      {
        layout: 'chart',
        title: '收入结构：会员占比过半',
        kicker: '收入构成',
        blocks: [
          chart(
            'donut',
            '10 月收入构成',
            ['会员订阅', '广告', '电商分佣', '虚拟礼物'],
            [{ label: '收入', values: [5620, 2840, 1310, 960] }],
            '万元'
          ),
          list([
            '会员收入环比 +11%',
            '广告收入受假期影响 -4%',
            '电商分佣首次突破千万',
          ]),
        ],
      },
      {
        layout: 'timeline',
        title: '本月关键运营动作',
        kicker: '运营节奏',
        blocks: [
          timeline([
            {
              date: '10.01',
              title: '国庆活动',
              detail: '参与 312 万人',
              status: 'done',
            },
            {
              date: '10.12',
              title: '创作者激励',
              detail: '新增 2.1 万作者',
              status: 'done',
            },
            {
              date: '10.20',
              title: '会员改版',
              detail: '转化 +0.4pt',
              status: 'done',
            },
            {
              date: '10.28',
              title: '留存专项',
              detail: '新手引导优化',
              status: 'active',
            },
            {
              date: '11.11',
              title: '双十一',
              detail: '电商大促',
              status: 'planned',
            },
          ]),
        ],
      },
      {
        layout: 'bullets',
        title: '需要关注',
        kicker: '异常与风险',
        blocks: [
          list([
            '新用户次日留存连续两周下降，主要来自信息流投放渠道',
            '安卓端启动耗时上升 0.4 秒，可能影响留存',
            '双十一期间服务器扩容预算尚未批复',
          ]),
          callout(
            'decision',
            '建议本月暂停低质量投放渠道，预算转向创作者激励。'
          ),
        ],
      },
      {
        layout: 'closing',
        title: '11 月目标',
        kicker: '下月计划',
        blocks: [
          list(['月活 1,350 万', '次日留存回到 40%', '付费转化 4.0%'], false),
        ],
      },
    ],
  },
};

const vivid: DeckTemplate = {
  key: 'vivid',
  name: '活力创意',
  description: '明快撞色与贴纸式卡片，适合创意提案、培训分享与校园活动。',
  purposes: ['training', 'other', 'customer'],
  motion: deckMotionForTemplate('vivid'),
  theme: {
    background: '#fff6e9',
    surface: '#ffffff',
    foreground: '#1e1b4b',
    muted: '#5f5d84',
    accent: '#ff4f8b',
    accent2: '#6c4dff',
    fontStyle: 'sans',
    decor: svg(
      '<circle class="da" cx="1120" cy="150" r="190"/><circle class="da2" cx="980" cy="540" r="120"/><circle cx="1200" cy="560" r="64" fill="#ffc53d"/><path class="sfg" stroke-width="6" stroke-linecap="round" d="M820 120c30-30 60 30 90 0s60 30 90 0" opacity=".9"/><rect class="dfg" x="860" y="330" width="54" height="54" rx="10" transform="rotate(18 887 357)"/>'
    ),
  },
  css: `
:root{--hero-max:700px}
.slide-title{font-weight:850;letter-spacing:-.02em}
.cover-title{font-size:84px;font-weight:900;letter-spacing:-.035em}
.closing-title,.section-title{font-weight:900}
.slide-head .kicker,.cover-main .kicker,.closing-main .kicker,.section-main .kicker{align-self:flex-start;display:inline-block;padding:8px 18px;border-radius:999px;background:var(--accent2);color:#fff;letter-spacing:.1em;transform:rotate(-2deg)}
.hero-rule{height:12px;width:150px;border-radius:12px}
.b-metric,.compare-card,.b-table,.b-callout,.closing-blocks .b-list>li{border:3px solid var(--fg);box-shadow:6px 6px 0 var(--fg);border-radius:22px}
.b-callout{border-left-width:3px}
.b-metric::before{display:none}
.b-metric:nth-child(3n+1){background:color-mix(in srgb,var(--accent) 16%,var(--surface))}
.b-metric:nth-child(3n+2){background:color-mix(in srgb,#ffc53d 30%,var(--surface))}
.b-metric:nth-child(3n){background:color-mix(in srgb,var(--accent2) 14%,var(--surface))}
.li-dot{width:14px;height:14px;border-radius:4px;background:var(--accent);transform:translateY(-1px) rotate(45deg)}
.compare-vs{background:#ffc53d;color:var(--fg);border:3px solid var(--fg)}
.tl-node{border-width:3px;border-color:var(--fg)}
.status-done .tl-node{background:var(--accent);border-color:var(--fg)}
`,
  sample: {
    title: '“开学季”校园创意营销方案',
    subtitle: '让 10 万新生在第一周就认识我们',
    period: '2026 年 9 月',
    slides: [
      {
        layout: 'cover',
        title: '开学季校园创意营销方案',
        kicker: '创意提案',
        blocks: [],
      },
      {
        layout: 'bullets',
        title: '三个创意点子',
        kicker: '玩法',
        blocks: [
          list([
            '宿舍门贴盲盒：扫码拆盲盒，抽取新生礼包',
            '“第一张课表”生成器：一键生成可分享的个性课表海报',
            '社团快闪集市：48 小时联合 120 个社团摆摊',
          ]),
          callout('info', '所有玩法都可以在一周内上线，物料成本低于 8 万元。'),
        ],
      },
      {
        layout: 'metrics',
        title: '我们的目标',
        kicker: '目标',
        blocks: [
          metric('触达新生', '10', '万人', '覆盖 24 所高校', 'up'),
          metric('新增注册', '3.5', '万', '转化 35%', 'up'),
          metric('获客成本', '2.3', '元', '低于行业 60%', 'down'),
        ],
      },
      {
        layout: 'chart',
        title: '预算分配',
        kicker: '钱花在哪',
        blocks: [
          chart(
            'pie',
            '预算构成',
            ['物料', '奖品', '社团合作', '线上推广'],
            [{ label: '预算', values: [8, 12, 6, 4] }],
            '万元'
          ),
          p('把一半以上的预算直接变成新生能拿到手的奖品。'),
        ],
      },
      {
        layout: 'timeline',
        title: '执行节奏',
        kicker: '时间线',
        blocks: [
          timeline([
            { date: '08.20', title: '物料设计', status: 'done' },
            { date: '08.28', title: '社团招募', status: 'done' },
            { date: '09.01', title: '盲盒上线', status: 'active' },
            { date: '09.06', title: '快闪集市', status: 'planned' },
            { date: '09.15', title: '效果复盘', status: 'planned' },
          ]),
        ],
      },
      {
        layout: 'closing',
        title: '一起把开学季玩起来！',
        kicker: 'Let’s go',
        blocks: [p('期待与各校学生会、社团一起共创。')],
      },
    ],
  },
};

export const DECK_TEMPLATES: readonly DeckTemplate[] = [
  periodic,
  management,
  customer,
  milestone,
  closure,
  retrospective,
  launch,
  minimal,
  dashboard,
  vivid,
];

export function getDeckTemplate(key: string): DeckTemplate | undefined {
  return DECK_TEMPLATES.find(template => template.key === key);
}

/** Theme used for custom-mode decks (and as a fallback when a key is unknown). */
export const DECK_DEFAULT_CUSTOM_THEME: DeckTemplateTheme = {
  background: '#ffffff',
  surface: '#f5f6f8',
  foreground: '#16181d',
  muted: '#6b7280',
  accent: '#3b5bdb',
  accent2: '#0ca678',
  fontStyle: 'sans',
};
