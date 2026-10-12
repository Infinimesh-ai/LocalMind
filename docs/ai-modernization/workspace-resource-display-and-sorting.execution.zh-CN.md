# Workspace 资源显示属性与排序实施记录

日期：2026-10-09。对应[开发契约](workspace-resource-display-and-sorting-development.zh-CN.md)的 P0—P3；P4 根目录统一排序未纳入本次实现。基线为未提交工作区，保留其他任务已有改动。本记录区分源码、隔离验证和运行环境，不代表生产上线。

## 1. 实现范围与写入边界

主列表及卡片使用标签、创建者、更新、文档类型四项组合属性；创建与更新时间分别和同次事件的操作者显示。名称、创建时间、最后更新时间、文档类型采用独立方向，重复选择字段不会翻转方向。标签、创建者、自然日和类型按真实字段分组；多标签条目的选择、数量和操作按资源身份去重。

| 内容      | 主要文件与职责                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共协议  | `packages/common/graphql/src/workspace-resource-display.ts`：真实类型、自然比较、稳定身份、空值末尾、原子更新事件解析                                                                                 |
| 数据库    | `packages/backend/server/schema.prisma`、`migrations/20261009000000_workspace_resource_display/migration.sql`：当前状态更新证据、原生资源标签关联、创建及 Office 修订触发器                           |
| 原生领域  | `src/models/workspace-native-resource.ts`、`src/models/office-artifact.ts`、`src/core/office/workspace-resource-service.ts`：ACL、CAS、请求键、事件、无变化保存、显式历史恢复                         |
| 标签      | `src/core/doc/workspace-organization.ts` 读取现有 Workspace 标签字典；原生关联只保存标签 ID。实际增删推进资源事件；标签定义改名、调色、删除不伪造资源编辑                                             |
| 页面/白板 | 后端 `src/core/doc/writer.ts`、`workspace-organization.ts`、`root-doc-registration.ts`；前端 `modules/doc/stores/docs.ts`、`entities/doc.ts`、`entities/record.ts`、`services/docs.ts`                |
| GraphQL   | Workspace 资源 resolver、fragments、operations、生成 schema/client；有界批量公开用户资料查询，不提供邮箱                                                                                              |
| 主列表    | `components/native-files/resource-explorer.tsx`、`resource-rows.tsx`、`resource-row-shell.tsx`、`resource-metadata.tsx`、`resource-groups.ts`；原生完整目录加载后排序，最多 10,000 项                 |
| 偏好      | `components/explorer/resource-preferences.ts`、`display-menu/resources.tsx`、`desktop/pages/workspace/all-page/all-page.tsx`：按属性类型迁移，按账号、Workspace、视图保存，等待属性定义就绪后固化迁移 |
| 文件夹    | `desktop/components/navigation-panel/nodes/folder/sort-menu.tsx`、`index.tsx`、`tree/node.css.ts`：行内与右键入口共用选项及既有排序存储                                                               |
| 回填      | `packages/backend/server/scripts/backfill-workspace-resource-display.ts`：游标批次、证据筛选、条件更新、未知与竞态计数                                                                                |

上表 `src/` 属于 `packages/backend/server/`；`components/`、`modules/`、`desktop/` 属于 `packages/frontend/core/src/`。完整本次检查文件清单保存在 `.codex-artifacts/resource-display/changed-files.json`。

| 写入口                                          | 事件与不变量                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| UI / 内部 AI 新建、上传、复制、Project 显式发布 | 当前 Workspace 新副本使用本次创建者/创建时间；不继承源作者。WorkspaceFile 与 OfficeRevision 证据保持不可变      |
| WorkspaceFile 内容保存与版本替换                | 领域模型在版本检查及 Blob 校验后追加修订并成对记录 actor/time；相同内容和 MIME 不追加修订                       |
| Office 命令、批处理、发布更新                   | Workspace Office 实际新修订由数据库触发器更新事件；相同有效内容不推进。Project 内部修订契约保持原样             |
| 重命名、原生标签                                | 同一事务内检查 ACL、版本、请求键和实际差异；成功变更才推进事件，重放返回既有回执                                |
| 历史内容恢复                                    | 显式强制新修订，即使目标字节恰与当前相同；记录本次恢复操作者                                                    |
| 无用户归属的系统内容修复                        | 记录系统 actor，不借用创建者                                                                                    |
| 页面/白板本地编辑                               | 捕获本地事务的 actor/time，作为单个 CRDT 寄存器保存；晚到的节流回调不覆盖较新本地事件，远端收到同步包不重新归属 |
| 页面/白板后端写入、改模式、标签                 | 在原有提交/事务边界保存成对事件；兼容 Y.Map 与旧 JSON 页面元数据；失败批次不广播成功事件                        |
| 浏览、下载、索引、移动、回收恢复、目录排序      | 不写本次新增用户可见事件；各自原有生命周期和技术时间保留                                                        |

