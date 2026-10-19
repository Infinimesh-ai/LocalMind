# Project 汇报工作台执行记录

契约：[完整开发文档](project-report-workbench-development.zh-CN.md)。

2026-10-13：W01—W09 已接入源码，以下 A01—A60 的聚焦验证、真实模型及隔离环境验收已完成。首轮验收未升级日常运行实例；后续本地热启动修复与同步见末节，未发布生产镜像。仓库整体 TypeScript 检查仍有两处未改动的既有测试错误，详见末节；任务涉及的生产源码及汇报测试类型检查通过。

## 环境与交付边界

- 工作区：`/Users/dev2/Documents/project/LocalMind`；保留所有既有未提交改动。前期采用并行实现，本轮按用户要求中断全部子代理，由本对话直接完成收尾。
- 首轮验收未 commit、push、创建 PR、同步业务容器或部署；后续本地热启动修复与同步见末节。无新增公开 MCP 能力，无 Workspace / 用户凭据回退。
- Linux：复用 `localmind-affine:dev-base`；本地无 `localmind-affine:test`，未为本任务重建镜像或创建专项 tag。容器为 `localmind_report_validation`、`localmind_report_mail_validation`；原生构建在 `localmind_report_native_validation` 完成。
- PostgreSQL：`localmind_report_validation_pg` 的独立 tmpfs 数据库；Redis：`localmind_report_validation_redis`，均与业务环境隔离。源码绑定 `/workspace`，复用只读依赖卷，Prisma Client、配置、存储、缓存和原生构建使用任务独立目录。
- 邮件验证挂载本任务当前 Linux native addon，未替换业务 addon。实际 Mailer / MailJob 仅发送到容器内 loopback SMTP sink，不向真实收件人发信。
- 用户明确授权临时读取实例全局 Project BYOK 与解密私钥，仅用于虚构文档验收。隔离 fixture 权限为 `0600`，测试后文件已删除，隔离 `ai_project_byok_config` 记录数为 **0**。凭据不包含在交付文档和普通日志中。
- 本轮开始 Docker 占用：images 25.14 GB、containers 2.881 GB、volumes 17.13 GB、build cache 12.49 GB。最终 `docker system df`：images 25.71 GB、containers 2.921 GB、volumes 17.13 GB、build cache 13.21 GB。这是共享 Docker 的观测值；本任务未删除业务数据、volume 或无关镜像，未构建新镜像。

## 本轮修复

1. PDF 空页不再因页码标签冒充可提取内容；损坏 PDF 的非 Error 异常映射为有界业务错误。
2. 请求及冻结状态按规范化结构比较，避免 PostgreSQL JSONB 键序导致错误拒绝；重复键不同输入仍拒绝。
3. 真实模型复验发现跨章节重复节点 ID，现按章节及事实身份生成稳定 ID，不改写来源证据。
4. 同项目并发刷新只接受最新响应，最新失权会清除保护状态，旧响应不能恢复；写操作提供 pending / error，阻止重复提交。
5. 演示指示笔与坐标同步至受绑定的观众窗口，清除离开坐标，拒绝恶意 origin / window / nonce / revision 与畸形 pointer。
6. 评论持久保存章节锚点，重排节点保持引用，正文修改或目标删除明确标记失效；回复保留原评论版本。新增迁移 `20261013010000_project_report_comment_anchors`，不猜测旧评论章节。
7. 周期页返回模板、成员、资料以及计划使用的旧模板版本；修改模板时重新选择对外章节。成员按姓名选择，外部账号分享通过注册邮箱解析，最终冻结为账号身份；服务端仍检查项目成员、目标账号、版本和范围。
8. 历史回补使用计划时区并检查半开区间；页面展示周期使用指定时区的可读日期。资料选择器达到 1,000 项显示边界说明，完整生成继续分页枚举。
9. 归档项目和禁用能力的写入口明确禁用。列表组件独立于产品壳，复用同一 API / service；未另建数据层或设计系统。

## 实现所有权

| 范围                                 | 主要源码                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 领域、持久化、不可变证据         | `src/models/project-report*.ts`、`schema.prisma`、7 个 report 迁移                                                                                       |
| W02 模板、创建、事实和负责人         | `src/core/project-report/content.ts`、`source-service.ts`、`project-report.ts`、Office report schema / templates                                         |
| W03 八阶段生成、检查点、取消重试     | `src/plugins/copilot/report-generation-{service,policy}.ts`、`src/models/project-report-generation*.ts`                                                  |
| W04 编辑、评论、审阅、租约、历史     | `src/core/project-report/service.ts`、`project-report-collaboration.ts`、前端 `reports/editor.tsx` / `node-editor.tsx` / `project-reports/edit-state.ts` |
| W05 单屏、双屏、离线                 | 前端 `reports/presentation.tsx`、`project-reports/presentation.ts`、Office `report/render.ts` / `export-offline.ts`                                      |
| W06 PDF / 可编辑 PPTX / 原生保存     | `src/core/project-report/export.ts`、`report-export-adapter.ts`、Office `report/pdf.ts` / `pptx.ts` / `render.ts`                                        |
| W07 受控分享及下载                   | `src/core/project-report/share.ts` / controller、`project-report-share.ts`、`reports/output-panel.tsx` / `shared.tsx`                                    |
| W08 周期、授权交集、分发和不确定回执 | `src/core/project-report/schedule.ts`、`project-report-schedule*.ts`、`report-schedule-adapter.ts`、MailJob / notification                               |
| W09 迁移、生命周期、实时、协议和回归 | `project-report-lifecycle.ts`、`project/realtime.ts`、共享 GraphQL operations、前端路由、下列验证                                                        |

服务端路径相对于 `packages/backend/server/`；前端页面位于 `packages/frontend/core/src/desktop/pages/intelligence/reports/`，模块位于 `packages/frontend/core/src/modules/project-reports/`，Office 位于 `packages/common/office/src/report/`。

## 验证结果与证据索引

证据根目录为 `.codex-artifacts/project-report-resume/`（本轮）及 `.codex-artifacts/project-report-workbench/`（前期，以下简称原目录）。重叠复验不累计为更多独立测试。

