# MCP 文档完整编辑实施记录

日期：2026-11-04。源码基线：`2c2fc997af`。

本轮按[完整方案](mcp-document-full-editing-plan.zh-CN.md)实施当前 LocalMind 模型的
MCP 文档能力。已经超出空段落和表格修复，覆盖原生内容、文件引擎、资产、批注、
历史、元数据及独立管理操作。以下区分代码范围、实际测试和明确边界，不把测试通过
解释为任意外部格式均可无损转换。

保留任务开始前的 AGENTS.md、document-map、直接资源设计、交接与方案文档改动。
实施验证阶段未操作已恢复的业务日志，未提交、推送、部署或同步业务运行容器。

## 1 实现范围与关键修复

### 1.1 能力与作用域

- 原 10 个 v1 直接资源工具和 3 个委托工具继续保留；新增 18 个独立授权的 v2
  工具。未扩大旧凭据、轮换后的原能力或委托任务冻结集合。
- `LOCALMIND_MCP_RESOURCES_ENABLED` 仍控制直接资源入口；新增
  `LOCALMIND_MCP_DOCUMENT_EDITING_ENABLED`，默认关闭，单独控制 v2 写入。
  仅关闭第二个开关时，仍可按原授权读取、预检和查询回执。
- 凭据设置提供“完整文档编辑”预设，展开为明确工具清单；访问管理和生命周期
  操作独立选择。权限等于实时身份 ACL、凭据能力与资源当前状态的交集。
- Workspace endpoint 不扩展为 Project endpoint。普通编辑不经过模型、BYOK、
  delegate 或额外的受众审批。

### 1.2 原生编辑与无损保留

- `core/doc/document-*` 提供统一 schema、类型化命令、计划、保留检查和适配器。
  29 类当前块模型、15 类数据库字段表示及 7 类画布元素均列入生成的 manifest。
  Office manifest 从 51 个原生命令 schema 生成；文件 manifest 覆盖 10 个命令。
- 存续文本在原 Y.Text 上增量修改。空段落、空单元格、未知属性或无关复杂块不再
  阻断其他对象的合法编辑；表格行列、单元格和数据库视图有稳定身份。
- 文本增删、富文本、拆分合并、块转换和移动、表格矩形操作、数据库字段/值/视图、
  图片附件、嵌入引用、Page/Edgeless、画布元素、连线、分组、frame、mindmap 均有
  明确命令。几何、思维导图布局和样式、数据视图筛选契约与编辑器共享实现。
- Markdown 为带覆盖说明的投影。`markdown.rewrite` 使用显式块/行/列映射编译为
  原生命令；不以整篇重建消除空段落、批注或未知字段。代码中的 HTML、管道和反引号
  按字面量处理；无法表达的目标格式、身份歧义或非法输入零提交拒绝。
- 原生正文执行后检查存续文本对象、创建证据、不透明块及根身份；Office 保留包与
  独立状态，文件保留未触及的编码、BOM、换行和词法内容。编辑结果提供保留检查摘要。
  该摘要列出实际检查类型，不声称比较了不存在的像素或签名等价性。

### 1.3 Office、批注和事务

- Docs、Sheets、Slides、PDF 直接复用产品的原生命令和不可变修订，不转换成普通页面。
  普通文件仍为独立 WorkspaceFile；失败不创建同名副本。
- Office 独立状态按原生语义差异合并。真实 Word 输入复验发现的两项问题已修复：
  解析器的 `undefined` 按 JSON 缺省归一化；连续编辑声明的段落 ID 提升映射会携带
  原对象的未知字段。真正无法判定对应关系的旧位置身份仍拒绝写入。
- 正文、标题/属性和批注可在一个 apply 中原子提交。预检不写正文、外部对象、修订、
  评论或通知；执行失败时数据库业务变化与成功回执一起回滚。
- UI 与 MCP 共用评论作者规则、实时 ACL、文档访问管理及版本服务。正文删除使线程
  失锚，不自动删除或解决线程。原生文本、表格单元格、块和画布锚点都可识别。
  评论列表未成功读取不再被当作“评论已删除”。
