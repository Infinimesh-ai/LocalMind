# 历史 XLSX 兼容副本执行记录（QA-122）

日期：2026-10-27（America/Los_Angeles；容器日志为 2026-10-28 UTC）。

对应 TODO-03，采用 [Native Office](../office-native/README.md) 的不可变修订与原生文件契约，以及 [Project 原生资源](tracks/project-native-resources.md) 的归属和实时权限边界。旧修订即使没有再次编辑，也能从当前页或历史页下载兼容副本。

## 实现与边界

- Workspace 与 Project 的表格页新增「下载兼容副本」，原始下载明确标为「下载原始版本」。历史页继续只读，两个下载入口都绑定正在查看的修订。副本文件名带 `-v<sequence>-compatible.xlsx`，不会隐式切到最新版本。
- 新的 revision `/export/xlsx` 路由复用 Office 领域服务，读取前验证来源大小、指纹与实时 ACL，派生完成后再次检查权限。响应使用 `private, no-store`，ETag 对应副本字节，额外返回来源指纹和 `xlsx-compatibility/v1` 修复版本。
- 独立纯函数遍历全部工作表，补齐未绑定的 `r:*` 属性所需命名空间；对旧 `xl/stylesN.xml` 引用增加字节相同的标准 `xl/styles.xml` 并调整关系和内容类型。原样式 part 保留，不修改单元格、公式、缓存值、图表或其他未涉及的 part。
- 下载不运行编辑命令，不重算公式、不新增 OfficeRevision、不写回 Blob、不创建 Workspace／Project 新资源。原始包和修订指纹保留。健康文件返回原字节，重复导出确定一致，修复后的包再次处理不变。
- 多样式关系、冲突的标准样式、歧义命名空间及需要修改的签名包拒绝修复；既有 ZIP／XML 大小和安全限制继续适用。失败返回有界 422 错误及可操作提示，用户仍可下载原件。
- 未扩大公开 MCP、委托任务能力或任何来源权限。无 schema、迁移或 GraphQL 协议变化。

## Linux 聚焦验证

复用固定镜像 `localmind-affine:dev-base` 的 Linux 验证容器和隔离源码 `/Users/dev2/Documents/project/LocalMind-qa143`；没有构建新镜像。外部软件通过 Debian 发行版仓库安装到测试容器的可写层，未加入产品依赖。

| 检查                                               | 结果                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Common／前端 Vitest                                | 6 个文件、52 项通过：旧包修复及已有 XLSX 回归、URL 与错误处理、两种归属的修订绑定、当前／历史页入口、忙碌及权限状态                        |
| 后端 AVA                                           | 3 项通过：Workspace 与 Project 的当前／历史真实 HTTP 下载，重复导出、原件精确相等、来源修订和 Blob 不变、跨归属及撤权拒绝、有界失败映射    |
| 后端 `tsc --noEmit`、测试定向类型检查              | 通过                                                                                                                                       |
| Common 变更文件及前端 8 个文件的项目上下文类型检查 | 通过                                                                                                                                       |
| lint／Prettier／UI detector／diff whitespace       | 本次改动检查通过                                                                                                                           |
| Common 全包类型构建                                | 存在既有 `report/deck/runtime.spec.ts:120` 的 `IntersectionObserverEntry[]` 强转错误；未修改该无关文件，也未宣称 monorepo 全量类型检查通过 |

主要命令（容器根目录 `/workspace`，后端命令在 `packages/backend/server` 执行）：

```sh
yarn test src/__tests__/copilot/office-xlsx-compatibility.spec.ts
yarn tsc --noEmit --pretty false
yarn typecheck:copilot \
  --file src/__tests__/copilot/office-xlsx-compatibility.spec.ts \
  --file src/__tests__/storage/office-xlsx-compatibility.fixture.ts
yarn vitest run \
  packages/common/office/src/xlsx/compatibility.spec.ts \
  packages/common/office/src/xlsx/xlsx.spec.ts \
  packages/frontend/core/src/modules/office/client.spec.ts \
  packages/frontend/core/src/components/office/resource-adapter.spec.ts \
  packages/frontend/core/src/components/office/resource-surface.spec.tsx \
  packages/frontend/core/src/components/office/shared.spec.ts
yarn workspace @affine/i18n build
```

## 真实页面与外部软件验收

通过真实浏览器操作隔离实例 `http://127.0.0.1:3031`，合成测试用户进入工作区「QA122 历史表格验收」及项目「QA122 项目表格验收」。准备含旧包问题的真实持久化资源后，所有下载均由页面按钮触发，历史切换通过「版本历史 → v1」完成，没有用接口调用替代页面验收。