| 代号 | 实际验证与日志                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B    | `root/report-and-original-linux-final.log`：69 项 Linux 后端汇报及原会话、编辑租约、实时、原生资源、工单回归通过。后续改动的 workbench / API 16 项在 `root/workbench-api-completion-linux.log` 再次通过；周期 / SMTP 在 `root/affected-linux-final.log` 通过，该日志内新增成员顺序断言曾失败，修正后 API 全部通过，未计失败轮为成功。                                                                                                    |
| G    | `generation/sources-generation-linux-recheck.log`：来源 2 项、生成及周期 6 项通过；`generation/policy-linux-final.log`：负责人、公式、覆盖、注入、DST、授权交集 smoke 通过。                                                                                                                                                                                                                                                             |
| F    | `generation/finalizer-gates-linux-final.log`：新增 3 项完整 finalizer worker 测试通过，真实 revision、租约、occurrence 和 delivery 状态验证；候选内容与 provider 可用性使用受控 fixture，模型质量另由 M 验证。B + 新增 F 共覆盖 72 项独立后端测试。                                                                                                                                                                                      |
| M    | `generation/live-six-independent-linux.log`：6 类独立真实 Project BYOK 场景通过：默认负责人、明确负责人、冲突、空资料、长资料、恶意文档。空资料 0 模型调用并明确缺失；其余使用真实全局 provider。明确负责人遇一次 provider 空输出，原 run 保留检查点重试后通过；长材料约 55 秒 / 4 次调用，恶意文档约 27 秒 / 2 次调用，无分享或分发副作用。                                                                                             |
| U    | `frontend/report-ui-completion.log`：30 项汇报 UI / API / hook / 演示测试通过；另有 `frontend/editor-recovery-complete.log` 的 2 项输入法／网络失败重试测试通过，共 32 项报告测试。最新 `frontend/subagent-current-33-tests.log`：同一范围 7 个文件共 33 项通过，新增离组负责人冻结姓名与身份不变的回归；不与前轮重复累计。`frontend/report-original-ui-final.log`：前一组合 80 项包含 26 项报告和 54 项原会话、文件、项目列表回归通过。 |
| O    | `exports/office-linux-17-final.log`：17 项 Linux Office report 测试通过；`exports/export-smoke-linux.log`：导出资产规范化和边界 smoke 通过。                                                                                                                                                                                                                                                                                             |
| V    | 实际 API + CUA 浏览器：中文保存刷新、固定版本演示、前期 Chrome 双窗口及独立 Electron 39 BrowserWindow；本轮实际创建周期计划、暂停后刷新、模板及成员选项、创建窗口、账号分享可操作、窄屏深色检查。截图 `frontend/schedules-saved-final.jpg`、`schedules-dark-narrow.jpg`、`editor-dark-narrow.jpg`、`editor-share-final.jpg`。浏览器验收 harness 使用产品组件及真实隔离 API，并补齐产品的环境初始化与根主题壳。                           |
| P    | 原目录 `frontend-perf-30.json` / `frontend-perf-100.json`：Chrome/155、1708×889 视口下，Vite 开发服务导航到首屏 782.1 / 968.8 ms，未清除浏览器及模块缓存，不作为严格冷启动结果；已加载翻页 P95 7.3 / 6.7 ms。1001 份报告分页 11 页无重复，首查询及 P95 353.8 ms；1005 个固定资源版本在 G 中全量枚举并明确覆盖预算。                                                                                                                      |
| D    | `root/migrate-416-clean.log` / `migrate-416-upgrade.log`：最终 416 迁移从空库及旧库成功；`root/upgrade-416-preservation.log`：15 类旧域记录逐字段不变（脚本输出沿用旧的“14”字样，实际列表为 15 类）。                                                                                                                                                                                                                                    |
| R    | 原目录 PostgreSQL dump/restore 与 SQLite Blob 备份；最终 `root/restore-416-migrate.log` / `restore-416-verify.log`：4 版本、4 Blob、6 模板、1 分享、1 暂停计划可恢复。关闭功能后历史读成功、新写拒绝、分享重开、重复分发为 0。                                                                                                                                                                                                           |
| T    | `root/backend-office-types-complete.log`、`frontend/types-complete.log`、`root/workbench-types-complete.log`、`api-types-complete.log`、`generation/types-gates-complete.log`：任务源码和报告测试类型检查通过；新增 editor 测试复核见 `frontend/types-with-editor-complete.log`；真实 Prisma、GraphQL、i18n 生成；`root/ox-complete.log` 和最终格式检查通过。整体 tsc 的既有基线见末节。                                                 |

## A01—A60 逐项追踪

下表的“通过”限定为对应源码与隔离验证，不包含业务环境升级或生产数据验收。浏览器、worker、真实模型、导出和数据库证据各自独立，不以生成文件或模拟模型替代真实模型场景。