- 通知通过持久 outbox、每次最多 50 个收件人的续传和每收件人的稳定投递身份发送。
  重试不重复通知或重置已读状态；实际投递再次检查收件人的当前权限。

### 1.4 资产、复制、历史和恢复

- 上传有 begin/part/status/commit/abort、512 KiB 分块、SHA-256、MIME、配额、
  24 小时过期和凭据族绑定。status 返回确切已收分块，可断连恢复。
- 首次导入可使用 Workspace 暂存作用域和 `workspace-staging/v1`，无需建立占位页。
  需要 Workspace 创建及 Blob 权限；该作用域仅用于上传，不允许把 Workspace 当文档改写。
- 外部对象存储使用独立持久暂存记录；数据库事务回滚后，孤儿对象仍有清理证据。
  清理有延迟、引用检查、批量上限和失败重试，不删除仍被修订引用的对象。
- 无损包包含原生正文、Office 独立状态、资产、元数据、评论和评论附件；读取分块
  绑定同一包指纹。签名恢复保留来源证据，新资源和全局评论 ID 返回明确映射。
  同 Workspace 的其他成员恢复时必须仍有来源复制/读取权限；不复制 ACL。
- 历史恢复基于当前版本生成新提交，保留原修订、当前创建证据及有效评论锚点。
  BlockSuite 恢复历史标题时还检查属性更新权限；目录与归属不因正文恢复改变。

## 2 验证环境与证据目录

证据目录：`/tmp/localmind-mcp-document-validation/`。所有样本均为合成数据。
隔离数据库端口为 15435，验证 Redis 端口为 26491；未连接业务数据库 15432 或
业务 Redis 16379。Office 浏览器桥接仅使用隔离 Nest 实例 3087 和本机 Vite 5177。

| 项目             | 证据                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Linux            | 固定 `localmind-affine:test`，Node 22.23.3，GNU arm64 addon；源码只读挂载                |
| test 镜像 ID     | `sha256:0feb960fc7c7ce296378dfb02f8152e3fb848ad5e99b5c80a50127f3c897cf0c`                |
| dev-base 镜像 ID | `sha256:72c6842c534d436fc426c5284ec2fefc3df8f6713dd265f647656efe6c0d7b18`                |
| addon SHA-256    | `3e0bc489ea67d3114e80a43449cb2165e5356cff303bd2e808a320cd0c32f9af`                       |
| 源码校验清单     | `source-sha256.json`；基于本次工作树，不冒充新提交 hash                                  |
| 镜像操作         | 本轮为 Linux 验证构建了固定 dev-base/test；未构建或部署 local，无任务专属 tag            |
| 磁盘观察         | 镜像 19.18 GB、volume 约 4.17 GB、build cache 6.183 GB；主机剩余约 98 GiB；未删除 volume |

## 3 实际测试结果

| 验证                                          | 结果                                                             | 主要证据文件                                                |
| --------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Linux MCP e2e、v1 单元、Office 评论与保留状态 | 121 项通过                                                       | `linux-complete-acceptance.log`                             |
| Linux UI 评论/文档 GraphQL 回归               | 45 项通过                                                        | `linux-ui-domain-final.log`                                 |
| Linux 原生 BlockSuite 编辑                    | 31 项通过，含 1,000 命令边界、50 轮确定性编辑/撤销               | `linux-native-budget-final.log`                             |
| Linux 文件编辑                                | 5 项通过                                                         | `linux-file-final.log`                                      |
| Linux Office 原生引擎                         | 137 项 / 11 文件通过；51 个命令均有对应引擎用例                  | `linux-office-vocabulary-final.log`                         |
| 真实 BlockSuite 编辑器                        | 7 项通过                                                         | `editor-final.log`                                          |
| 前端 Office 四编辑器与凭据能力                | 100 项 / 5 文件通过                                              | `frontend-components-final.log`                             |
| 真实 Office 编辑输入与保存                    | DOCX 空段落、XLSX B3、PPTX 形状文字、PDF 批注均保存为 revision 2 | `office-browser-final-verified.log`、`office-all-final.log` |
| 真实 Office 重开                              | 四格式 × 亮/暗主题通过，PDF 另以 1024×768 回读；Page errors 为空 | `office-final-reopen.log`                                   |
| 评论侧栏状态                                  | 亮/暗主题的加载、attached、orphaned、重新关联；线程未被解决      | `comment-sidebar-browser-diagnose.log`                      |
| 后端 TypeScript                               | 通过                                                             | `typecheck-complete.log` 及最后聚焦检查                     |
| 前端 TypeScript                               | 仅既有基线错误，见下文                                           | `frontend-types-verified.log`                               |
| lint/格式/差异                                | 最终结果见完成记录                                               | `oxlint-complete.log`、Prettier、`git diff --check`         |

