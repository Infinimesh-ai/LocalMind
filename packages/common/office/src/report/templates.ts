import { type ReportTemplate, ReportTemplateSchema } from './schema';

type Layout = ReportTemplate['chapters'][number]['layout'];
type Definition = {
  key: string;
  name: string;
  audience: ReportTemplate['audience'];
  durationMinutes: number;
  description: string;
  prompt: string;
  theme: Partial<ReportTemplate['theme']>;
  chapters: [title: string, layout: Layout, question: string][];
};

const definitions: Definition[] = [
  {
    key: 'periodic',
    name: '周期进展汇报',
    audience: 'team',
    durationMinutes: 10,
    description: '每周或每个迭代同步团队进展：成果、进度、阻塞与下期计划。',
    prompt:
      '面向项目成员的例行同步。先用一句话给出本期总体状态，再按成果、进度、阻塞展开；进度尽量量化，阻塞写清负责人与需要的帮助。',
    theme: {
      name: '暖白 · 琥珀',
      background: '#f6f4ef',
      foreground: '#1b2733',
      accent: '#c8862a',
    },
    chapters: [
      [
        '本期总体结论',
        'cover',
        '用一句话概括本期整体状态，并给出 2—3 个关键数字。',
      ],
      [
        '本期成果',
        'gallery',
        '列出本期完成并可验证的成果，每项注明对应文档或工单。',
      ],
      [
        '成员进度',
        'timeline',
        '按时间顺序说明各成员或工作流的推进情况与当前进度。',
      ],
      [
        '风险与阻塞',
        'content',
        '列出影响进度的风险和阻塞，注明负责人和需要的支持。',
      ],
      ['下一期计划', 'timeline', '给出下一期的目标、关键事项和时间节点。'],
    ],
  },
  {
    key: 'management',
    name: '管理者决策汇报',
    audience: 'management',
    durationMinutes: 5,
    description: '向管理层要决策：结论先行，只讲偏差、风险和需要拍板的事。',
    prompt:
      '面向管理层，时间很短。结论先行，少讲过程；每个风险都要给出影响和建议；待决策事项写成可直接选择的选项，并注明截止时间。',
    theme: {
      name: '藏青 · 金',
      background: '#1b2733',
      foreground: '#f3f5f8',
      accent: '#e3b04b',
    },
    chapters: [
      ['结论与建议', 'cover', '用三句话以内给出结论和最重要的建议。'],
      [
        '计划偏差',
        'comparison',
        '对比计划与实际的范围、进度和成本，说明偏差原因。',
      ],
      ['重要风险', 'content', '列出最多三项重要风险，给出影响程度和应对建议。'],
      ['资源需求', 'content', '说明需要追加或调整的人力、预算或外部支持。'],
      [
        '待决策事项',
        'comparison',
        '把需要管理层决定的事项写成可选方案，并注明截止时间。',
      ],
    ],
  },
  {
    key: 'customer',
    name: '客户阶段成果汇报',
    audience: 'customer',
    durationMinutes: 15,
    description: '向客户展示阶段交付：目标、成果演示、待确认事项与后续安排。',
    prompt:
      '面向客户，语气专业友好。避免内部用语、成员绩效和内部风险细节；成果以客户价值表述，并配合截图或数据展示；待确认事项写清需要客户做什么。',
    theme: {
      name: '纯白 · 品牌蓝',
      background: '#ffffff',
      foreground: '#1f2a37',
      accent: '#2f6fed',
    },
    chapters: [
      ['阶段目标', 'cover', '说明本阶段约定的目标和范围。'],
      ['交付成果', 'content', '逐项说明已交付的成果及其对客户的价值。'],
      ['成果展示', 'gallery', '用截图、图表或数据展示关键成果。'],
      ['待确认事项', 'content', '列出需要客户确认或配合的事项和期限。'],
      ['后续安排', 'timeline', '给出下一阶段的里程碑和时间安排。'],
    ],
  },
  {
    key: 'milestone',
    name: '里程碑与验收汇报',
    audience: 'management',
    durationMinutes: 10,
    description: '里程碑节点或验收会使用：逐项对照验收要求，给出完成证据。',
    prompt:
      '用于验收。逐项对照验收要求给出完成证据和来源，未完成或有差异的项目必须单独列出，不得笼统带过。',
    theme: {
      name: '浅绿 · 森林',
      background: '#f3f6f4',
      foreground: '#17322a',
      accent: '#2f7d5b',
    },
    chapters: [
      ['里程碑概览', 'cover', '说明本里程碑的目标、时间和总体验收结论。'],
      ['验收要求', 'content', '列出本次验收的要求和判定标准。'],
      [
        '逐项完成证据',
        'comparison',
        '逐项对照验收要求，给出完成情况和对应证据。',
      ],
      ['未完成项与差异', 'content', '列出未完成或与要求有差异的项目及原因。'],
      ['后续处理', 'timeline', '说明未完成项的处理计划、负责人和时间。'],
    ],
  },
  {
    key: 'closure',
    name: '项目结项汇报',
    audience: 'customer',
    durationMinutes: 15,
    description: '项目收尾时使用：目标达成情况、最终交付、遗留事项与交接维护。',
    prompt:
      '用于项目结项。对照最初目标说明达成情况，完整列出最终交付物；遗留事项和维护安排要具体到负责人与期限。',
    theme: {
      name: '米白 · 赭石',
      background: '#fbfaf7',
      foreground: '#2a2622',
      accent: '#8a5a2b',
      fontFamily: 'serif',
    },
    chapters: [
      ['项目回顾', 'cover', '概括项目背景、周期和整体结论。'],
      ['目标达成', 'comparison', '对比最初目标与最终结果，说明达成情况。'],
      ['最终交付', 'gallery', '列出全部最终交付物及其位置。'],
      ['遗留事项', 'content', '列出尚未关闭的事项、原因和处理方式。'],
      ['交接与维护', 'timeline', '说明交接对象、维护责任和关键时间点。'],
    ],
  },
  {
    key: 'retrospective',
    name: '项目复盘',
    audience: 'team',
    durationMinutes: 30,
    description:
      '项目或阶段结束后的团队复盘：计划与实际、做得好的、问题原因与改进。',
    prompt:
      '用于团队复盘，对事不对人。重点分析原因而不是追责；有效做法和改进行动都要可复用、可执行，并注明负责人。',
    theme: {
      name: '暖橙',
      background: '#fff8f3',
      foreground: '#3a2a22',
      accent: '#d0603a',
    },
    chapters: [
      ['复盘范围', 'cover', '说明复盘的项目、阶段和参与人。'],
      ['计划与实际', 'comparison', '对比计划与实际的时间、范围和结果。'],
      ['关键决策回顾', 'timeline', '按时间列出关键决策及其效果。'],
      ['有效做法', 'content', '总结值得保留和推广的做法。'],
      ['问题及原因', 'content', '分析主要问题的根本原因，不针对个人。'],
      ['改进行动', 'content', '列出具体改进行动、负责人和完成时间。'],
    ],
  },
];

export const BUILTIN_REPORT_TEMPLATES: readonly {
  key: string;
  content: ReportTemplate;
}[] = definitions.map(definition => ({
  key: definition.key,
  content: ReportTemplateSchema.parse({
    name: definition.name,
    audience: definition.audience,
    durationMinutes: definition.durationMinutes,
    description: definition.description,
    prompt: definition.prompt,
    theme: definition.theme,
    chapters: definition.chapters.map(([title, layout, question], index) => ({
      key: `${definition.key}-${index + 1}`,
      title,
      question: `${question}保留依据；未记录的事实明确说明。`,
      layout,
    })),
  }),
}));