公开 MCP 未增加工具、凭据能力或修改旧字段语义。新增列表字段明确独立于数据库行 `updatedAt`。Project 资源没有混入 Workspace 目录。文件编辑类型依据有效 MIME/Office kind，不依赖可修改标题。

## 2. 验证环境与可复现命令

使用现有固定镜像 `localmind-affine:dev-base`，未重建 `dev-base`、`test` 或 `local`，未创建新镜像 tag。本机无现成 `localmind-affine:test`，因此用现有 Linux 开发基镜像与共享只读依赖启动隔离验证容器，Prisma Client 单独生成。隔离 PostgreSQL 使用 tmpfs，与 Redis 位于任务专用网络。

本次没有运行 `localmind:sync:*`，没有迁移实际业务数据库，也没有执行生产回填。现有 hot 容器绑定源码且可能自动重载，这不等同于完成数据库升级或部署验收；新字段使用前必须按仓库备份/迁移/同步流程上线。

以下命令在仓库根目录执行；`DATABASE_URL` 指向隔离 PostgreSQL，`REDIS_SERVER_HOST` 指向隔离 Redis。日志及 UI fixture 位于 `.codex-artifacts/resource-display/`。

```sh
# 隔离 Linux 容器内的实际生成入口
node node_modules/prisma/build/index.js generate --schema packages/backend/server/schema.prisma
node node_modules/prisma/build/index.js migrate deploy --schema packages/backend/server/schema.prisma
# cwd packages/common/graphql；PATH 包含 /workspace/node_modules/.bin
# NODE_OPTIONS=--import=/workspace/tools/cli/register.js
gql-gen --errors-only
# cwd packages/frontend/i18n；同一 NODE_OPTIONS
node build.ts

# 后端：在 packages/backend/server；同一 NODE_OPTIONS，PATH 包含 node_modules/.bin
ava --serial --timeout=3m \
  src/__tests__/copilot/workspace-resource-display.e2e.ts \
  src/__tests__/copilot/workspace-native-crud.e2e.ts \
  src/__tests__/copilot/project-publication.e2e.ts
ava --serial --timeout=3m \
  src/__tests__/copilot/native-file-create.e2e.ts \
  src/__tests__/copilot/project-resource-api.e2e.ts

# 前端：Linux 容器，仓库根目录
node node_modules/vitest/vitest.mjs run \
  packages/frontend/core/src/components/native-files/resource-display.spec.ts \
  packages/frontend/core/src/components/native-files/resource-selection.spec.tsx \
  packages/frontend/core/src/modules/cloud/services/public-user.spec.ts \
  packages/frontend/core/src/modules/workspace-resources/service.spec.ts \
  packages/frontend/core/src/modules/organize/stores/folder.spec.ts \
  packages/frontend/core/src/modules/organize/stores/folder-sorting.spec.ts \
  packages/frontend/core/src/modules/organize/folder-sorting.spec.ts \
  packages/frontend/core/src/modules/doc/stores/docs.spec.ts
node node_modules/typescript/bin/tsc -b packages/frontend/core packages/backend/server --pretty false

# macOS Chrome 驱动 Linux Vite 中的生产 UI 组件
node .codex-artifacts/resource-display/browser-check.cjs
# 最终检查以 changed-files.json 中本次文件为参数执行
# oxlint --deny-warnings，eslint --no-warn-ignored，prettier --ignore-unknown --check
git diff --check
```

本次后端主回归 28 项通过，AI 原生创建与 Project API 回归 8 项通过，前端 8 文件共 41 项通过；最后显示名称适配后，混合选择/显示 4 项再次通过。浏览器 21 项通过，包括 16 个布局组合以及属性/方向、文件夹键盘/事件隔离、收起悬停/聚焦、时间键盘提示、触屏检查；`browser-results.json` 的 `errors` 为空。真实生成日志见 `graphql.log`、`i18n.log`；生成成功本身不替代行为测试。

