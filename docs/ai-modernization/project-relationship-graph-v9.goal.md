# Project「关系」视图 v9 对齐 Goal 指令

日期：2026-09-24。本文件是供后续执行的指令，**创建文件本身不启动 Goal，也不授权
同步业务环境或发布远端**。实施契约为
[关系图 v9 对齐方案](project-relationship-graph-v9-implementation.zh-CN.md)。

> 2026-09-28：以下旧指令仅保留为历史记录，不应原样重新执行。其中项目分组、
> 同人不合并、缩放/平移和图上直接导航已被实施方案第 4 节的有限图契约替代。
> 有限图源码与验证结果见 `.codex-artifacts/project-finite-graph/REPORT.md`。

## 历史指令

```text
请创建并执行一个 Goal：按照 docs/ai-modernization/project-relationship-graph-v9-implementation.zh-CN.md，完成 LocalMind `/project` 总览「关系」视图的 v9 对齐。以独立 React + SVG 只读关系图和同源 HTML 工单清单替换当前临时 BlockSuite GFX 绘图，补齐真实数据投影、交互、权限与浏览器验收。Goal 只在全部 R01—R13 验收通过、无必需工作剩余时标记完成；不要把本指令本身当作已实施结果。

先检查 git status，保留用户和其他任务已有修改。读取根级及适用子目录 AGENTS.md、docs/ai-modernization/README.md 指定的必读文档，并完整读取本专项实施方案。复核当前前后端/GraphQL/路由和参考 v9 HTML 源码。旧 project-workbench-v9.goal.md 与 execution 记录是已完成的历史任务；本次已确认的独立 SVG 决定覆盖其中「优先 GFX」要求，箭头采用交付方向（接单人 → 发单人），不是旧 D13 的派单方向。其他 Project、工单、会话、资源、权限与 Docker 契约保持有效。

必须完成：
1. 服务端在现有 myCollaborationGraph 的 actor-scoped 投影中加入当前有效且属于本人的 WorkOrderDispatch 草稿，每个收件人一条关系。仅在 status=draft、expiresAt 晚于服务端当前时间、来源会话仍归本人且可读时返回；确认、过期、失权后移出。草稿只向发单人展示，不产生接单会话、通知或交付义务，不返回确认 token、原始 draft JSON、私人正文或额外项目资源。
2. 对已发送工单返回按原顺序排列的必交付项标题，以及来源会话、当前最新交付版本与 WorkOrderAdoptionItem 事实相符的展示状态。「已纳入上下文」须匹配对应源会话、actor、工单和当前交付 revision；旧版已采用而新版尚未采用时不得误标。保留 waiting_sender、validating、refused、cancelled 的独立真实状态。
3. 扩展 GraphQL schema/operation/generated types 与中英文 i18n，提供稳定关系 ID、项目/个人来源分类、双方、状态、草稿 expiry 和当前用户可用的导航目标。保留现有 from=发单人、to=接单人的 GraphQL 语义，在 SVG 视图模型中反向计算交付箭头；检查所有 myCollaborationGraph 消费者。按查询计划评估索引，若改变 Prisma schema 则新增迁移并验证升级。
4. 实现 v9 布局：按来源项目分组，每组本人居中，向我交付在左、我向他人交付在右；同人多单不合并；成员节点、工单标题、必交付项、状态与指向交付接收人的曲线箭头准确呈现。图和右侧工单清单使用同一份视图模型、筛选、顺序和导航。修复个人工单筛选与无项目来源点击无效的问题。
5. 实现缩小、放大、适应全图、仅空白拖动平移、现有滚轮缩放及键盘方向键/+/-/0；缩放限制 25%—200%。初次/筛选变化 fit，普通 resize 或业务状态刷新保持视角。图节点与右侧原生按钮均可点击和键盘操作，焦点、读屏名称、长文本与触控取消可用。只读图不写 Surface/YDoc，不注册共享同步或编辑命令。
6. 完成加载、空图、筛选空态、错误重试、截断、失效导航、窄屏堆叠和深浅主题。用户作用域工单事件、页面聚焦及重连后对账；客户端在草稿到期时及时移除过期关系，不能靠重启页面才收敛。

按方案 P0—P4 顺序推进，逐条验证 R01—R13。聚焦测试必须覆盖 A 发单人、B/C 收件人、D 无关用户，草稿过期/确认竞争、adoption 版本、取消/拒绝、项目失权、个人与 Workspace 来源导航、同人多单、500 上限和读屏/键盘等价路径。真实产品浏览器检查 1440/1040/760/390px、200% 页面缩放、浅深主题、长中文、缩放/平移/列表跳转；保存必要截图与操作证据。不能用 v9 静态 HTML 或单纯 mock 截图替代正式产品验收。

使用仓库既有 GraphQL/i18n 生成命令，不手改生成文件；运行相关 typecheck、oxlint、Prettier、git diff --check。遵守 docs/localmind-docker-development-constraints.md：优先复用 localmind-affine:test 与现有 Linux 容器做聚焦验证；只有需要时才按固定镜像角色构建，构建前检查 docker system df。新增迁移必须在隔离数据库验证空库全量和旧状态升级，不碰业务库。

不要启动子代理，不 commit、push、创建 PR、发布远端、同步当前业务容器或删除持久化数据。若用户以后另行要求同步，先执行仓库规定的备份与同平台验证，再用现有 localmind:sync 脚本。遇到可解决的工程问题继续推进；真实阻塞或新增权限范围须准确说明。最终以简体中文报告改动文件、R01—R13 结果、精确验证命令、浏览器和权限证据、是否重建镜像/磁盘状态、未解决风险。不要修改旧 v9 执行记录中的历史通过结论。
```