| 项目               | 状态             | 源码与行为证据                                                                                                                      |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A01 入口与深链     | 通过             | 前端 router / route-paths，真实 GraphQL 项目绑定 B，V 的直接打开及刷新。                                                            |
| A02 创建与列表     | 通过             | content / list，空白与生成创建、分页、同键复用 B/G，列表及创建窗 V。                                                                |
| A03 汇报默认负责人 | 通过             | document / content，creator_fallback 落库 B；默认选项 V；真实样本 M。                                                               |
| A04 事项默认负责人 | 通过             | generation-policy，默认为报告创建人，非文档作者 G/M。                                                                               |
| A05 明确负责人     | 通过             | 显式及外部身份、重名、已退出成员保留和新指派拒绝 B/U/M。                                                                            |
| A06 他人编辑与重试 | 通过             | creator 身份不可漂移，修订及 retry B/G。                                                                                            |
| A07 复制与上期     | 通过             | 新报告 creator 与 fallback 重绑、保留明确责任 B；list 入口 V。                                                                      |
| A08 周期身份与退出 | 通过             | schedule 冻结真实委托身份、退出暂停、删除身份保留 B/G。                                                                             |
| A09 私人来源排除   | 通过             | source-service 不读取聊天、私有附件或滚动摘要；标记来源反向测试 G。                                                                 |
| A10 文档进度规则   | 通过             | 事实提取不以编辑次数、作者、聊天活跃度判定进度 G/M。                                                                                |
| A11 多类型固定来源 | 通过             | Page / Edgeless / Office / PDF / 原生文本解析、版本和定位 G。                                                                       |
| A12 无法读取文件   | 通过             | 损坏、密码、空白／扫描 PDF 准确表示失败或需 OCR，不外发做 OCR G。                                                                   |
| A13 全量与预算     | 通过             | 1005 项完整分页、固定版本、覆盖不足显式呈现 G/P；picker 上限说明 U/V。                                                              |
| A14 时区与截止     | 通过             | 周起始、半开区间、历史不可重建、DST G；回补指定时区 U；展示日期 O/V。                                                               |
| A15 工单隔离       | 通过             | 正式状态与授权回执门禁、私人草稿排除 G，原工单回归 B。                                                                              |
| A16 事实与冲突     | 通过             | 缺失不作零、计划不作完成、冲突可定位 G/O/M。                                                                                        |
| A17 计算与图表     | 通过             | 公式、分母、单位、来源、空值、极大数值溢出及图表工作簿 O/G。                                                                        |
| A18 Memory 与上期  | 通过             | 项目共享贡献及授权来源，上期只比较，不作为循环来源 G/B。                                                                            |
| A19 内置模板       | 通过             | 六种真实模板结构与受众参数 B/O；实际选择 V。                                                                                        |
| A20 自定义模板     | 通过             | 不可变版本、复制／停用／品牌、旧计划模板冻结 B/U/V。                                                                                |
| A21 提示注入       | 通过             | 不可信材料隔离及严格结构 G；恶意文档真实 provider 无外发 M；包内注入 O。                                                            |
| A22 编辑与保存     | 通过             | edit-state 撤销重做、IME、自动保存与恢复，版本冲突 U；中文保存刷新 V。                                                              |
| A23 局部改写与锁定 | 通过             | 范围与锁保持，三方合并增删移动及冲突 O/G/U。                                                                                        |
| A24 章节及锚点     | 通过             | 稳定章节／节点、评论重排仍有效、文本修改和删除失效、原版本回复 B/U。                                                                |
| A25 协作与审阅     | 通过             | 成员权限、评论 CAS、指定审阅者、版本漂移 B；评论／审阅入口 V。                                                                      |
| A26 编辑租约       | 通过             | 用户与 AI 互斥、过期接管、旧 lease 拒绝 B/G/F。                                                                                     |
| A27 定稿与历史     | 通过             | 不可变约束、单调序号、历史恢复为新草稿 B，固定版本读取 V/R。                                                                        |
| A28 更新与对比     | 通过             | 来源变化提示、候选人工采用及上期比较 B/G/U，不自动覆盖人工正文。                                                                    |
| A29 单屏演示       | 通过             | 键盘／全屏／目录／黑屏／退出／焦点 V，指示笔 U。                                                                                    |
| A30 双屏演示       | 通过             | 前期 Chrome 双窗口 V；current / next / notes / timer；受绑定的指示笔同步 U。                                                        |
| A31 演示稳定性     | 通过             | 固定 revision，观众投影排除备注及身份 B/O/U；失权在线读取拒绝 B。                                                                   |
| A32 离线包         | 通过             | file:// + Chromium 网络 offline，内置字体／素材、翻页与黑屏；O 包内容及 CSP 检查。                                                  |
| A33 PDF            | 通过             | PDF.js 简繁中文提取、字体嵌入 O；最新 6 页 Poppler 检查，无裁切或溢出。                                                             |
| A34 可编辑 PPTX    | 通过             | 原生文本／表格／图表；实际 native edit-save-reopen O，LibreOffice 打开另存重开且修改文本、表格及图表值保留，见下节。                |
| A35 导出兼容       | 通过             | 正文预览、CJK 字体替代提示 O/V；LibreOffice 重存结构差异明确记录，不声称所有 Office 软件行为相同。                                  |
| A36 原生保存       | 通过             | 实际 PPTX 导入 OfficeRevision、重放仅一份、旧 parent revision 拒绝、正确更新产生第二版 B。                                          |
| A37 分享范围       | 通过             | 固定定稿、明确章节／受众预览、创建与定稿不自动分享 B/V。                                                                            |
| A38 最小公开投影   | 通过             | HTTP/JSON、离线文本、PDF metadata、PPTX XML 与嵌入工作簿白名单 B/O。                                                                |
| A39 分享认证       | 通过             | 指定账号及注册邮箱、匿名策略、密码、有效期和限流 B；成员姓名 UI V。                                                                 |
| A40 撤销与下载     | 通过             | 旧 Cookie / 旧分享版本失效、禁下载、在线重新授权 B；已下载副本边界 V。                                                              |
| A41 越权组合       | 通过             | 跨 Project / report / revision / export / share、伪造 actor、非成员和退出成员 B。                                                   |
| A42 周期与 DST     | 通过             | 缺失时刻顺延、重复时刻一次、月末及周期范围 G；非法用户壁钟时间拒绝 U。                                                              |
| A43 计划版本与补跑 | 通过             | 版本冻结、停机 missed 记录、手动区间和幂等 occurrence G/B；时区回补 U。                                                             |
| A44 自动定稿       | 通过             | 真实 finalizer worker：verified 产生 final / delivery，unresolved / incomplete 停 needs_review 无 delivery F；模型质量 M 单独验证。 |
| A45 分发授权       | 通过             | 通道／收件人／附件／有效期授权交集 G；真实 Mailer 发送 PDF 至 loopback、排队后撤权拦截 B。                                          |
| A46 发送不确定     | 通过             | 丢失 SMTP ack → unknown，无盲重发，人工核对 CAS 和已发事实保留 B。                                                                  |
| A47 后台恢复       | 通过             | 持久八阶段检查点、重试、worker lease 接管，不依赖打开页面 G/B。                                                                     |
| A48 取消迟到结果   | 通过             | 跨成员关联 run 精确取消、旧 lease 及 checkpoint 迟到写拒绝 G/B；已发生发送不伪装撤销 B。                                            |
| A49 幂等失败       | 通过             | 同键同输入复用、不同输入拒绝、检查点 Blob 及 JSONB 比较、失败不毁旧版本 B/G。                                                       |
| A50 全局 BYOK      | 通过             | 原 Project 会话配置缺失／停用、无 Workspace 回退 B；六类全局 provider 真调用及凭据清理 M。                                          |
| A51 归档回收恢复   | 通过             | 归档只读并保留已授权查看；回收取消运行、暂停计划、撤销分享，恢复不重开旧链接 B/R。                                                  |
| A52 用户项目删除   | 通过             | 最后 Owner 约束、身份快照、legal hold、延迟 Blob GC、源文档保留、已发事实保留 B。                                                   |
| A53 实时及缓存     | 通过             | scope-bound replay、实时退出过滤、内容空载荷、重复投递；最新失权清缓存，旧响应不能恢复 B/U。                                        |
| A54 安全与日志     | 通过             | 有界异常、凭据清理；MIME 冒充、EXIF 路径、像素／字节／ZIP 炸弹、SVG、URL 和令牌边界 O/G/B。                                         |
| A55 主题与可访问性 | 通过             | Web、独立 Electron BrowserWindow，深浅色、390px 窄屏、键盘／焦点 V/U；无横向溢出，无新增必须播放的动画。                            |
| A56 大数据及性能   | 通过             | 1001 报告分页、1005 来源、30 / 100 页 fixture，列表 <1s、翻页 <100ms；冷加载及模型延迟独立记录 P/M。                                |
| A57 空库旧库迁移   | 通过             | 全部 416 迁移，15 类旧 Project / Office / 工单等数据逐字段保留 D。                                                                  |
| A58 备份恢复回退   | 通过             | 数据库 + SQLite Blob 恢复并在最终迁移后复核，历史／分享可读、新写拒绝、无重复分发 R。                                               |
| A59 协议一致       | 通过             | Prisma、Nest schema、共享 GraphQL / i18n 真实生成，实际 API 严格校验及前端消费 B/T/V。                                              |
| A60 完整回归       | 通过（任务范围） | W01—W09 已接入，无占位业务入口；72 项后端、32 项报告 UI、54 项原 UI、17 项 Office 及 smoke；整体 tsc 两项既有基线另记。             |

