import type { ReportExperiencePlan, ReportWebArtifact } from './design-v4';
import type { ReportDataset } from './evidence';

/** Shared fixture for v4 renderer/runtime tests (fictional data). */
export const V4_FACTS = [
  {
    id: 'f-total',
    kind: 'number',
    text: '2026 年 10 月原型验收共 12 项检查，9 项通过，3 项仍待修复。',
    quote:
      '2026 年 10 月的原型验收共有 12 项检查，其中 9 项通过，3 项仍待修复。',
    salience: 'headline',
  },
  {
    id: 'f-q1',
    kind: 'number',
    text: '一季度营收 412 万元。',
    quote: '一季度营收 412 万元',
    salience: 'key',
  },
  {
    id: 'f-q2',
    kind: 'number',
    text: '二季度营收 468 万元。',
    quote: '二季度营收 468 万元',
    salience: 'key',
  },
  {
    id: 'f-q3',
    kind: 'number',
    text: '三季度营收 530 万元。',
    quote: '三季度营收 530 万元',
    salience: 'key',
  },
  {
    id: 'f-risk',
    kind: 'risk',
    text: '移动端长表格仍有溢出风险。',
    quote: '移动端长表格仍有溢出风险。',
    salience: 'support',
  },
  {
    id: 'f-next',
    kind: 'decision',
    text: '下一阶段计划修复剩余 3 项检查，之后再讨论发布。',
    quote: '下一阶段计划修复剩余 3 项检查，然后再讨论发布。',
    salience: 'key',
  },
];

export const V4_DATASETS: ReportDataset[] = [
  {
    id: 'ds-revenue',
    title: '2026 年前三季度营收',
    unit: '万元',
    kind: 'series',
    rows: [
      { label: '一季度', value: '412', numeric: 412, factId: 'f-q1' },
      { label: '二季度', value: '468', numeric: 468, factId: 'f-q2' },
      { label: '三季度', value: '530', numeric: 530, factId: 'f-q3' },
    ],
  },
  {
    id: 'ds-checks',
    title: '原型验收检查状态',
    unit: '项',
    kind: 'status_count',
    rows: [
      { label: '通过', value: '9', numeric: 9, factId: 'f-total' },
      { label: '待修复', value: '3', numeric: 3, factId: 'f-total' },
    ],
  },
];

const motion = (
  entrance: ReportExperiencePlan['chapters'][number]['motion']['entrance']
) => ({
  entrance,
  sequence: [
    {
      target: '结论标题',
      effect: 'rise' as const,
      order: 0,
      duration: 'base' as const,
    },
    {
      target: '主图形',
      effect: 'grow' as const,
      order: 1,
      duration: 'long' as const,
    },
  ],
  presentSteps: 1,
});