夹具有「预算」「汇总」两张中文工作表、两张表格、一个柱状图、粗体／背景色及跨表公式；两张工作表均缺关系命名空间，样式位于 `xl/styles1.xml`。v1 的 B2 为 12，v2 为 20，B3 均为 3；来源公式没有缓存值。两个版本都保持旧包缺陷，以证明无需再次编辑。

| 页面操作          | 下载与结果                                           |
| ----------------- | ---------------------------------------------------- |
| Workspace 当前 v2 | 下载兼容副本成功，B2=20                              |
| Workspace 历史 v1 | 只读页下载兼容副本及原件成功，B2=12                  |
| Project 当前 v2   | 下载兼容副本成功，第二工作表可切换                   |
| Project 历史 v1   | 只读页下载兼容副本及原件成功，第二工作表显示历史内容 |

四份实际浏览器下载均经 openpyxl 3.0.9 读取和严格 XML 解析通过：两工作表名称、值、公式、粗体、背景色、两张表格及图表均保留；新增标准样式 part 与原样式字节一致，其余仅允许四个 part 发生修复。原始下载与持久化来源字节完全一致，仍可复现外部解析失败。

LibreOffice 7.4.7.2 在 Linux 中对四份下载执行真实加载与 XLSX 另存；再次独立解析输出，均保留工作表、样式、表格和图表，跨表重算结果 v1 为 15、v2 为 23。下载副本本身仍不重算或补写缓存。LibreOffice 仅有缺少 Java 的 `javaldx` 环境提示，没有文件修复提示或加载失败。未声称验证过 Microsoft Excel、WPS 或任意高级 Excel 特性。

```sh
libreoffice -env:UserInstallation=file:///tmp/qa122-lo-profile \
  --headless --convert-to xlsx --outdir /workspace/qa122-lo-roundtrip \
  /workspace/qa122-downloads/*compatible.xlsx
/usr/bin/python3 /workspace/qa122-external-verify.py
```

页面操作后只读核验：两份资源仍各有 2 个修订，最新修订仍为 v2，四个来源指纹保持不变。v1 原始指纹为 `sha256:65228a810a79efa2b6623097afe276c7c66c8463483d769aaa93d4c702d0831b`，v2 为 `sha256:5d7eb22973380a76cb7f9eadcca2fd7decd08eb0fd9778c65a202d9c361bf0d6`。

证据保存在本机忽略目录 `.codex-artifacts/qa122/`，包括页面截图、实际下载、外部检查脚本和日志、数据库只读核验及聚焦测试日志。验收夹具没有进入业务实例。

## 本地集成与运行状态

逐文件比较任务开始时的基线后，将 24 个实现、测试和翻译文件合回原仓库；保留全部其他已有修改。Native Office 契约同步更新，TODO-03 在真实页面和外部软件验证完成后移除，清单现为 9 项（7 项待处理、2 项待页面验证）。

同步前创建数据库备份 `.docker/backups/qa122-20261028-before-xlsx-compatibility.dump`，1,998,167,049 字节、权限 600，`pg_restore --list` 校验通过。使用同一固定镜像启动独立 native 文件挂载的 `localmind_qa122_sync_source`，其相同源码与依赖再次通过 3 项后端测试，作为同步及迁移源。

```sh
LOCALMIND_RUNTIME_MODE=source \
LOCALMIND_CONTAINER=localmind_hot_backend \
LOCALMIND_RUNTIME_SOURCE_CONTAINER=localmind_qa122_sync_source \
LOCALMIND_RUNTIME_MIGRATION_CONTAINER=localmind_qa122_sync_source \
LOCALMIND_DATABASE_BACKUP=/Users/dev2/Documents/project/LocalMind/.docker/backups/qa122-20261028-before-xlsx-compatibility.dump \
yarn localmind:sync:backend
```

脚本确认 421 个迁移、无待应用迁移，更新运行证据、Client 和同平台 native。首次就绪检查因既有单文件 bind mount 保留旧 inode 而超时；通过既有 Compose 配置重新绑定 Web／Admin，并再次重建 backend 容器后恢复。没有重建镜像、改变服务配置或删除数据卷。最终 Web 返回 200、真实 GraphQL 返回 `Query`、native 加载通过，两种归属的 XLSX 导出路由均已注册。前端热启动实例使用同一原仓库源码，已重新编译。

首次同步日志保留为 `runtime-sync.log`，恢复步骤见 `runtime-web-rebind.log`，最终成功见 `runtime-ready.json`。验证用 Web、backend、source 和 Redis 已停止，合成夹具与测试快照保留。本次未 commit、push、创建 PR 或发布生产镜像。

磁盘检查时可用约 64 GiB，Docker 镜像总计 20.68 GB、构建缓存 1.365 GB；备份新增约 1.86 GiB。剩余边界为未实测 Excel／WPS 及高级工作簿特性、既有 Common 全包类型错误，均不冒充本次已通过项。