## 导出复核与兼容边界

- 最新样本：原目录 `report-fixture.pdf`、`report-fixture.pptx`、`report-fixture.zip`。日期已按 Asia/Shanghai 格式化。`exports/pdf-latest-all.png` 为最终六页联系表，文字、表格、两类图表、独立图片和选择性备注均无溢出裁切。
- PDF 包含可检索 CJK 字体，完整 OTF 约 14 MB；随仓库提供 SIL OFL 许可及固定哈希，运行时不下载字体。PDF.js 的两条首字形复制空间提示未影响独立提取断言；Poppler 渲染无字体告警。
- `exports/reopen-compatible-edited-final.log`：既有 Office `applyPptxCommand` 修改简繁中文文本、保存新包、重开验证；native 保存时两份图表及嵌入工作簿字节保持一致。LibreOffice 再打开并另存，5 张幻灯片、原生表格、2 个图表及其数值、修改文本重开成功。
- LibreOffice 另存会把图表数据保留在 chart XML cache，并移除原输出中的嵌入 XLSX（实测 0 个）；不能据此声称跨编辑器原始 package 字节完全一致。LocalMind 原输出具有 2 个独立可编辑工作簿，native 保存保持它们。CFF 字体未嵌入 PPTX，UI / 导出结果明确提示阅读器字体替代。
- 前期断网离线检查见原目录 `offline-check.cjs` / `offline-browser.png`。`connect-src 'none'`，图片、字体、脚本来自包内，默认不含备注、评论、凭据或内部身份；本轮 O 复查当前 ZIP 白名单及字体。
- 公开 render 只接受已授权的资产字节，不抓取外部 URL，不解压用户图片归档。图表工作簿中的公式形字符串保持普通文本，无外部关系。

## 实际验证命令

以下命令对应上述日志，后端数据库测试串行运行，避免互相 TRUNCATE。

```sh
docker exec -w /workspace/packages/backend/server \
  -e 'NODE_OPTIONS=--max-old-space-size=6144 --import /workspace/tools/cli/register.js' \
  localmind_report_mail_validation \
  node /workspace/node_modules/ava/entrypoints/cli.mjs \
  --concurrency 1 --serial src/__tests__/project-report/workbench.e2e.ts \
  src/__tests__/project-report/api-realtime.e2e.ts --timeout=3m

docker exec -w /workspace/packages/backend/server \
  -e 'NODE_OPTIONS=--max-old-space-size=6144 --import /workspace/tools/cli/register.js' \
  localmind_report_mail_validation \
  node /workspace/node_modules/ava/entrypoints/cli.mjs \
  --concurrency 1 --serial src/__tests__/project-report/generation-schedule.e2e.ts \
  --match='A44*' --timeout=3m

yarn vitest run packages/frontend/core/src/modules/project-reports \
  packages/frontend/core/src/desktop/pages/intelligence/reports
yarn tsc -b packages/backend/server packages/common/office
yarn node .codex-artifacts/project-report-resume/frontend/typecheck-report-sources.mjs
yarn node packages/backend/server/scripts/typecheck-copilot-tests.mjs \
  --file src/__tests__/project-report/generation-schedule.e2e.ts

NODE_OPTIONS="--import=$PWD/tools/cli/register.js" \
  yarn r .codex-artifacts/project-report-resume/exports/reopen-pptx.ts \
  .codex-artifacts/project-report-resume/exports/lo-resaved/report-native-edited.pptx

FONTCONFIG_FILE="$PWD/.codex-artifacts/project-report-workbench/fonts.conf" \
  soffice -env:UserInstallation=file:///tmp/localmind-report-final-lo-profile \
  --headless --convert-to pptx \
  --outdir .codex-artifacts/project-report-resume/exports/lo-resaved \
  .codex-artifacts/project-report-resume/exports/report-native-edited.pptx
```

Office / source / policy / original workflow Linux 命令与实际 provider 测试的逐轮输出保存在对应日志；后者需要重新取得用户授权的临时 fixture，不能直接重用已经删除的凭据。native 源码和二进制哈希见 `root/native-source-evidence.sha256`。Impeccable 最终检测返回空问题数组，见 `frontend/impeccable-detect-final.json`。

## 既有基线与运行状态

`yarn tsc -b packages/backend/server packages/frontend/core` 整体检查未通过，只有两处未修改、与 HEAD 一致的既有测试错误：