Office 137 项包括包部件保留、关系/媒体、DOCX/PDF 中文渲染与重开、Sheets/Slides/PDF
编辑及特殊格式限制。浏览器直接使用仓库编辑器组件，UI 命令由桥接层交给 Linux
真实 MCP preview/apply，然后重新读取服务器状态；没有用 mock 写入结果代替服务端保存。
评论侧栏测试使用真实侧栏与合成 service 数据，只验证状态展示；锚点产生、删除和解析
另由原生、MCP 与真实 BlockSuite 测试验证。

BlockSuite 浏览器检查实际模型注册、schema 版本、父子约束、全部默认属性分类、
本地扩展模型和数据库列 schema；另检查真实文本/表格、画布实例、重开、UI 再编辑和
离线修改合并。通用 playground 没有 AI-chat/subpage 的产品渲染扩展，因此这两类的
证据是实际模型与原生数据保留，不冒充完整业务页面的截图验收。

曾出现的失败均保留在证据目录：测试配置遗漏、fixture 误写不可变过期时间、测试
权限撤销方式、Office JSON 缺省比较、Word 身份映射、PDF 以文字而非输入值定位等。
PDF 最终以输入值、服务器修订和原生包内容核对；不将较早的错误断言计为通过。

### 3.1 可重复的仓库测试入口

以下服务端命令在已配置隔离 PostgreSQL/Redis 的 Linux test 容器中执行，源码挂载
为 `/workspace`；本机启动器为证据目录中的 `run-linux.mjs`，负责加载对应 Linux addon
及平台依赖。不同 AVA 数据库组串行运行；Office 浏览器 fixture 与 AVA 不同时重置库。

```sh
node /workspace/node_modules/ava/entrypoints/cli.mjs --serial --timeout=5m \
  src/__tests__/copilot/copilot-mcp-resources.e2e.ts \
  src/__tests__/copilot/copilot-mcp-resources.spec.ts \
  src/__tests__/storage/office-comments.spec.ts \
  src/__tests__/storage/office-state-preservation.spec.ts
TEST_MODE=e2e node /workspace/node_modules/ava/entrypoints/cli.mjs --serial --timeout=5m \
  src/__tests__/e2e/comment/resolver.spec.ts src/__tests__/e2e/doc/resolver.spec.ts
node --import ./src/prelude.ts src/__tests__/copilot/copilot-mcp-document-native-smoke.ts
node --import ./src/prelude.ts src/__tests__/copilot/copilot-mcp-document-file-smoke.ts
node --import ./src/prelude.ts /workspace/node_modules/vitest/vitest.mjs run \
  --configLoader native --config /workspace/.codex/mcp-office-vitest.config.mts
```

Node 使用 `NODE_OPTIONS=--import=/workspace/tools/cli/register.js`。Office Vitest
配置仅纳入 common/office 的 11 个原生引擎文件，缓存写到 `/tmp`；不修改只读源码。

```sh
yarn playwright test -c tests/blocksuite/playwright.config.ts \
  tests/blocksuite/e2e/mcp-native-document.spec.ts --workers=1
yarn vitest run \
  packages/frontend/core/src/desktop/dialogs/setting/workspace-setting/integration/mcp-server/capabilities.spec.ts \
  packages/frontend/core/src/components/office/document-editor.spec.tsx \
  packages/frontend/core/src/components/office/spreadsheet.spec.tsx \
  packages/frontend/core/src/components/office/presentation.spec.tsx \
  packages/frontend/core/src/components/office/pdf.spec.tsx
yarn tsc -p packages/backend/server/tsconfig.json --noEmit
yarn tsc -p packages/frontend/core/tsconfig.json --noEmit
```