export const V4_PLAN: ReportExperiencePlan = {
  title: 'Atlas 季度进展',
  thesis: '营收连续增长，但仍有 3 项检查待修复，发布前先修复。',
  direction: {
    archetype: 'data-poster',
    concept: '以真实增长曲线为主视觉的数据海报',
    signature: '增长曲线贯穿开场，验收单元图揭示剩余工作',
    rejected: 'editorial-spread：数据为主，跨页文字会稀释趋势',
  },
  tokens: {
    color: {
      canvas: '#f6f2e9',
      ink: '#102f29',
      muted: '#52655d',
      accent: '#c34d18',
      accentInk: '#ffffff',
      surfaceAlt: '#102f29',
      surfaceAltInk: '#f6f2e9',
    },
    type: {
      display: 'serif',
      body: 'sans',
      numeral: 'sans',
      displayPx: { min: 40, max: 96 },
      sectionPx: { min: 28, max: 52 },
      bodyPx: { min: 16, max: 19 },
      labelPx: 14,
      displayWeight: 700,
      measureChars: { min: 22, max: 34 },
    },
    motion: {
      personality: 'precise',
      intensity: 'standard',
      shortMs: 180,
      baseMs: 420,
      longMs: 900,
      staggerMs: 70,
      easing: 'standard',
    },
  },
  derivations: [
    {
      id: 'd-growth',
      op: 'change_pct',
      dataset: 'ds-revenue',
      inputs: ['一季度', '三季度'],
    },
  ],
  chapters: [
    {
      id: 'rd-c-open',
      title: '增长回来了，但发布要等修复',
      beat: 'hook',
      takeaway: '营收连续三个季度增长，三项检查仍待修复。',
      factIds: ['f-total', 'f-next'],
      datasets: [],
      derivations: ['d-growth'],
      layout: {
        archetype: 'poster-statement',
        dominant: '增长幅度大字',
        dominantShare: 60,
        surface: 'alt',
        density: 'low',
        readingPath: ['标题', '增长幅度', '待修复'],
      },
      mobile: { order: ['标题', '增长幅度', '待修复'], note: '单列' },
      charts: [],
      motion: motion('rise'),
      interactions: [],
    },
    {
      id: 'rd-c-trend',
      title: '三个季度持续增长',
      beat: 'evidence',
      takeaway: '三季度营收高于一季度。',
      factIds: ['f-q1', 'f-q3'],
      datasets: ['ds-revenue'],
      derivations: ['d-growth'],
      layout: {
        archetype: 'figure-dominant',
        dominant: '营收折线',
        dominantShare: 65,
        surface: 'canvas',
        density: 'medium',
        readingPath: ['标题', '折线', '注释'],
      },
      mobile: { order: ['标题', '折线', '注释'], note: '图表切换为紧凑版本' },
      charts: [
        {
          id: 'rd-c-trend-line',
          dataset: 'ds-revenue',
          mark: 'line',
          highlight: ['三季度'],
          sort: 'none',
          valueLabels: 'all',
          takeaway: '三季度最高',
        },
      ],
      motion: motion('draw'),
      interactions: [
        {
          kind: 'switch',
          purpose: '在趋势和验收状态之间切换',
          defaultState: '趋势',
          fallback: '两个视图依次显示',
        },
      ],
    },
    {
      id: 'rd-c-checks',
      title: '剩余三项检查决定发布节奏',
      beat: 'decision',
      takeaway: '修复 3 项检查后再讨论发布。',
      factIds: ['f-total', 'f-risk', 'f-next'],
      datasets: ['ds-checks'],
      derivations: [],
      layout: {
        archetype: 'split-evidence',
        dominant: '单元图',
        dominantShare: 55,
        surface: 'canvas',
        density: 'medium',
        readingPath: ['标题', '单元图', '风险'],
      },
      mobile: { order: ['标题', '单元图', '风险'], note: '单列' },
      charts: [
        {
          id: 'rd-c-checks-units',
          dataset: 'ds-checks',
          mark: 'unit',
          highlight: ['待修复'],
          sort: 'none',
          valueLabels: 'all',
          takeaway: '3 项待修复',
        },
      ],
      motion: motion('fade'),
      interactions: [
        {
          kind: 'linked',
          purpose: '图例与单元联动',
          defaultState: '全部显示',
          fallback: '静态图例',
        },
      ],
    },
  ],
  coverage: { omitted: [] },
  risks: [],
};

export const v4Artifact = (planHash = 'a'.repeat(64)): ReportWebArtifact => ({
  schemaVersion: 'report-web-v4',
  planHash,
  title: 'Atlas 季度进展',
  sharedCss:
    '.rd-title{font:var(--rd-weight-display) var(--rd-size-display)/1.08 var(--rd-font-display)}.rd-lede{max-width:var(--rd-measure)}',
  chapters: [
    {
      id: 'rd-c-open',
      html: '<section class="slide rd-open" data-slide data-chapter-id="rd-c-open"><h1 class="rd-title" data-rd-reveal="rise" data-rd-seq="0">增长回来了，但发布要等修复</h1><p class="rd-big" data-rd-fact="derived:d-growth"><span class="rd-nb" data-rd-count>+28.6%</span></p><p data-rd-fact="f-total" data-rd-reveal="fade" data-rd-seq="2">共 12 项检查，9 项通过，3 项仍待修复。</p><p data-rd-fact="f-next" data-rd-step="1">下一阶段计划修复剩余 3 项检查，然后再讨论发布。</p></section>',
      css: '#rd-c-open{background:var(--rd-alt);color:var(--rd-alt-ink);min-height:80svh}@keyframes rd-glow{from{opacity:.4;width:10px}to{opacity:1}}.rd-big{animation:rd-glow 1s infinite}',
    },
    {
      id: 'rd-c-trend',
      html: '<section class="slide" data-slide data-chapter-id="rd-c-trend"><h2>三个季度持续增长</h2><div data-rd-switch="视图"><figure data-rd-view="营收趋势" data-rd-chart="rd-c-trend-line"><figcaption data-rd-fact="f-q1 f-q3">一季度营收 412 万元，三季度营收 530 万元。</figcaption></figure><div data-rd-view="增幅"><h3>前三季度增幅</h3><p data-rd-fact="derived:d-growth">+28.6%</p></div></div></section>',
      css: '.rd-x{color:red}',
    },
    {
      id: 'rd-c-checks',
      html: '<section class="slide" data-slide data-chapter-id="rd-c-checks"><h2>剩余三项检查决定发布节奏</h2><div data-rd-linked><figure data-rd-chart="rd-c-checks-units"><figcaption data-rd-fact="f-total">2026 年 10 月的原型验收共有 12 项检查，其中 9 项通过，3 项仍待修复。</figcaption></figure></div><p data-rd-fact="f-risk">移动端长表格仍有溢出风险。</p><details><summary>下一步</summary><p data-rd-fact="f-next">下一阶段计划修复剩余 3 项检查，然后再讨论发布。</p></details></section>',
      css: '',
    },
  ],
});