最终 `tsc -b packages/frontend/core packages/backend/server --pretty false` 退出码为 0；49 个 TypeScript 文件的 oxlint 为 0 warning / 0 error；本次文件 Prettier 检查及 `git diff --check` 通过。全范围 ESLint 仅报告两个测试/Hook 注释位置问题，修正后对涉及文件及最后变更的列表适配重新执行，退出码为 0；生成 schema 的 Babel 大文件提示不影响结果。最终日志为 `types.log`、`check.log`、`eslint-final.log`、`selection-final.log`。

旧库升级的精确执行入口为以下命令。需先以 406 个旧迁移在 `/tmp/display-upgrade` 准备 `display_upgrade` 空库；该路径只用于测试，并非线上升级目录。

```sh
docker exec \
  -e NODE_OPTIONS=--import=/workspace/tools/cli/register.js \
  -e DATABASE_URL=postgresql://affine:resource-display-test@localmind_resource_display_pg:5432/display_upgrade \
  -e REDIS_SERVER_HOST=localmind_resource_display_redis \
  localmind_resource_display_validation \
  node /workspace/.codex-artifacts/resource-display/upgrade.ts
# 上线回填入口：DATABASE_URL 必须显式绑定完成备份及升级的目标库
# NODE_OPTIONS=--import=/workspace/tools/cli/register.js
node packages/backend/server/scripts/backfill-workspace-resource-display.ts '<nextCursor 或空字符串>' 200
```

运行前磁盘记录：Images 30.97 GB、Containers 1.649 GB、Local Volumes 21.99 GB、Build Cache 4.81 GB。收尾 `docker system df`：Images 31.01 GB、Containers 1.688 GB、Local Volumes 22.15 GB、Build Cache 4.81 GB。验证容器文件系统剩余约 1.8 GB（98% 已用），本任务未继续构建镜像。任务开始的依赖副本占满 Docker 空间后，已清理本任务新建临时卷中的副本，切换共享只读依赖；没有删除既有卷或数据。

## 3. 数据升级与回填

空库完整应用 407 个迁移。另建旧库，先应用此前 406 个迁移并创建真实旧 fixture，然后应用本次迁移；不是在新 schema 上伪装旧记录。升级验证脚本为 `.codex-artifacts/resource-display/upgrade.ts`。

| 隔离旧 fixture 统计                         | 数量/结果          |
| ------------------------------------------- | ------------------ |
| 读取资源                                    | 4                  |
| 可靠回填                                    | 2                  |
| 元数据变更历史不足，保留未知                | 1                  |
| 旧 Office 跨内容/标题事件证据不足，保留未知 | 1                  |
| 失败                                        | 0                  |
| 重跑已记录 / 新回填                         | 2 / 0              |
| 不可变创建证据、历史修订                    | 升级及回填前后相同 |

批次大小为 2，实际续传游标并重跑。另以真实并发改名抢先于回填条件更新，验证 `raced=1` 且新事件不被旧证据覆盖。文件索引时间不会被当作内容更新时间。结果为 `upgrade-results.json`；上述数量仅属于隔离 fixture，生产数量尚未知。

回填脚本默认单批 200 条、上限 500 条；持续执行时保存返回的 `nextCursor`，直至为空。仅能证明最后事件的旧文件被回填；不能证明时保留未知，不能拿创建者填补更新者。回填必须在目标库备份、迁移完成后运行。

## 4. 逐项验收

“通过”表示表列证据范围内通过；浏览器证据使用实际生产组件、隔离元数据 fixture，公开资料和部分领域操作被替身隔离。没有把组件检查描述为已登录部署路由的端到端验收。