共享 BlockSuite model 已运行 `yarn tsc -b blocksuite/affine/model`，解决新增公开模块的
声明文件依赖。前端整体类型检查仍报原有 `document-editor.spec.tsx:747` 的
`RESOURCE_CONFLICT` 与 `ErrorName` 不兼容；本轮没有修改该基线用例，也未将整体
前端类型检查报告为通过。

## 4 迁移与恢复

新增 7 个迁移：原生目标/能力约束、完整操作清单、分块上传、评论版本与 outbox、
通知重试/去重、外部对象暂存、Workspace 首次上传目标约束。最后一项只有数据库
约束变化，无新增 Prisma Client 字段。前六项已按对应 schema 生成 Client。

在独立 `mcp_upgrade_fixture` 上使用基线 schema 和 425 个旧迁移，写入旧凭据、
原生快照、评论、v1 已完成回执，再应用 7 个新迁移。比较完整旧行（仅排除新增空
目标列），凭据能力、时间、正文二进制、评论和终态证据均未变化。然后以 pg_dump
备份并恢复到另一独立 `mcp_restore_fixture`，再次比较旧行并检查 432 个迁移已完成。

- 升级前、升级后、恢复后证据 SHA-256 均为
  `2b1ab60280ffa1b334098cf32c5329c0c5a563ca84be0690e91417f4d7c17dc8`。
- 合成数据库备份 SHA-256：
  `49ee52698929767214d2e0dcc5de10cf06a7897411d2b8693a03f1714bf7a62c`。
- 证据：`migration-upgrade-baseline.log`、`migration-upgrade-seed.log`、
  `migration-upgrade-new.log`、`migration-restore.log`、`upgrade-verified.dump`。
- 旧数据升级 fixture 不包含私人业务正文、真实凭据密文或已恢复的日志。

回滚采用独立 v2 写入开关，不删除修订、迁移、回执或业务数据。生产迁移、备份、
运行同步和镜像发布尚未执行，不能从本轮隔离验证推断业务环境已升级。

## 5 A01—A64 对照

下表记录实际证据，测试是有边界的合成样本验证；“当前模型”以生成 manifest 为准。
E = MCP e2e；V = v1 单元；N = 原生 smoke；F = 文件 smoke；O = Office 引擎与
状态保留测试；B = BlockSuite 浏览器；U = UI GraphQL；R = Office 浏览器重开。