- `components/page-tree/created-resource.spec.tsx:33`：`editorFocus$.value` 可能为 null。
- `modules/navigation-panel/services/created-resource.spec.ts:29`：fixture 的 `parentNodeId: null` 与断言类型 `string` 不兼容。

证据为 `root/types-final.log`。本任务没有为消除该基线而改动无关页面树测试；backend / Office、所有前端生产源码与所有汇报测试、变更的后端测试分别类型检查通过。

前期曾发生并行原生编译引起的事务超时、SMTP 附件轮询超时；本轮降低 native 构建并发后实际复验通过，未扩大业务事务超时。六类真实模型测试保留 provider 空输出的有界重试事实。PPTX 字体替代和 LibreOffice 图表另存结构差异保留为明确兼容边界。

首轮验收时日常实例尚未迁移，业务 Web / Electron 包未更新。后续本地热启动修复已同步当前源码、数据库、Client 和 native，详见下节；仍未做生产镜像发布、真实业务收件人分发或生产数据质量验证。如需升级运行实例，仍须遵循仓库同步脚本、数据库备份及已验证 Linux 源容器契约；隔离验收容器不是发布镜像。

## 后续：本地热启动运行环境报错修复

用户在 `http://localhost:3011/workspace/.../all` 请求检查并修复实际报错。本节授权与验证仅针对该本地热启动实例，不扩展为其他生产环境发布。

实际根因是 `@localmind/office/report` 的公共 barrel 同时导出 PDF/PPTX renderer，导致浏览器编译普通页面时解析 `@pdf-lib/fontkit`；热启动共享依赖卷尚未安装这项新增依赖，后端也因此在启动阶段退出。实际数据库有 409 个迁移，运行 Prisma Client 不包含报告模型，和当前 416 个迁移的源码不一致。

修复与运行证据：

- 公共 `report` 入口保留浏览器使用的 schema、模板、布局和编辑模型，导出 renderer 移到明确的 `@localmind/office/report-render` 子路径；后端 export-renderer 使用该路径。没有以别名、空模块或关闭汇报能力掩盖错误。
- 在现有 `localmind_hot_web` 容器执行 `yarn install --immutable --mode=skip-build`，按既有锁文件恢复共享 Linux 依赖，未修改锁文件或重建镜像。
- 迁移前 PostgreSQL 完整备份为 `.docker/dev/backups/report-runtime-before-20261013.dump`，大小 990,974,562 字节、权限 0600；`pg_restore --list` 成功读取 2587 项归档目录。备份包含真实实例数据，不提交或公开。
- 沿用 `yarn localmind:sync:backend`，增加 `LOCALMIND_RUNTIME_MODE=source` 以支持 source bind mount 的 Compose 热启动实例。它检查备份、同数据库身份、同网络、schema、同平台 native 和源码哈希，停止后端 worker 后统一迁移、Client 与 addon，保留数据卷。临时构建／Cargo 缓存不作为产品源码证据；Client 比较使用固定 Prisma CLI 格式化临时 schema，正确处理字段位于 `@@` 后的规范化排序，不手改生成文件。
- file bind mount 下，宿主机原子替换 addon 后仅 `docker start` 会保留旧挂载；最终流程通过原 Compose 配置 `--force-recreate --no-build --no-deps backend` 重绑文件。实际 native require 成功。同步的就绪判断同时验证真实 GraphQL `{ __typename }`，不再把 Web HTML 200 误当后端已启动。
- 运行库 7 个报告迁移全部应用，最终计数 416；Client 包含 ProjectReport 及评论章节锚点；同平台已验证 addon 已挂载。最后一次完整同步无待执行迁移，Compose 重绑及 GraphQL 就绪成功。
- `tools/cli/src/office-report-entrypoints.spec.ts` 使用真实 Rspack 编译浏览器模型，显式拒绝 PDF/font 依赖进入模块图；宿主和 Linux 均通过。导出 smoke 在 Linux 通过；8 项前端聚焦测试通过；Office、backend、CLI 类型检查及相关 lint/format 通过。
- 页面复核发现 `QuickFavorite` 在 render 内创建收藏 watcher，会触发用户数据初始化，并同步更新 `WorkspaceSyncInfo`。将 watcher 初始化移到 effect，隐藏快捷收藏时不初始化，切换文档时解除旧订阅。新增 3 项测试覆盖 commit 时机、隐藏状态、响应式收藏与切换文档，连同原文档列表测试共 4 项在宿主与 Linux 通过。
- 修复后的完整 frontend 类型检查仍仅报上节两项与 HEAD 一致的既有测试错误；收藏组件、新增测试和其他生产源码没有新增类型错误。相关 lint 和格式检查通过。
- 最终宿主回归包含浏览器入口编译、报告 API／计划 UI、收藏及文档列表，共 13 项通过。运行重载期间另捕获了目录事务超过既有 15 秒期限的失败，发生在热编译及验证资源竞争期间；保留日志 `backend-tree-window.log`，不扩大事务超时或跳过 ACL。结束重型验证后目录重试恢复，`backend-steady-window.log` 的一分钟目录请求均成功；热开发重载仍有冷加载延迟和后台同步状态。
- 浏览器在原工作区页面重载，编译错误浮层消失，原文档／目录接口返回 200。后端重建期间失败的目录请求经界面刷新恢复，未因旧请求错误删除资料或修改权限。
- 最终原页面为中文文档列表，页面树包含原文件夹及 Word 文件；无 alert 或编译浮层，收藏按钮存在且无跨组件 render 更新错误。截图 `workspace-restored.jpg`、检查结果 `browser-final.json`；该复核不代表所有后台同步任务均已完成。

证据目录 `.codex-artifacts/report-runtime-fix/`，重点日志为 `linux-dependencies.log`、`source-sync-verified.log`、`browser-boundary-linux.log`、`export-linux.log`、`frontend-tests.log`、`favorite-tests-linux.log`、`frontend-types-final.log`、`types-complete.log`。使用固定 `localmind-affine:dev-base`，未重建镜像、未删除 volume、未 commit/push/PR，未发布生产镜像。验证后 `docker system df` 为 Images 26.2 GB、Containers 3.406 GB、Volumes 17.47 GB、Build Cache 13.21 GB；共享 Docker 其他任务可能继续改变占用。

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_report_mail_validation \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_hot_web \
LOCALMIND_DATABASE_BACKUP="$PWD/.docker/dev/backups/report-runtime-before-20261013.dump" \
yarn localmind:sync:backend

