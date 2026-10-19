# LocalMind 网页汇报设计说明

本包采用固定版本 huashu-design 的题材分析、构图、字体与视觉复核方法，按 LocalMind 一次提交的响应式网页契约改编。来源提交、文件校验值与适配版本见 manifest.json，原许可证见 LICENSE.upstream。

## 引擎版本

- **v4（新任务默认）**：`generation-v4.ts`。证据模型（事实 + 数据集 + 关系）→ 体验计划（叙事、构图原型、token、图表、动效、交互）及 Plan Lint → HTML/CSS/声明式行为文本包 → 受信运行时与服务端图表组件组装 → 浏览器剧本检查（静态多视口、全篇缩略图、行为剧本、动效帧序列、无脚本与打印回退）→ 静态与动态审查 → 结构性修正 → 成对择优。设计知识按阶段注入，见 `skill-v4.ts`（片段 hash 写入运行快照），提示词见 `prompts-v4.ts`（`Report Web * v4`）。
- **v3 / v3.1（冻结快照）**：`generation.ts` 中的原流程，仅用于已带 v3 快照的运行恢复；不再为新任务创建。

两个引擎都以 `generation_version=3` 存储，按运行快照的 `version` 路由；已保存 HTML 不改写。

## 边界

执行规则由 LocalMind 的权限、预算、净化器和受控浏览器决定。模型不输出脚本；动效与交互只能通过 `data-rd-*` 声明，由外壳中按 CSP hash 授权的固定运行时执行（`@localmind/office/report-deck` 的 `runtime.ts`）。图表数值、比例与刻度由应用根据数据集渲染，派生值由应用计算并记录公式。不执行上游脚本、不加载个人偏好文件、不访问外部素材。

运行通过版本化 DB 提示词解析并固定有效快照，不从宿主机技能目录读取。完整契约与验收见 `docs/localmind-report-deck-web-v4.zh-CN.md`。