| 项  | 实际实现与验证证据                                                       |
| --- | ------------------------------------------------------------------------ |
| A01 | E 原生创建稳定身份；初始 Page/Note/Surface 可直接原生命令写入            |
| A02 | B 编辑器新建空白页经原生命令编辑、重开和再次 UI 输入                     |
| A03 | V 空段落投影；N 空内容、空白、未创建与旧式单元格 no-op                   |
| A04 | V 空段落身份保留；N/B 无关块编辑和空段落旁的局部操作                     |
| A05 | N 未触及空块、未知字段和评论；B 空表格单元格及原生属性                   |
| A06 | E 版本/历史 no-op；N 文本与格式等价、对象身份、时间不变                  |
| A07 | V 可写 Markdown 的投影校验与重复往返；E 同版本更新                       |
| A08 | V 代码围栏重复往返；N Markdown code literal 与受控 inline HTML           |
| A09 | V 按 Markdown AST 区分代码/管道文字和真实节点                            |
| A10 | V/N 严格 schema、非法输入和不支持格式拒绝；B 属性分类与 schema 核对      |
| A11 | N 文本 marks 增量及未知 marks 保留；B 富文本/单元格样式回读              |
| A12 | N UTF-16 与字素边界、中文/emoji/组合字符确定性序列                       |
| A13 | N 原 Y.Text 和相对位置；B 离线字符及评论锚点合并                         |
| A14 | N split/merge/转换/数组移动；B 实际父子关系矩阵                          |
| A15 | V todo/嵌套列表；N Markdown 生成嵌套任务列表与类型化列表属性             |
| A16 | V 编辑器默认值和创建证据；N 未知属性/旧缺省保留                          |
| A17 | N/B 定点单元格修改保留其他富文本、宽度和颜色                             |
| A18 | N 表格行增删及存续单元格/轴身份                                          |
| A19 | N 列增删、未触及宽度/颜色/评论；B 回读                                   |
| A20 | N 类型化轴排序/移动；B 编辑器实际表格模型接受                            |
| A21 | N 矩形粘贴、空值、富文本与显式样式策略                                   |
| A22 | N Markdown 块/表格显式映射、歧义零提交；B 离线合并                       |
| A23 | N 未知节点/字段/根、画布与正文混合；E 签名包往返                         |
| A24 | N database 富文本/值/attachment/member/created-by；B 实际列 schema       |
| A25 | N 字段转换及依赖删除失败原文不变                                         |
| A26 | 数据视图共享 filter 契约；N 列/视图身份、类型化配置与拒绝路径            |
| A27 | 资产命令与属性分离；N 原生字段、E 已存资产读取和包复制                   |
| A28 | E 分块/指纹/跨凭据族/MIME、status 续传、8 个 actor 配额、过期清理        |
| A29 | E 外部对象回滚、引用保留、真实对象删除失败重试                           |
| A30 | B 当前 callout/latex 模型和属性清单；N 原生子树与不透明字段保留          |
| A31 | B 实际所有基础嵌入模型实例与 schema；N 严格链接/来源字段检查             |
| A32 | E 引用目标依赖版本漂移；来源按实时 ACL 读取且不展开正文                  |
| A33 | 同步引用命令只改本地引用；源内容必须作为独立资源重新授权与校验版本       |
| A34 | B 实际 localmind:subpage 模型；目录归属仅由目录领域命令改变              |
| A35 | E/U/Office 评论测试覆盖作者、权限、线程和回复操作                        |
| A36 | N 锚点状态/删除/恢复；B 单元格 resolved 锚点；真实侧栏失锚状态           |
| A37 | N 画布文本、属性、几何、笔迹压力；B 七类真实构造器与实例                 |
| A38 | N 连接器解绑、group/frame 循环拒绝、mindmap 布局；B UI 样式一致          |
| A39 | E 模式版本与锁；N 正文/Surface 分离；元数据模式显式修改                  |
| A40 | N 未来块、未知 marks/字段原样保留；B 当前属性漏分类会失败                |
| A41 | V/E 旧默认能力、轮换、HTTP discovery、严格调用及独立能力集合             |
| A42 | E 等锁时撤销凭据/用户/Workspace；归档成员撤权；通知投递撤权              |
| A43 | E 直接调用禁用模型入口，普通授权写成功；无新增受众审批                   |
| A44 | E 内容凭据不推导访问管理、所有权或永久删除；U 复用 UI 规则               |
| A45 | E 公共内容锁、并发标题/正文、同键与不同键竞态；native writer 同锁        |
| A46 | B 离线修改与 MCP 映射 Markdown 合并，保留原对象/锚点                     |
| A47 | E pending updates 超出合并批次、压缩版本、根属性模式版本                 |
| A48 | E BlockSuite/Office/file 正文与元数据失败回滚，评论失败无成功通知        |
| A49 | E 公共回执子进程提交前/后终止恢复；v2 同键重放、失败恢复无副本           |
| A50 | E outbox 失败不修改成功回执；53 个收件人续传、去重和独立事件推进         |
| A51 | E 结构/目录/归档分块版本与评论版本；超限分片和权限过滤                   |
| A52 | V/E/N 阶段、操作/对象定位及恢复动作；拒绝信息不包含正文                  |
| A53 | E BlockSuite/Office/file 包、独立状态、评论附件、指纹与新身份映射        |
| A54 | V/N 不可表达投影、Office 模糊身份、未知目标字段零提交拒绝                |
| A55 | E 精确历史与新提交；N 存续文本和当前有效评论重建；不覆盖旧修订           |
| A56 | E 标题/属性原子提交；N 创建证据不变；当前模型无独立封面字段              |
| A57 | E 复制、回收、恢复、删除回执；目录复用现有访问和生命周期服务             |
| A58 | O 51 种原生产品命令各有对应测试；R 四格式保存及重开                      |
| A59 | O 未修改包部件、媒体、关系、格式；E 独立状态和段落身份提升保留           |
| A60 | O PDF 页面/批注/表单及未修改资源；安全删除/签名限制沿用引擎声明          |
| A61 | F BOM/CRLF/大数字/JSON/CSV 拒绝和局部操作；E 独立文件不可变修订          |
| A62 | 从 schema 生成 manifest；B 实际注册表、模型版本、父子矩阵和属性覆盖校验  |
| A63 | Linux 各层测试、B、R 及亮暗侧栏；视口及扩展模型边界见第 3 节             |
| A64 | 425→432 旧库升级、备份恢复、独立关闭开关、上传/命令预算、镜像/addon 校验 |