docker exec -w /workspace localmind_hot_web yarn vitest run \
  packages/frontend/core/src/components/explorer/docs-view/quick-actions.spec.tsx \
  packages/frontend/core/src/components/explorer/docs-view/docs-list.spec.tsx
```

## 后续：工单作为汇报业务状态来源（2026-10-13）

用户决策：汇报来源为项目文档、工单和公开共享项目 Memory，覆盖开发契约原 D02/D03 的“仅文档”口径；契约第 1.1、4.1 节已同步。

源码变更：

- `ProjectReportGenerationModel.workOrderEvidence/validateWorkOrderEvidence`：先校验项目成员，再只查 `sourceProjectIdSnapshot` 为本项目且执行者为发单人或接单人的工单；只选标题、状态、版本、必需要求标题、最新交付修订号/提交时间/交付项数量及完成/更新时间，不选交付草稿、暂存 Blob、交付项文字或文件、往来正文和派单草稿。发单人在派单未释放时只保留状态（与工单私有视图共用 `WORK_ORDER_DISPATCH_RELEASED_STATUSES`）。修订为 `状态:版本:最新交付修订号`，指纹为同一元数据的 `projectResourceHash`；旧版本作为历史证据保留，同一版本指纹不符或更高版本即拒绝。
- `ProjectReportSourceService.workOrders` 生成确定性服务端文字（`kind=work_order`、`locator=work-order:<version>`）；`validateSources` 不再一律拒绝工单，改为参与方校验。定稿时同样校验工单参与方；上期比较只校验文档来源。
- 生成流程新增 `work-orders` 阶段，工单快照进入事实抽取（`workOrderStatusOnly`）、进度事实和 `document.sources`，不进入共享背景；分页预算截断或截止后变化时增加覆盖核对项。工单事实只接受进展/成果/风险/计划，状态由记录映射，丢弃负责人，只有已交付可为成果；纯工单节点为 `business_state`，与文档混合为 `inference`，不参与上期文档比较。抽取提示词更名为 `Project Report Extract v2` 以便按名称重新播种。
- `ReportDocumentSchema` 增加约束：`business_state` 只能引用工单来源；`document` 仍禁止引用 Memory 和工单。
- Prisma 新增 `work_orders(source_project_id_snapshot, updated_at)` 索引及迁移 `20261013150000_work_order_project_index`。

本轮实际验证（宿主机）：

- server 目录下 `yarn prisma validate` 与 `yarn prisma generate` 成功。
- `yarn tsc -b packages/backend/server packages/common/office` 退出码 0。
- `yarn vitest run packages/common/office/src/report`：2 个文件 21 项通过，含新增声明类型与证据种类用例。
- `yarn r src/__tests__/copilot/project-report-generation-policy.smoke.ts`（server 目录）通过，含工单状态映射、成果门禁、负责人丢弃和 `business_state` 节点用例。
- 变更文件的 ESLint 与 Prettier 检查通过。

未运行：`src/__tests__/project-report/sources.e2e.ts` 新增 A14b（参与方读取、旁观成员为空、发单人未释放无交付修订、版本变化后旧指纹失效、草稿/暂存/交付文字/往来正文不出现、离开项目后拒绝）需要 PostgreSQL 与 Redis；本轮沙箱内 127.0.0.1:5432/6379 不可达、Docker socket 被拒绝，因此未执行，不能视为通过。新迁移也未在真实数据库上应用。

## 2026-10-13：汇报工作室与 Project 页 v10 修复

按用户决策（入口移至左侧项目列表、编辑页为左侧项目 AI 会话加右侧画布、全部能力保持开放）实施：

- 前端：`reports/editor.tsx` 重排为独立全宽「汇报工作室」，保留原有租约、自动保存、冲突合并、撤销重做、候选应用、评论审阅、历史、样式及导出逻辑；新增 `studio-chat.tsx`（按汇报记忆会话并传入 `reportContext`）、`studio.css.ts`；`reports.css.ts` 与演示页改用 `intelligence/workbench-tokens.css.ts` 的 v10 token；空章节在演示与画布中保留一页，与导出布局一致。
- 项目 AI：新增 `project_report_list/read/rewrite/refresh` 工具与 `localmind-project-report-ai-context/v1`；改写和刷新只产生候选，由用户在画布中对比并应用。
- Project 页：布局逻辑恢复到 HEAD，保留搜索、多选、贡献撤销、中文标签等功能；新增项目列表汇报入口与会话执行路径步骤条。

验证：`yarn tsc -b packages/frontend/core` 仅余两处既有基线错误；`yarn tsc -b packages/backend/server packages/common/office` 通过；`yarn vitest run`（intelligence、project-reports、ai-message-content、office）55 个文件 371 项通过；本地热启动实例中实际完成汇报编辑、自动保存、全屏演示与项目列表入口跳转。热启动库迁移前备份为 `.docker/dev/backups/report-studio-before-20261013.dump`；新增工单索引迁移已通过 `prisma migrate deploy` 应用到热启动库；数据库 e2e 与真实模型调用未在本轮执行。

## 2026-10-13：汇报列表搜索延迟修复

当前页面搜索的浏览器单次观测约 1.68 秒，对应服务端请求约 957 毫秒；本地热启动负载下的其他请求存在秒级波动，不能据此推导生产 P95。

- `reports/list.tsx` 将输入值与查询条件分离，停顿 200 毫秒后查询，IME 组词期间不提交中间值；搜索词变化与分页游标复位同批生效。
- `ProjectReportService.state` 增加 `list_results` 和 `list_options` 视图。搜索只读取汇报页及能力，不等待模板初始化、成员与递归资源树；创建选项独立加载，旧 `list` 返回结构保留。两条路径均执行当前成员检查，不增加权限或缓存授权。
- `useReportState` 将查询与实时订阅的生命周期分离，搜索变化不再重建项目订阅；轮询、断线校准、旧响应丢弃和失权清理保持原契约。
- `fields.tsx` 透传组词开始／结束状态，补充前端搜索交互及后端查询隔离回归。

验证命令：

```sh
docker exec -w /workspace localmind_hot_web yarn vitest run \
  packages/frontend/core/src/desktop/pages/intelligence/reports/list.spec.tsx \
  packages/frontend/core/src/modules/project-reports/hooks.spec.tsx