| 编号    | 状态与证据                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A01     | 通过：真实显示菜单 DOM 只有四个属性按钮，无成员；浏览器逐一切换                                                                                                    |
| A02     | 通过：混合渲染器测试页面与原生行四项一致响应；浏览器列表/卡片组合信息组                                                                                            |
| A03     | 通过：原生创建、复制、Project 发布及 AI 创建领域回归；页面复制不继承源创建/更新属性                                                                                |
| A04     | 通过：甲创建乙保存的真实文件/Office 与页面事件检查，创建证据保持不变                                                                                               |
| A05     | 通过：重命名、增删标签、索引刷新领域测试；更新者与时间不被索引状态覆盖                                                                                             |
| A06     | 通过（领域/代码边界）：移动、回收恢复、索引回归及读路径检查；评论和权限路径未写新增事件字段。未逐个进行已登录 UI 操作                                              |
| A07     | 通过：无变化保存、请求重放、ACL 拒绝、陈旧版本、失败批次均不改变事件或新增副本；没有新增任务取消入口                                                               |
| A08     | 通过：显式恢复新修订、系统 actor、AI 创建/授权写入及 Project 发布回归                                                                                              |
| A09     | 通过：未知/系统/已删除占位、资料失败重试与批量缓存测试；公开接口复用既有公开资料字段，受限状态使用独立占位                                                         |
| A10     | 通过：真实标签关联持久化、请求重放、版本冲突、非成员拒绝及读取；前端调用同一 mutation 并刷新完整目录                                                               |
| A11     | 通过：改名/调色读取共享字典，删除标签被过滤；资源回收恢复保留关联，定义变化不伪造资源更新                                                                          |
| A12     | 通过：MIME/Office kind 映射及伪装标题领域回归；列表按原生身份排除旧 Office doc 重复；14 类型浏览器 fixture                                                         |
| A13     | 通过：四字段比较器及独立方向菜单；重复选择当前字段保持方向；不支持字段明确拒绝                                                                                     |
| A14     | 通过：数字名称、跨种类同 ID、空时间末尾、525 项重排及目录分页测试；未完整加载/超限不能当作确定全量顺序                                                             |
| A15     | 通过：类型/创建者/日期/多标签分组，稳定身份去重与混合选择回归                                                                                                      |
| A16     | 通过（适配/服务）：标签谓词测试，搜索命中与完整受权目录/类型筛选求交后排序；未在真实登录路由逐一排列组合                                                           |
| A17     | 通过（迁移/作用域）：属性 ID 按定义类型迁移、显式关闭、方向保留及账号/视图 key 测试；等待属性表就绪，Workspace 本地状态隔离                                        |
| A18     | 通过：真实 CAS 竞争、回填竞争、不可变事件对及 Yjs 不同包顺序收敛；晚到本地回调不覆盖新事件                                                                         |
| A19     | 通过：资源服务断连/撤权/作用域变化测试、目录 loading/error 分支及资料重试；标签等待同步期间切账号取消请求                                                          |
| A20     | 通过（组件浏览器）：列表/卡片 × 1440/1024/819/390 × 浅深色，16 布局组合无行内横溢出；键盘菜单/焦点检查，无 pageerror                                               |
| A21     | 通过（聚焦回归）：原菜单保留显式专用路径；Trash 与页面选择回归；纯本地仍只有页面/白板。未宣称精选/自定义属性原生扩展                                               |
| A22     | 通过：407 全迁移、406→407 升级、游标续传及重跑，数量和缺失原因见上一节                                                                                             |
| A26     | 通过（组件/样式）：文件夹行内与加号并列，展开常显、收起 hover/focus、触屏 media rule；浏览器实际检查展开/收起 hover/focus、触屏点按；当前模式包含在提示/无障碍名称 |
| A27     | 通过（组件浏览器）：直接三选项、单选状态、键盘打开、Esc、焦点返回及行事件隔离                                                                                      |
| A28     | 通过（组件/存储）：两入口共用 FolderSortItems 和 node.setSortMode；既有排序/目录存储测试覆盖刷新、个人偏好及手动顺序边界，未新建协议或放宽 ACL                     |
| A23—A25 | 不在本期：没有实现或展示虚假的根目录统一排序入口                                                                                                                   |

## 5. 剩余部署验证

源码实现与隔离验证不依赖未来页面树迁移。完整已登录 Workspace 路由上的真实账号切换、网络中断与不同成员联动，需要在完成目标数据库备份、迁移和运行时同步后执行；本次组件浏览器截图不能替代这些部署验证。历史不可证明事件继续显示“暂无记录”，属于契约行为。

参考的 active track 为 `tracks/project-native-resources.md`，并保持 Workspace / Project CRUD 与 Office 独立内容存储边界。

未 commit、push、创建 PR 或修改远端。仅关闭本任务创建的四个隔离验证容器；复跑需重新启动容器并准备隔离数据库 fixture。未删除既有卷、服务数据或无关镜像。数据库迁移和回填脚本已提供，但没有对实际业务库执行。

## 2026-10-12：主列表按需多选与统一操作菜单

