# AI 原生文件创建验证（2026-09-20 UTC）

本次实现七种格式的初始创建：DOCX、XLSX、PPTX、TXT、Markdown、CSV、JSON。
产品边界见 [Office 主文档](README.md#ai-file-creation)；沿用 Agent Runtime 与
Project Native Resources track 的作用域、授权、内部保存和显式发布契约。

## 实现入口

- `packages/common/office/src/create.ts`：有界结构化输入、确定性 OOXML/UTF-8 生成。
- `packages/backend/server/src/core/office/create-service.ts`：实时会话与 ACL 校验、
  幂等保存、来源审计、复用 Office import 和 Project resource 服务。
- `packages/backend/server/src/plugins/copilot/tools/file-create.ts`、`tools/project-doc.ts`：
  互斥的 Workspace/Project 创建工具；Project 使用现有持久化任务与 worker。
- `WorkspaceFile`、`core/office/file-controller.ts`：独立普通文件记录、分页列表、
  受保护下载、指纹验证与数据库不可变证据。
- `all-page/workspace-files.tsx`：Office 打开、普通文件下载、刷新、错误和空状态；
  严格模式清理被取消的请求，切换工作区不保留上一工作区列表。

## 聚焦验证

复用现有 Linux 容器，镜像为 `localmind-affine:dev-base`，未重建镜像。

1. `yarn vitest run packages/common/office/src/create.spec.ts`：5 项通过。
   覆盖三种 OOXML 重新解析、确定性、中文/XML 转义、类型化单元格、字面量公式文本、
   CSV 转义、JSON 校验、输入大小和非法字符。最终使用临时单项目配置运行，避免加载
   整个 monorepo 测试配置。
2. `yarn test src/__tests__/copilot/native-file-create.e2e.ts --timeout=3m`
   （后端 package）：2 项通过，分别遍历 Workspace/Project 的全部七种格式。
   验证真实保存、重试回执复用、内容冲突拒绝、下载、版本生成来源、不可变 Blob、
   会话冒用拒绝、项目成员撤销和项目内部隔离。
3. `yarn vitest run packages/frontend/core/src/desktop/pages/workspace/all-page/workspace-files.spec.tsx --maxWorkers=1`：
   3 项通过。随后用临时单项目配置重测严格模式，仍为 3 项通过。
4. `yarn tsc -b packages/common/office --pretty false`：通过。
   后端修改文件及新增集成测试使用 TypeScript program 做聚焦语义诊断：0 项错误。
   整包后端构建与测试并行时曾因开发容器内存不足终止，没有将它记为通过。
5. 修改文件的 `yarn lint:ox`、Prettier 和 `git diff --check`：通过。

集成测试通过进程内包装器把 `DATABASE_URL` 的数据库名改为
`localmind_file_validation`，Redis 使用 database 9；测试 app 会清空其测试库。
没有在业务库运行测试 app。独立数据库全量应用迁移，并验证新增迁移在已有测试
资源上的升级。

## 本地运行环境

- 停止 `localmind_hot_backend` 后，以 `pg_dump -Fc` 备份业务库。
- 备份：`.docker/dev/localmind-hot/backups/before-native-files-20260920.dump`，
  约 38 MB，文件权限 0600。
- 使用
  `docker compose -f .docker/dev/localmind-hot/compose.json run --rm --no-deps backend sh -c 'yarn prisma migrate deploy'`
  仅应用本次三个迁移：`20260920000000_workspace_files`、
  `20260920000100_project_blob_mime_identity`、`20260920000200_workspace_file_evidence`。
- 已重新生成 Prisma Client，恢复后端。热启动容器挂载源码，因此未复制散落文件或
  运行面向其他部署容器的同步脚本。GraphQL 健康请求返回 `Query`。
- 浏览器检查使用本地现有工作区，只检查文件入口和空状态，没有向业务工作区添加
  测试文件或调用外部模型。
- 开始重型检查前磁盘统计：镜像 25.03 GB、volume 6.012 GB、构建缓存 3.313 GB；
  未删除现有镜像、volume 或业务数据。

## 限制

这是一批基础生成能力，不是完整 Office 排版生成器。未验证 Microsoft Office/
LibreOffice 桌面应用，也未运行真实模型对话；已验证工具、存储和本地解析引擎链路。
Workspace 普通文件尚无在线编辑、重命名、回收站、收藏、标签或精选集成。
PDF、图片、ZIP 创建不在本批范围。现有生产部署镜像未更新；部署仍需正常重建
`localmind-affine:local`，不能把本地热启动结果当成镜像交付。