docker exec -w /workspace/packages/backend/server \
  -e 'NODE_OPTIONS=--import=/workspace/tools/cli/register.js' \
  localmind_hot_backend node /workspace/node_modules/ava/entrypoints/cli.mjs \
  --serial src/__tests__/project-report/search.spec.ts --timeout=2m

yarn tsc -b packages/backend/server
yarn node .codex-artifacts/project-report-resume/frontend/typecheck-report-sources.mjs
```

前端 12 项、后端 3 项通过；后端测试使用模拟依赖，不启动 TestingApp 或访问数据库。后端构建类型检查、前端生产源码与汇报测试类型检查、聚焦 oxlint／Prettier 和 `git diff --check` 通过。最初尝试的隔离容器与 Web 容器未能加载其原生 addon，最终在原生模块路径有效的后端容器完成纯模拟测试。

沿用固定 `localmind-affine:dev-base` 与已有源码 bind mount 自动热更新，未重建镜像、未迁移数据库、未手工复制运行文件、未 commit/push。功能测试证明搜索变化时不再重复加载创建选项或重建订阅；尚未覆盖同条件请求重叠和创建选项失败。热启动实例仍有持续 CPU 负载和事务超时，不能声称已达到稳定的亚秒响应。复测热刷新期间也观察到语言包／语法主题 chunk 加载超时，须与搜索查询耗时分别看待。

最终页面已恢复。复测期间观察到列表等待，随后用户进入新建汇报并输入内容，已停止浏览器操作以保留用户工作；未取得可与初测直接比较的最终端到端耗时，不报告提速百分比。同期服务端查询仍出现约 1—2.6 秒耗时，数据库采样未显示锁等待，保留开发运行环境波动这一限制。

## 2026-10-13：剩余延迟与加载超时的代码级诊断

本轮只定位原因，未继续修改业务实现。运行时取样时间为 2026-10-14 UTC，使用现有 `localmind_hot_backend`、`localmind_hot_web` 和 `localmind_hot_postgres`；沿用报告工作台开发契约，没有改变权限、迁移或数据。

### 已证实的主要阻塞

- 后端 15.94 秒 CPU 采样中，事件循环利用率 99.89%，延迟均值 200.77 毫秒、P95 773.85 毫秒、最大 1392.51 毫秒。Yjs `Item.integrate` 自身占采样时间 40.4%，垃圾回收占 15.4%。这些数值是本次采样，不是生产性能分位数。
- `core/doc/workspace-page-tree.ts:source` 每次读取根文档、文件夹表、属性表并构造新 `Y.Doc`，同步 `Y.applyUpdate`；该 `load` 调用链占采样 29.8%。`core/doc/page-tree-sync.ts:validatePageTreeSyncUpdate` 也同步重建完整状态，根／属性更新还各构造 before 和 after，再读取其他表；该函数和额外 load 都出现在热点中。
- `core/doc/workspace-organization.ts:load`、embedding 的 `readAllDocIdsFromWorkspaceSnapshot` 也有同类工作。它们与 GraphQL 共用 Node 主线程；SQL 完成后，响应处理仍须等待主线程。目录读取又被包在 15 秒交互事务中，CPU 等待也消耗事务预算。
- 前端 `DirectoryAccessStore` 和 `WorkspacePageTreeService` 有 15 秒轮询；后者按 30 秒新鲜度筛选并分批，前者还接收三种实时通知。后台同步和读取能持续触发上述重建，单独缩小汇报查询不能消除这类阻塞。
- 数据库只有 2 条汇报记录。搜索条件的只读 EXPLAIN ANALYZE 使用现有复合索引；简化投影为 0.161 毫秒，包含完整字段与删除回执过滤的代表性 SQL 为 0.415 毫秒。不是完整 GraphQL 请求测量，但足以排除当前数据量下的标题扫描为秒级瓶颈。两次 pg_stat_activity 采样未发现锁等待，不能据此排除其他时间窗口的锁等待。

### 已复现的前端等待放大

- `useReportState` 每次 request 都增加 generation，只有最后启动的请求能提交结果。订阅 ready、业务事件和 15 秒轮询均无在途合并；同条件旧请求即使成功也会被丢弃。`ReportsRoute` 不区分 realtime 的 ready 与 changed，所以初次订阅也产生第二次查询。
- 临时诊断用例复现两条路径：初次请求被订阅通知替代后仍显示 loading；连续跨过 15 秒轮询边界的成功响应反复被丢弃。2 项通过是“缺陷复现成功”，不是修复回归通过。
- `ReportList` 的 `list_options` 和 `list_results` 各自轮询和订阅；`error = searchError ?? options.error`、`state = error ? {} : ...` 仍把创建选项失败传播到搜索列表。上一轮只隔离了请求路径，没有隔离错误和全部刷新行为。
- `FetchService.fetch` 默认 15 秒超时，汇报 API 未覆盖该值。慢请求可能先被后续刷新淘汰，再以超时结束；增加超时时间不能解决并发请求不断替代和主线程阻塞。

### 与搜索分开的加载链路

- Rspack 开发服务器将 dev-middleware 放在代理中间件前。其默认 GET/HEAD 路径先等待编译有效，再处理请求／转交代理。2026-10-14 02:33:14 UTC 日志记录 `/api/workspaces/.../files` 等待 bundle；02:33:20 编译完成，本轮 Web 编译 15.24 秒。这个结论不适用于默认直接跳过 dev-middleware 的 GraphQL POST。
- 中文资源和 Shiki 主题使用动态 import，Rspack 默认 chunkLoadTimeout 为 120000 毫秒。此前出现的 120 秒 ChunkLoadError 属于这条链路；当前中文 chunk 返回 200，467596 字节、约 20 毫秒。编译在那次 chunk 超时之前已完成，现有证据不能把完整 120 秒都归因于编译，也不能宣称已修复。前端服务器另一次采样可见 Watchpack 文件轮询和 GC，事件循环最大延迟约 231 毫秒，仍不足以证明 120 秒停顿原因。
- 本地启动器覆盖默认 setupMiddlewares；后端 production 模式的 external URL 与 localhost:3011 不一致，导致 CORS 警告。相同源代理下 GraphQL 仍有 200 响应，不能仅凭这些警告断言搜索被 CORS 拒绝或存在重连风暴。

诊断产物位于 `.codex-artifacts/report-latency/`：后端和前端 CPU profile、事件循环统计、采样脚本及复现用例。仅保存调用栈和统计，不保存业务正文或凭据。

```sh
docker exec -w /workspace localmind_hot_web yarn vitest run \
  --config .codex-artifacts/report-latency/vitest.config.mjs