## 6 能力边界和发布前提

1. 无损包是同签名实例、同 Workspace 的可信恢复格式。跨 Workspace 字典迁移、
   跨实例信任和不受限大小的包不在此 endpoint 的当前契约内。原始任意 Yjs、脚本
   或伪造来源证据不属于文档编辑 API。
2. Mindmap 使用共享样式和布局，文字形状 bounds 为明确的原生几何；服务端不猜测
   客户端字体测量。批注线程不会因目标删除静默消失。当前模型没有独立 cover 字段。
3. Office 的原生产品能力边界仍适用：签名外观不等于数字签名，视觉覆盖不等于安全
   删除。旧位置 ID 携带不透明状态且没有可靠映射时，拒绝结构修改；连续 Word 编辑
   的显式 ID 映射已支持。拒绝比不可逆地丢失未知内容更符合无损契约。
4. AI-chat 来源会话、transcription job、创建历史属于服务器维护的证据；原生正文
   和用户可编辑字段可修改，MCP 不能伪造这些证据。未来未知模型可被保留，但新增
   目标语义必须增加适配器并通过注册表校验。
5. 资源预算是明确边界：1,000 输入命令/10,000 编译命令、8 MiB inspect、32 MiB
   资产/包、actor 8 个/32 MiB 和 Workspace 16 个/64 MiB pending 上传；外部对象
   暂存 256 个/256 MiB，事务超时 60 秒。超限失败不宣称写入成功。
6. 尚未部署。发布需按仓库规范备份、迁移并核对运行源码/addon/镜像，再明确开启
   两个开关和新凭据能力；本轮没有替用户执行这些运行环境操作。

## 7 完成记录

当前模型范围内的代码实施和本轮隔离验收已完成。Linux 服务端最终 121 项通过，
Office 137 项、原生 31 项、文件 5 项、UI GraphQL 45 项、BlockSuite 浏览器 7 项
以及前端组件 100 项通过。Office 四格式真实输入/保存及亮暗重开通过。

后端 TypeScript、变更 TypeScript 的 oxlint、变更文档/代码的 Prettier 与
`git diff --check` 通过；前端整体 TypeScript 保留第 3 节列出的既有基线错误。
最后历史恢复属性权限检查与 Office 身份提升另有聚焦回归 `linux-last-paths.log`。

应用内帮助、工具参考、能力设置、v2 契约与根导航已同步。新能力默认关闭，需另行
发布和显式授权才进入业务环境。实施验证阶段未 commit、push、部署或改写恢复日志。

## 8 用户授权提交后的检查

用户随后明确要求将本轮工作提交并推送到 `origin/main`。提交钩子的 ESLint 检查发现
两处未声明的直接包引用：已为 inline-comment 补充 model 的 workspace 依赖和
TypeScript project reference，并将前端编辑器改为使用现有 `@blocksuite/affine/model`
公开导出。Yarn 正常生成对应锁文件变更，没有跳过提交检查。

修正后两处 ESLint、`yarn tsc -b blocksuite/affine/inlines/comment` 通过，真实
BlockSuite 浏览器 7 项再次通过；前端整体类型检查仍只有第 3 节记录的既有基线错误。
证据为 `push-import-eslint.log`、`push-comment-typecheck.log`、
`push-editor-validation.log` 和 `push-frontend-typecheck.log`。本次 Git 操作不包含部署。