主资源列表默认隐藏复选框，通过筛选栏的“多选”进入选择模式；标题点击在该模式下切换选择，“完成”与 Esc 清空选择并退出。选择控件与筛选项共用一行，右侧依次显示选中数量、全选、操作菜单与“完成”；整行位于列表滚动容器之外，避免原工具栏在虚拟列表下方被裁剪。全选范围是当前筛选结果，超过既有 100 项上限时明确提示，不静默截断。行尾操作菜单常驻并尊重原“更多操作”显示偏好；多选时收起单行操作。

空标签按钮已从行内移除，已有标签及数量提示继续按原显示偏好展示。页面、白板与原生文件的行操作菜单提供“编辑标签”；批量菜单提供添加、移除标签及既有回收操作。标签显示开关控制展示，不关闭菜单中的授权编辑能力。页面底部索引复用的行组件通过独立的选择模式上下文保持原选择行为；没有增加索引入口或合并其显示偏好。

`WorkspaceResourceTagsService` 统一处理单项和批量标签差量，写入前等待工作区同步、重新检查当前权限与资源状态。页面使用当前元数据合并差量；原生资源读取当前标签和版本，调用既有标签 mutation 与 CAS。单项编辑也提交增删差量，避免把打开编辑器时的旧快照全量覆盖回去。网络结果不确定时保留同一请求键和输入；确定的冲突/拒绝清除请求，后续重试重新读取当前状态。操作会话绑定账号与服务作用域，切换后不能继续该批次。

各资源独立提交，部分失败时成功项退出选择，失败项保留，并在标签编辑器中列出名称。重试只执行失败项，沿用原标签差量；提交期间禁止重复提交和关闭编辑器。关闭编辑器返回操作入口焦点；关闭菜单或标签编辑器的 Esc 不会连带退出底层选择模式。

验证复用了 `localmind_hot_web`（`localmind-affine:dev-base`），未重建镜像、执行同步脚本或修改数据库/GraphQL 协议。i18n 通过 `yarn workspace @affine/i18n build` 生成。聚焦验证命令：

```sh
docker exec -w /workspace localmind_hot_web sh -c 'NODE_OPTIONS="--import=/workspace/tools/cli/register.js" yarn vitest run --pool=threads --maxWorkers=1 packages/frontend/core/src/components/native-files/resource-selection.spec.tsx packages/frontend/core/src/components/native-files/resource-tags.spec.tsx packages/frontend/core/src/components/native-files/resource-display.spec.ts packages/frontend/core/src/components/native-files/workspace-actions.spec.tsx packages/frontend/core/src/modules/workspace-resources/tags.spec.ts packages/frontend/core/src/modules/workspace-resources/batch.spec.ts'
```

34 项测试通过，覆盖按需选择、已有显示偏好、底部索引边界、只读拒绝、追加保留原标签、并发差量、账号切换、CAS 冲突、网络不确定重放、部分成功与仅失败项重试。19 个修改文件的聚焦类型检查、oxlint、Prettier 与 `git diff --check` 通过。真实浏览器检查了 1333×902 和 879×902、页面及原生文件的菜单/编辑器、Enter/Space/Tab/Esc 与焦点返回；首次实现时窄视口独立选择工具栏底部为 244px，处于 902px 视口内；后续合并筛选行的验证见下文。浏览器未提交真实资源标签或回收操作，权限拒绝和失败写入通过隔离组件/服务 fixture 验证；未进行真实不同成员联动与深色主题浏览器验收。

完整命令、日志与截图位于 `.codex-artifacts/resource-operations-20261012/`。当前运行环境通过既有源码挂载和热更新显示结果，部署镜像尚未更新；未 commit、push 或创建 PR。

### 同日补充：选择控件合并至筛选行

删除独立选择工具栏的固定行高和内边距，将选中数量、全选、操作和“完成”组成右侧内联控件组；搜索框保留全宽。普通模式同一位置仅显示“多选”，显示偏好、已有标签、选择与批量操作处理均复用现有逻辑。100 项上限提示仍作为独立错误信息展示，不挤占控件组。

复用上述 Linux 热更新容器，现有 `resource-selection.spec.tsx` 的 9 项测试通过。浏览器在 968×902 和 879×902 视口确认筛选按钮与选择控件处于同一行（控件中心均为 176px），菜单完整展开；Enter 进入选择/全选和打开菜单、Tab 焦点顺序、Esc 关闭菜单、完成退出均保持原行为。未提交真实资源写入，未重建镜像或运行同步脚本。截图和聚焦检查记录位于 `.codex-artifacts/resource-operations-toolbar-inline-20261012/`。
