# 通知清理执行记录

日期：2026-09-06（America/Los_Angeles），运行同步完成于 2026-09-07 UTC。

范围按用户确认“先解决通知清理就行”。Active track 为
`tracks/intelligence-workbench.md`，资源和任务边界继续遵守
`tracks/project-native-resources.md`。

## 实现

- 通知列表统一提供单条标已读、删除操作，覆盖权限申请、申请结果、文件请求和
  普通通知。固定操作列支持键盘与触屏，错误会反馈。
- 顶部直接提供全部已读，更多菜单在未读和全部模式均提供删除已读、清空全部。
  清空全部需要确认，清理范围包含未加载的分页记录。
- 新增 `dismissAllNotifications` GraphQL mutation，服务端从当前会话获取用户，
  复用 `dismissedAt` 隐藏本人收件箱记录，不删除任务、请求或审计。无新增迁移。
- 清理期间禁止重复提交，取消旧分页请求，完成或失败后重新读取列表和计数。
  单条已读不再在服务端实时计数推送后重复扣减。
- 文件请求清理后，对方新的接单或交付会重新显示通知；本人操作不恢复本人已清理
  的通知。权限申请结果使用独立通知，保留原有幂等规则。
- 窄屏改为侧栏下方定位，通知面板与确认窗口按视口限制宽度。

## 验证

复用 `localmind_project_native_runner` / `localmind-affine:test`。AVA 专用数据库
为 `localmind_file_requests_20260907`；浏览器数据库为
`localmind_project_native_20260906`。没有在业务数据库执行测试清库。

Linux AVA 共 58 项通过，运行文件：

```sh
yarn workspace @affine/server test \
  src/__tests__/copilot/project-file-request.e2e.ts \
  src/models/__tests__/notification.spec.ts \
  src/core/notification/__tests__/service.spec.ts
```

测试环境设置 `NODE_ENV=test`、
`NODE_OPTIONS=--import=/workspace/tools/cli/register.js`、
`REDIS_SERVER_HOST=localmind_project_native_final_redis`，将 runner 的
`DATABASE_URL` 数据库路径替换为上述 AVA 专用数据库后执行。新增测试覆盖匿名拒绝、
跨用户拒绝、120 条分页外记录、幂等清空、任务和请求不变、新通知和交付重新提醒。

Linux Vitest 共 23 项通过：

```sh
yarn vitest run \
  packages/frontend/core/src/modules/notification/services/list.spec.ts \
  packages/frontend/core/src/modules/notification/services/count.spec.ts \
  packages/frontend/core/src/modules/notification/stores/notification.spec.ts \
  packages/frontend/core/src/components/notification/cleanup-actions.spec.tsx
```

正式 Nest schema、GraphQL client 和 i18n 按现有流程生成。
`yarn tsc --noEmit -p packages/backend/server/tsconfig.json`、core 对应命令、
`node packages/backend/server/scripts/typecheck-copilot-tests.mjs --file src/__tests__/copilot/project-file-request.e2e.ts`、
修改文件的 oxlint、Prettier 和 `git diff --check` 通过。

真实浏览器验证 1280×720 和 390×844、浅色和深色主题：

- 111 条未读显示 `99+`；删除权限通知、单条已读、全部已读正常。
- 取消清空保留全部记录；删除 122 条已读后保留 1 条新未读。
- 清空 121 条已读和未读后，数据库可见数量与未读数量均为 0。
- 对比清理前后，3 个文件请求完整记录一致，任务仍可见。
- 清空后新增通知正常显示为 1，不恢复历史通知。
- `3011` 新版本可见单条按钮和批量菜单，原有 2 条未读和“文件1”请求保留。

## 本地同步

已停止业务服务创建一致备份，随后恢复服务并执行 `yarn localmind:sync:all`。
备份目录：

`/Users/dev2/Documents/Codex/backups/localmind-project-native-final-20260907T060315Z/`