```

上述 Linux 诊断用例 2 项通过。未重建镜像、未运行迁移、未修改数据、未 commit/push。首次临时 inspector 脚本使用了当前 VM 不支持的动态 import，清理回调导致开发后端退出；已通过现有 nodemon 恢复，改用 process.getBuiltinModule 后成功完成采样，前后端 inspector 均已关闭，真实 GraphQL `{ __typename }` 返回 200。用户创建表单保持原样，未代用户重新提交。

修复顺序应为：把同步 CRDT 解析移出请求主线程并保持事务内校验语义；同条件刷新合并、搜索条件变化才替换请求，并保持失权立即清理；将创建选项错误与搜索结果分开；最后调整开发 GET 代理顺序并对 chunk 超时单独抓取请求证据。不能通过跳过授权校验、长期缓存 ACL 或延长超时掩盖问题。

## 2026-10-13：搜索并发、解析阻塞及脚本加载修复

沿用项目汇报开发契约。修复同步到现有源码 bind mount 实例；没有放宽 ACL、改变数据库结构或延长 FetchService／事务／chunk 的原有超时。

- `useReportState` 合并同条件在途请求；轮询复用请求，实时通知和命令最多追加一次后续刷新。首个有效响应立即显示，切换查询取消旧请求和排队刷新；失权仍清除结果。列表创建选项不再轮询或订阅，选项一般失败不覆盖搜索结果，401/403 保留失权清理；打开新建面板时重新读取选项。首次 realtime ready 不重复触发初始查询，重连继续刷新。
- 新增两个有界解析线程。目录、页面树和同步校验保留原来的数据库读取、锁、事务与授权边界，只把给定字节的 Yjs/native CPU 解析移出请求主线程。只缓存内容指纹对应的解析投影（上限 64 项／16 MiB），不缓存 ACL；读取后再次按当前字节匹配。处理 Y.Doc 子文档的可传输投影、纯删除导致 state vector 不变、队列过载、关闭及线程退出。任务队列上限 32、输入总量上限 128 MiB，单任务含排队有 10 秒工作预算。embedding 的根文档枚举与摘要/工作区内容解析也复用后台线程；没有更改原生模块。
- 开发服务的 API/GraphQL/socket 代理放到编译中间件之前，保留前面的安全检查和代理错误处理。通过现有启动器重启 `localmind_hot_web` 生效。一次重编译对照中 `/api/auth/session` GET 1.604 秒返回，中文脚本等待编译 11.990 秒，证明 API 已与编译等待分离。
- 代码块的深浅主题由模块顶层立即 import 改为 Shiki 支持的 getter，列表不再提前请求四个主题 chunk，也不会产生无人处理的主题加载 Promise；高亮器初始化失败后清除失败缓存，后续使用可再次初始化。现场重新加载确认四个主题请求不再出现。

### 验证与实际速度

- Linux 既有容器：hooks／list／dev proxy 共 21 项 Vitest 通过；解析器及子文档／删除校验共 8 项 AVA 通过；搜索后端 3 项 AVA 通过；BlockSuite 主题按需加载 1 项 Vitest 通过。使用现有生产 Rspack 配置产出独立 worker 入口，并以不加载 TS loader 的 Node 实际运行：投影和 native 文档 ID 读取通过。
- `yarn tsc -b packages/backend/server blocksuite/affine/blocks/code` 通过；前端生产源码及全部汇报测试的专用 TypeScript 检查通过。改动文件 oxlint、Prettier 与 `git diff --check` 通过。没有把项目整体既有基线当成本任务新增错误。
- 主线程采样 P95 延迟从修复前 773.85 ms 降到 79.82 ms，均值从 200.77 ms 降到 36.18 ms；解析已不再是 GraphQL 主线程上的主要 CPU 栈。该采样包含同时存在的后台同步流量，不能作为生产容量承诺。
- 当前 IAB 汇报列表连续 10 次搜索全部返回正确结果，含中文无匹配和数字匹配；端到端中位数 470 ms，最后四次 397／298／639／455 ms（含 200 ms 防抖和自动化观察开销）。启动后的首轮曾达 4476 ms，不能宣称完全没有尾部延迟。清理诊断代码后完整刷新，在 12.705 秒内观察到真实汇报列表；这是开发构建加载，不能当作生产首屏速度。
- 2026-10-14 03:48 UTC 起取样的 31 次汇报 GraphQL 均成功，20—927 ms，中位数 105 ms。同期仍有其他后台目录限流和 embedding 失败记录，不能把本次搜索修复说成全站后台无错误。

### 脚本超时的证据边界

资源计时把等待定位到了浏览器真正发送请求之前：脚本的 `requestStart - startTime` 多次达到 2—21 秒，而请求发出后的传输通常是毫秒级；完整入口约 47 MiB 的未压缩开发脚本也增加加载成本。直接访问脚本服务为 200，入口约 0.28 秒、中文包约 0.026 秒。已移除无关主题请求并修复开发代理阻塞；最终完整刷新后持续观察超过 120 秒，浏览器没有新增 error，也没有重新出现 120 秒 chunk 超时，但历史那次完整 120 秒的客户端排队原因仍不能确证，不能仅凭本轮通过宣称已彻底解释。临时 PerformanceObserver、认证刷新日志及入口探针均已移除。

运行与构建：复用 `localmind-affine:dev-base` 对应的既有 Linux 容器，未重建镜像、未迁移数据库、未复制散落源码、未 commit/push。证据位于 `.codex-artifacts/report-latency/`，含前后 CPU profile、生产 worker 打包核验和最终计时 JSON。
