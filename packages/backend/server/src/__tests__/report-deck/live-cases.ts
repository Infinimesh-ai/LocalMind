/**
 * Fictional, fixed source material for opt-in live comparisons of report
 * generation. Covers data-heavy, process-heavy, text-heavy and thin input
 * with different style requests so outputs can be compared across engines.
 */
export type LiveCase = {
  key: string;
  title: string;
  markdown: string;
  length: 'short' | 'standard' | 'long';
  purpose: 'periodic' | 'progress' | 'customer' | 'decision' | 'retrospective';
  audience: 'team' | 'management' | 'customer';
  customStyle: string;
  instructions: string;
  /** Literal values that must survive into the delivered HTML. */
  mustInclude: string[];
};

export const LIVE_CASES: LiveCase[] = [
  {
    key: 'atlas',
    title: 'Atlas 验证资料（全部虚构）',
    markdown:
      '# Atlas 原型验证\n以下全部为虚构测试材料，不涉及真实业务或个人。\n## 已完成\n2026 年 10 月的原型验收共有 12 项检查，其中 9 项通过，3 项仍待修复。\n文档模块已经完成离线预览验证。\n同步模块已经完成断网重连验证。\n## 风险\n移动端长表格仍有溢出风险。\n中文字体回退还需要在 Linux 环境完成验证。\n## 下一步\n下一阶段计划修复剩余 3 项检查，然后再讨论发布。\n发布时间尚未确定，负责人未指定，不要补写。',
    length: 'standard',
    purpose: 'progress',
    audience: 'team',
    customStyle:
      '有强烈视觉冲击力的技术发布简报。沿用暖白、深墨绿和橙色，允许深墨绿大面积底色与橙色重点图形。首屏像数据海报，有鲜明主视觉、不对称构图、清晰字体对比；证据章用真正的图形编码呈现数量与状态。',
    instructions:
      '用清晰的证据图解区分已完成、风险和下一步，不虚构指标、负责人或截止日期。',
    mustInclude: ['12', '9', '3'],
  },
  {
    key: 'data',
    title: '星河零售 2026 年三季度经营月报（虚构）',
    markdown: `# 星河零售 2026 年三季度经营回顾
本文为虚构演示材料。
## 营收
7 月营收 1,240 万元，8 月营收 1,385 万元，9 月营收 1,612 万元。
三季度营收目标为 4,500 万元，实际完成 4,237 万元。
## 渠道
9 月线上渠道营收 702 万元，门店渠道营收 618 万元，企业团购营收 292 万元。
线上渠道 9 月同比增长 41%，门店渠道 9 月同比下降 6%。
## 客户
9 月活跃会员 18.6 万人，其中新增会员 2.3 万人。
会员复购率从 6 月的 31% 提升到 9 月的 37%。
## 成本与利润
三季度毛利率为 34.5%，二季度毛利率为 32.1%。
物流成本占营收比例在 9 月为 7.8%，高于 6 月的 6.9%。
## 风险
华东仓 9 月出现两次缺货，影响约 1,100 笔订单。
门店渠道客流连续三个月下滑。
## 待决事项
是否在 11 月前追加华东仓备货预算，需要管理层决定。
四季度目标是营收 5,200 万元。`,
    length: 'standard',
    purpose: 'periodic',
    audience: 'management',
    customStyle:
      '面向管理层的经营汇报，克制、专业、可信。冷静的蓝灰色系，少量强调色只用于风险与决策。数据要一眼看懂对比关系，避免花哨装饰。',
    instructions:
      '先给结论：增长来自线上，门店与仓储是风险。必须清楚区分目标与实际，最后落到需要管理层决定的事项。',
    mustInclude: ['1612', '4237', '702'],
  },
  {
    key: 'process',
    title: '数据平台迁移项目进展（虚构）',
    markdown: `# 数据平台迁移项目进展
本文为虚构演示材料。
## 路线
迁移分为五个阶段：盘点、双写、校验、切流、下线旧集群。
盘点阶段已于 8 月完成，共梳理 146 个数据任务。
双写阶段已于 9 月完成，覆盖全部 146 个数据任务。
校验阶段正在进行，目前已校验 98 个任务，其中 91 个结果一致。
切流计划在 11 月开始，前提是校验通过率达到 99%。
下线旧集群计划在 12 月进行。
## 依赖
切流依赖权限系统改造完成；权限系统改造由安全团队负责，预计 10 月底交付。
报表服务必须在切流前完成查询语法适配。
## 问题
7 个校验不一致的任务集中在财务口径，原因是时区处理不同。
旧集群的存储费用每月约 38 万元，下线越晚成本越高。
## 需要支持
需要财务团队在两周内确认时区口径。`,
    length: 'standard',
    purpose: 'progress',
    audience: 'team',
    customStyle:
      '工程团队内部的路线图式汇报，像一张清晰的行进地图。可以有活力，用阶段与依赖关系的图解代替段落。',
    instructions:
      '让读者看清每个阶段的位置、阻塞点和依赖关系，并说明切流前还差什么。',
    mustInclude: ['146', '98', '91'],
  },
  {
    key: 'text',
    title: '社区医院数字化合作案例（虚构）',
    markdown: `# 青禾社区医院数字化合作复盘
本文为虚构演示材料。
## 背景
青禾社区医院服务周边约 6 万名居民，过去挂号依赖窗口排队，老年患者高峰期平均等待超过 40 分钟。
医院希望在不增加人手的前提下改善就诊体验。
## 我们做了什么
项目团队先在门诊大厅连续观察两周，记录患者从进门到就诊的每一步。
我们发现最大的阻塞不是挂号本身，而是患者不清楚该去哪个窗口、带哪些材料。
于是方案从“上线一个挂号系统”调整为“重新设计到院路径”：入口处设置引导员，挂号单上印就诊路线，老年患者保留人工窗口。
## 结果
上线三个月后，高峰期平均等待时间降到 18 分钟。
患者满意度调查中，“知道下一步去哪里”的比例从 52% 提高到 86%。
医院没有增加挂号窗口人员。
## 经验
护士长说：“真正改变的是我们开始从患者的视角看流程。”
最难的部分是说服团队先观察、再动手。
## 下一步
医院计划把同样的方法用于检验科取报告流程。`,
    length: 'short',
    purpose: 'customer',
    audience: 'customer',
    customStyle:
      '面向客户的案例故事，温暖、有人情味，像一篇有设计感的杂志特稿。用引语与对比讲故事，不要仪表盘风格。',
    instructions:
      '讲清楚从“上线系统”到“重新设计路径”的转折，数据作为证据而不是主角。',
    mustInclude: ['40', '18', '86'],
  },
];