包含数据库 dump、存储及配置归档和 SHA-256 manifest；`pg_restore --list` 可读取
dump。浏览器截图位于备份目录的 `notification-cleanup-evidence/`。

同步检查 354 个既有迁移均已应用，backend/web/admin 打包通过，运行地址为
`http://localhost:3011`。未重建镜像，继续使用固定 `localmind-affine:local`。
Docker 磁盘检查：images 54.85 GB、containers 10.2 GB、volumes 1.15 GB、
build cache 2.913 GB；未执行 prune 或删除 volume。

保留全部既有源码改动，未提交或推送。构建仍提示既有静态资源体积和 Browserslist
数据过旧警告；本轮未改动依赖或全局构建配置。

## 2026-10-11：v10 通知控件与无闪动刷新

本轮按用户确认，将 v10 Circuit 的控件风格用于通知弹层，范围仅限通知。
沿用本记录的通知清理契约，视觉参考为
`project-workbench-v10-desktop-design-implementation.zh-CN.md`；不改变工单、权限、
删除语义或其他页面的全局控件。

- 已读、删除操作改为底部横排，使用 34px 浅灰圆角控件、细边框、轻阴影；触屏
  命中区域为 44px。删除悬停采用语义红，提供键盘焦点与说明。
- 工单通知标题最多两行，摘要与本地化状态合并，打开工单使用紧凑次级入口。
  不可访问的工单禁止打开，但仍可清理通知。
- 替代旧的“操作后 reset 再加载”：局部乐观更新，后台按原已加载页数重新请求，
  全部成功后一次性替换数据和分页游标；失败保留内容，提供重试。
- 合并密集到达的刷新信号，取消过期请求，防止旧结果恢复已删除项。失败操作立即
  恢复本地条目；计数恢复检查实时版本，筛选切换检查请求代次。
- 背景刷新不显示整列表骨架屏、不卸载未变化行；面板保持高度，保留可见行的滚动
  位置。移除聚焦条目后转移至邻近条目，最后一条移除后聚焦通知标题。

代码集中在 `components/notification/{list,list.style.css,cleanup-actions,work-order,viewport}`
和 `modules/notification/services/list.ts`（均位于 `packages/frontend/core/src/`）。

复用 Linux 容器 `localmind_hot_web`（固定镜像 `localmind-affine:dev-base`），命令前缀
为 `docker exec -w /workspace localmind_hot_web`。36 项聚焦测试通过：

```sh
yarn vitest run \
  packages/frontend/core/src/modules/notification/services/list.spec.ts \
  packages/frontend/core/src/modules/notification/services/count.spec.ts \
  packages/frontend/core/src/modules/notification/stores/notification.spec.ts \
  packages/frontend/core/src/components/notification/cleanup-actions.spec.tsx \
  packages/frontend/core/src/components/notification/viewport.spec.tsx
```

覆盖多页保留与游标续接、重复信号合并、乐观更新及刷新双重失败、过期响应隔离、
筛选切换、键盘焦点、可见行位置和工单导航。修改文件通过 oxlint、ESLint、Prettier
及 diff 检查。ESLint 默认堆内存不足，增加 `NODE_OPTIONS=--max-old-space-size=6144`
后通过。前端全量类型检查仍被既有 BlockSuite 导出、页面树、导入和工单文件输入等
错误阻挡；本轮通知文件没有类型错误。

运行页面通过已有源码挂载与热更新生效，未执行同步脚本、重建镜像或提交推送。
浏览器保留用户通知数据；已读、删除、失败路径通过隔离测试验证。真实通知列表加载
11 条后，跨后台刷新仍保持 `scrollTop=590` 和 480px 面板高度。主题使用真实组件
DOM/CSS 和现有主题 token 在独立预览中检查，不改变用户主题设置。
真实页面检查 390×844、745×894、1325×894：窄屏面板宽 358px、左右各留 16px，
桌面面板宽 384px；操作区与长标题不溢出。验证后恢复浏览器原视口。
截图与日志保存于 `.codex-artifacts/notification-v10-20261011/`。
