# LocalMind MCP 文档改写问题交接

记录日期：2026-11-04。范围：公开 Workspace MCP 的文档读取、正文替换、块类型适配、格式保留与错误提示。

11 月 3 日工作日志已按日志 skill 规范写回原页面，并核对正文、文档 ID 和目录。恢复依赖用户手动清空正文，再输入一行普通文字；这只是本次操作的绕行方式。表格、空段落及读写判定的问题仍未修复。

本次交接仅新增此文档，未修改产品代码、数据库或运行环境。下文将线上观察、本机复现和后续设计分别标明。新对话应在获得实施任务后按此文档修复，不需要再次清空或改写已经恢复的业务日志。

## 1 接手时先了解的事实

### 1.1 本次实际操作

目标为 [2026-11-03 工作日志](https://localmind.infinimesh.cloud/workspace/6273e33a-b9a9-48fa-a357-9707041b43ca/2a4a5038-403c-4a58-9041-7f94fa2a84de)，文档 ID 为 `2a4a5038-403c-4a58-9041-7f94fa2a84de`。

| 阶段                   | 线上直接 MCP 观察                                                                        | 处理与结果                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 原日志含表格           | 可读到 Markdown 表格；`contentWritable:false`，原因只有 `unsupported_document_structure` | 遵守 skill，未对不可写正文强行调用替换；先准备规范稿并备份 |
| 用户清空原正文         | 连续读取到正文恰为 `"\n\n"`，仍为 `contentWritable:false`                                | 空白页面仍无法按现有写入前置条件恢复                       |
| 用户输入普通文字并同步 | 原页面实际读到 `带写入`，转为 `contentWritable:true`                                     | 普通非空段落使本次页面通过判定；具体文字不重要             |
| 写回规范日志           | 使用最新 `expectedVersion` 与完整参数生成的幂等键调用 `workspace_doc_update`             | 返回 `succeeded`、`writeOutcome:committed`                 |
| 写后核对               | 完整回读与规范稿的本机原生序列化结果一致；四个章节齐全                                   | 保留原文档 ID、标题和月份目录，未新建同名副本              |

规范稿将原 PR 表格内容改成列表，章节为「今日完成」「关键决策」「问题与风险」「相关任务与文档」。本次成功不证明 MCP 已支持表格替换，也不证明恢复了原表格样式。

写入回执 `operationId`：`0e6f8003-95c4-43af-8828-8a89675198ad`。最后一轮恢复核对完成于 `2026-11-04T09:35:06.698Z`；这里记录的是当时结果，不是对后续页面状态的持续保证。

### 1.2 证据与备份

本机持久化目录：

```text
/Users/dev2/.codex/backups/localmind-team-daily-log/2026-11-03-member-01/20261104T092607716099Z/
```

| 文件                                            | 用途                                            |
| ----------------------------------------------- | ----------------------------------------------- |
| `log-backup.json`                               | 原 MCP Markdown、元数据、待写入规范稿及校验信息 |
| `restore-20261104T093420456170Z-arguments.json` | 最终成功写入的完整参数                          |
| `restore-result-0e6f8003.json`                  | 成功回执、完整回读与核对结果                    |

这些文件仅位于本机，不随仓库文档传递。备份不是原始 Yjs 快照，不包含足以无损恢复表格行列身份、富文本、宽度、批注等信息的完整证据。不要把真实日志正文或这些完整文件复制进公共测试夹具。

本机已复现下文的空段落、表格、格式及代码块问题，使用 macOS 上的 Node.js 与当前本地 native addon，只在内存中构造 Yjs 文档。没有获取线上原页面的原始 Yjs 快照，也没有在本轮进行 Linux 或浏览器验收。因此，线上空文档现象与本机空段落复现相符，但不能声称已经排除线上结构中的其他影响因素。

## 2 问题清单

| 编号 | 问题                                           | 证据与影响                                                                                     |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| M01  | 含表格的原页面无法通过现有 MCP 正文接口改写    | 线上可读不可写；源码及本机样例确认表格被排除。即使新正文去掉表格，旧正文门禁仍先拦截           |
| M02  | 清空正文后仍无法写入，要求用户手动输入占位文字 | 线上发生；本机保留一个空段落即可复现。空白视觉状态不等于当前比较器认可的空文档结构             |
| M03  | 读取的可写标志与实际输入校验不一致             | 下划线、颜色样例读取为可写，但将导出的原文送入写入校验会失败                                   |
| M04  | 代码块里的普通字面量被误识别为不支持的结构     | 围栏内 HTML、图片 Markdown、管道表格文本均可读且报告可写，随后被全局正则拒绝                   |
| M05  | 普通文本块也可能因属性或格式边界而整页不可写   | 本机折叠、批注、对齐、文档引用及部分加粗边界样例失败；需要保留这些语义，不能简单忽略属性       |
| M06  | 成功读取不总意味着完整表达原文档               | 原生转换器会跳过若干已知不支持块；MCP 未返回遗漏清单，容易让调用者把投影当成完整备份           |
| M07  | 错误无法定位具体阻碍                           | 多类失败都返回 `unsupported_document_structure`，没有块、字段、阶段及可执行恢复建议            |
| M08  | 缺少保留其他块的定点编辑契约                   | 公开正文接口只有 Markdown 整体输入；一个不支持块即可阻断整页更新，无法表达只修改某一段或单元格 |

M01、M08 部分属于当前 v1 明确收窄的能力边界，不能全部归为 MCP 协议缺陷。M02—M04 是已复现的具体行为问题；M06、M07 是读取完整性及诊断契约不足。下一轮需要同时处理缺陷和能力扩展，并分别说明兼容策略。

## 3 根因与复现要点

### 3.1 表格是原生结构化块

编辑器中的表格为 `affine:table`，数据模型见 [table-model.ts](../../blocksuite/affine/model/src/blocks/table/table-model.ts)。它不是一段 Markdown 字符串：

- `rows`、`columns` 具有稳定 ID、顺序和背景色，列还可带宽度。
- 单元格按 `${rowId}:${columnId}` 定位，文字为 BlockSuite `Text`，底层使用 `Y.Text` 与 Delta 属性。
- 表格还可带 `comments`、`textAlign` 及创建和更新元数据。
- `isFlatData:true` 使属性写入 Yjs 时采用诸如 `prop:cells.<rowId>:<columnId>.text` 的扁平键。

编辑器已有 [Markdown adapter](../../blocksuite/affine/blocks/table/src/adapters/markdown.ts)，原生 Rust loader 也能读写基础表格。缺口是公开资源接口没有完成与编辑器语义等价的适配，而不是 MCP 传输协议无法携带表格。

当前存在三层阻碍：

1. [resource-markdown.ts](../../packages/backend/server/src/core/doc/resource-markdown.ts) 的 `FLAVOURS` 仅允许 page、surface、note、paragraph、list、code、divider，不包含 table。
2. `validateResourceMarkdown` 还会用正则拒绝表格形式的输入行。
3. [workspace-resource.ts](../../packages/backend/server/src/core/doc/workspace-resource.ts) 的 `workspace_doc_update` 先检查旧正文是否可写，再校验新正文。把新稿改成列表不能绕过旧表格造成的阻断。

只加白名单和删除正则不够。[TableSpec](../../vendor/affine_doc_loader-0.1.4/src/block_spec.rs) 使用 `Vec<Vec<String>>` 读取单元格文本；本机为单元格写入加粗 Delta 和列宽后，导出结果只剩普通表格文字。[apply_table_block_props](../../vendor/affine_doc_loader-0.1.4/src/write/builder.rs) 在应用表格属性时会清理原行列与单元格属性，并重新生成行列 ID。若直接用于更新已有表格，可能丢失格式和身份；不能把这一行为误写成「所有未改动表格都会重建」，仍应检查具体更新分支。

另一个本机对照：从原日志 Markdown 重建的文档含一张表格，判为不可写；只把该表格改成列表后可写。该对照来自导出稿的重建，不是原线上 Yjs 的完整取证。

### 3.2 空段落触发结构比较失败

`readResourceMarkdown` 将原文档导出 Markdown，再用 `createDocWithMarkdown` 重建，最后比较 `semanticBlocks`。原文档保留一个空段落时导出 `"\n\n"`，而从这段 Markdown 新建的结构与原文档不等价，因此报告不可写。在同一个段落输入普通文字后可通过。

本机最小复现如下，在仓库根目录运行，仅处理内存数据：

```sh
node --import ./tools/cli/register.js --input-type=module <<'JS'
import * as Y from 'yjs';
import { createDocWithMarkdown } from './packages/backend/server/src/native.ts';
import {
  readResourceMarkdown,
  validateResourceMarkdown,
} from './packages/backend/server/src/core/doc/resource-markdown.ts';

const id = 'memory-only-mcp-handoff';
const doc = new Y.Doc();
Y.applyUpdate(doc, createDocWithMarkdown('诊断', '待写入', id));
const paragraph = [...doc.getMap('blocks').values()].find(
  block => block.get('sys:flavour') === 'affine:paragraph'
);
const text = paragraph.get('prop:text');
text.delete(0, text.length);
const empty = readResourceMarkdown('', id, Y.encodeStateAsUpdate(doc));
console.log(JSON.stringify(empty));
// content.text === "\n\n"，contentWritable === false
validateResourceMarkdown('诊断', empty.content.text, id);
// 同一段空 Markdown 作为新输入却可以通过校验。
text.insert(0, '待写入');
console.log(readResourceMarkdown('', id, Y.encodeStateAsUpdate(doc)).contentWritable);
// true
doc.destroy();
JS
```

修复应允许真正空白页面完成首次有效写入，并明确空结构的等价规则。不能用「文本为空就忽略所有块」处理，因为空标题、空列表项、空单元格、带批注或格式的空块仍可能具有语义。用户手动输入占位文字不能成为正式流程。

### 3.3 可写标志与写入校验分叉

以下为本机复现结果。格式样例在 `a b` 的第一个字符上施加对应 Delta；校验列表示将读取导出的 Markdown 原样交给 `validateResourceMarkdown` 的结果。

| 输入或原生格式                                       | 读取 `contentWritable` | 原样输入校验 |
| ---------------------------------------------------- | ---------------------- | ------------ | -------------- | ------ | ---- |
| 普通文字、普通加粗                                   | `true`                 | 通过         |
| 下划线，导出 `<u>a</u> b`                            | `true`                 | 拒绝         |
| 红色文字，导出 `<span style="color: red">a</span> b` | `true`                 | 拒绝         |
| HTML 围栏中的 `<div>example</div>`                   | `true`                 | 拒绝         |
| Markdown 围栏中的 `![example](image.png)`            | `true`                 | 拒绝         |
| 文本围栏中的 `                                       | A                      | B            | ` 等表格字面量 | `true` | 拒绝 |
| 普通表格                                             | `false`                | 拒绝         |
| 保留一个空段落                                       | `false`                | 通过         |

原因是读取只做原生转换和语义往返比较，写入还会执行以下全局正则：

```js
/!\[|<\/?[a-zA-Z][^>]*>|^\s*\|.*\|/m;
```

正则不区分 Markdown AST 的代码节点与真实图片、HTML、表格节点。修复需要共用解析、能力和语义规则；支持受控行内格式也不等于允许任意 HTML。

对于同一版本、相同权限且无并发变动的文档，读取报告的旧接口可写能力至少应与其导出内容的校验一致。它不应承诺所有任意新输入都合法；具体请求能否无损执行，应由操作级检查给出。

### 3.4 普通块属性及格式边界

`semanticBlocks` 会比较行内 Delta 和非忽略属性。目前只明确忽略有限的编辑器默认值、部分元数据与 note 几何属性。本机样例中，`collapsed:true`、`comments`、`textAlign:center` 和 LinkedPage 引用都会导致不可写。

另一个样例将 `a b` 的「空格加 b」设为加粗，导出变为 `a **b**`，格式覆盖范围发生变化，原文档因此被正确识别为不能无损往返。这里应修复保留能力，而不是放宽比较器来掩盖丢失。

需要把属性分为真正等价的默认值、应保留的语义、只由服务端维护的元数据和无法处理的字段。只有第一类可以按已证明的规则归一化。

### 3.5 读取存在省略与失败两种情况

[原生读取器](../../vendor/affine_doc_loader-0.1.4/src/read/mod.rs) 将 attachment、callout、latex、embed-linked-doc、embed-synced-doc、frame、部分 surface 等列为已知不支持的 Markdown 块；这些块本身可能被跳过，部分容器的子文本仍会被遍历。不能统一宣称整棵子树全部丢失。

本机在普通正文旁添加 attachment、latex、callout 或文档嵌入块，MCP 读取适配层仍可返回剩余正文及不可写标志，没有对外给出被跳过的块清单。遇到未识别块时，`readResourceMarkdown` 又可能直接抛错。这与工具参考中「Complete Markdown」的表述存在需要澄清的差距。

读取结果应区分完整表达、部分投影、保留但未展开及完全不支持。日志 skill 在收到部分投影时，不应将其当作完整备份后要求用户清空原文档。

## 4 修复目标与接口边界

以下是交接建议，尚未实施，也不是现有公开工具列表。

### 4.1 两条路径共用同一能力判定

先修复现有 Markdown 接口的空文档、代码字面量、读写一致性及诊断，再补齐结构化编辑能力。Yjs 文档继续作为事实来源，Markdown 只是其中一种投影。

按块类型建立可复用适配器，至少覆盖读取、输入校验、变更计划、应用、保留规则、语义比较和诊断。普通文本更新应修改对应 `Y.Text`，表格更新应定位行列与单元格；不要为保留可见文字而重建整个页面。

可以评估 `workspace_doc_inspect`、`workspace_doc_preview`、`workspace_doc_patch` 等版本化接口，也可以选择等价的契约扩展。名称需在实施时确定。结构化工具不能直接公开任意 Yjs 数据、任意 `props` 或内部工具透传。

预检返回与文档版本、输入摘要和适配器版本绑定的确定性计划，执行时仍重新检查实时权限和版本。预检不是权限凭证，也不要求为已授权的普通可逆编辑额外增加人工批准步骤。

### 4.2 各类型的适配与保留要求

| 类型                                 | 目标行为与必须保留的语义                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 段落、标题、列表、引用、代码、分隔线 | 文本、嵌套层级、列表属性、语言、Delta 格式、身份和未修改元数据；明确空块规则                       |
| 表格                                 | 定点改单元格、增删改行列及整体改写；保留未触及的行列 ID、顺序、宽度、背景色、对齐、批注和富文本    |
| 数据库块                             | 按数据库自身 schema 处理属性类型、选项 ID、行和视图；不得降级成普通表格，不能用字符串覆盖所有类型  |
| 图片、附件、书签及媒体嵌入           | 保留现有资源引用、说明和展示属性；编辑能力受单独 schema 约束，不隐式新增上传、下载或跨范围复制权限 |
| callout、公式等内容块                | 保存块自身属性、原始内容及子块关系；无法编辑时仍可保留，并允许修改无关的支持块                     |
| 文档引用和同步块                     | 保留目标引用与同步语义；修改引用时检查相应权限，不隐式读写源文档正文                               |
| 批注和锚点                           | 保留线程和位置绑定；块删除按领域规则处理失去锚点的批注，不能自动删除或标为已解决                   |
| surface、frame 及画布内容            | 页面局部修改保留并存的画布数据；Edgeless 不可被 Markdown 整体替换，画布编辑另有明确契约            |
| `localmind:subpage` 等目录相关块     | 正文引用与资源归属分开；资源移动、子页面归属仍走目录领域服务                                       |
| 未知或暂不支持块                     | 服务端原样保留并提供有界诊断；调用者不能伪造不透明块内容，不能静默删除或转成文字                   |

对整体重写，保留策略必须明确到块、行列、单元格和字段。重复段落或重复表格内容导致身份匹配歧义时，应返回可定位的冲突，允许调用者提交明确映射，而不是猜测配对。删除和格式重置应体现为请求中的明确操作。

### 4.3 沿用已有授权和事务

- 公开能力扩展必须更新对应产品契约、schema、发现信息与凭据授权；不能自动扩大旧 MCP 凭据或委托任务冻结快照的权限。
- 直接资源操作继续绕过模型运行时；不回退到 delegate、内部 API、直接数据库写入或伪造会话。
- 版本检查必须针对加锁后可见的权威状态，覆盖已提交更新；不要只比较可能滞后的快照。执行时重查实时 ACL、引用约束和资源状态。
- 正文、元数据、幂等回执及 outbox 沿用现有事务边界。失败不得部分修改业务内容，也不得另建同名副本；失败审计与回执可以按现有规则持久化。
- 无变更请求应返回未变更，不重建块身份、不改创建证据、不制造无意义的更新历史。
- 超时或响应丢失先查询持久回执，按相同幂等键重试；不能为了重试换键重复写入。
- 读取若需要分页，应绑定文档版本，避免把不同版本的块拼成一个文档。

已有 [structured.ts](../../packages/backend/server/src/core/doc/structured.ts) 提供块和数据库读写能力，可作为领域复用入口，但其泛型属性写入及 `save` 调用不能原样暴露为公开 MCP。需要核实编辑器类型兼容性，并接入资源服务的 ACL、版本检查、事务与回执约束。

## 5 错误提示与读取完整性

现有 `contentWritable` 和单一原因不足以支撑自动恢复。新增信息应有界、可供模型与 UI 共用，并避免输出正文、凭据或无权访问的引用目标信息。

| 信息         | 应能回答的问题                                                               |
| ------------ | ---------------------------------------------------------------------------- |
| 读取覆盖范围 | 是完整内容、部分投影，还是包含未展开块？遗漏了哪些已授权可见块？             |
| 操作级能力   | 能否改文字、单元格、属性、移动块或整体替换？限制来自权限还是适配器？         |
| 失败阶段     | 原文档检查、输入解析、计划生成、并发检查还是持久化失败？                     |
| 定位信息     | 哪个操作序号、块 ID、块类型及属性路径触发失败？                              |
| 稳定原因     | 不支持块、无法保留属性、匹配歧义、非法结构、版本冲突等应可区分               |
| 可执行建议   | 更新版本后重试、提交明确块映射、改用已支持的定点操作等；不能默认要求清空正文 |
| 写入结果     | 明确未提交、已提交或结果待核对，并提供已有契约允许查询的操作回执             |

兼容策略需要明确：旧客户端无法理解部分读取结果时，应诚实拒绝不完整读取或使用兼容的完整性表达，不能默默把剩余 Markdown 当成完整原文。保留旧错误码兼容的同时，可增加版本化细节；不要直接破坏当前严格输出 schema。

## 6 代码与契约入口

| 入口                                                                                                                                                                                                                              | 重点                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [resource-markdown.ts](../../packages/backend/server/src/core/doc/resource-markdown.ts)                                                                                                                                           | `FLAVOURS`、`semanticBlocks`、`readResourceMarkdown`、`validateResourceMarkdown`、`updateResourceMarkdown`   |
| [workspace-resource.ts](../../packages/backend/server/src/core/doc/workspace-resource.ts)                                                                                                                                         | 旧正文可写门禁、版本检查、写后校验与目录语义                                                                 |
| [resource-schema.ts](../../packages/backend/server/src/plugins/copilot/mcp/resource-schema.ts)                                                                                                                                    | Markdown-only 输入、严格输出、可写及错误字段                                                                 |
| [capabilities.ts](../../packages/backend/server/src/plugins/copilot/mcp/capabilities.ts)                                                                                                                                          | 新旧能力独立授权与发现                                                                                       |
| [blocksuite.ts](../../packages/backend/server/src/core/utils/blocksuite.ts)                                                                                                                                                       | 原生读取结果、已知不支持块和未知块                                                                           |
| [structured.ts](../../packages/backend/server/src/core/doc/structured.ts)                                                                                                                                                         | 已有块、数据库领域操作及需要补齐的公共调用约束                                                               |
| [writer.ts](../../packages/backend/server/src/core/doc/writer.ts)、[transaction-context.ts](../../packages/backend/server/src/core/doc/transaction-context.ts)、[outbox.ts](../../packages/backend/server/src/core/doc/outbox.ts) | 持久化、事务内读写及提交后同步                                                                               |
| [mcp-resource-operation.ts](../../packages/backend/server/src/models/mcp-resource-operation.ts)                                                                                                                                   | 幂等指纹、操作回执、授权与事务协作                                                                           |
| [table-model.ts](../../blocksuite/affine/model/src/blocks/table/table-model.ts)、[crud.ts](../../blocksuite/framework/store/src/model/store/crud.ts)                                                                              | 编辑器表格语义、扁平属性与稳定身份                                                                           |
| [原生 loader](../../vendor/affine_doc_loader-0.1.4/src/)                                                                                                                                                                          | `block_spec.rs`、`read/mod.rs`、`write/builder.rs`、`write/update.rs`、`markdown/parser.rs` 的转换与保留规则 |

先遵守根级 `AGENTS.md` 的文档阅读顺序，再读取以下当前契约，避免把本文的建议当成已经开放的能力：

- [直接资源 MCP 产品契约](mcp-direct-resource-tools-design.zh-CN.md)与[执行记录](mcp-direct-resource-tools.execution.zh-CN.md)。
- [MCP 接入说明](../localmind-mcp.md)与[工具参考](../localmind-mcp-tools.md)。
- [Workspace 与 Project 写入授权](workspace-project-ai-write-authorization-remediation.zh-CN.md)。
- [验证规则](validation.md)与[Docker 开发约束](../localmind-docker-development-constraints.md)。

日志操作规范位于本机 `/Users/dev2/.codex/skills/localmind-team-daily-log/SKILL.md`，连同其 policy 和 template 一起检查。产品支持范围变化后再同步 skill：允许的写入路径、完整读取判断、幂等、原文档保留与回读验证必须继续有效。

## 7 验收矩阵

测试应使用合成内容，并加入真实编辑器产生的 Yjs 样本。只测试 `createDocWithMarkdown` 自己生成的文档，会漏掉本次空段落及编辑器属性问题。

| 编号 | 必须证明的行为                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------- |
| A01  | 新空白页、清空后留一个或多个空段落、仅空白字符均能按约定直接写入，无需手动占位；有语义的空块不被误删  |
| A02  | 同版本、同权限下，报告可写的读取结果能通过同一接口的原样输入校验；无变更请求不制造修改                |
| A03  | 代码围栏内的 HTML、图片及表格字面量可正常保存；真正不支持的节点仍得到准确拒绝                         |
| A04  | 表格单元格改字、行列增删和顺序调整保持未涉及的 ID、富文本、宽度、颜色、对齐与批注                     |
| A05  | 整体改写能保留未修改块；重复文字、重复表格及嵌套结构匹配不明确时返回定位信息，不猜测删除              |
| A06  | 下划线、颜色、跨空格的格式范围、链接和文档引用不因序列化漂移而静默改变                                |
| A07  | 数据库属性、选项、行和视图按类型更新；无效转换不会清空已有值                                          |
| A08  | 修改普通段落时图片、附件、公式、嵌入、批注、画布及未知块保持原样；读取明确报告覆盖范围                |
| A09  | 标题、目录及子页面归属不因正文编辑改变；不隐式访问或更新引用源正文                                    |
| A10  | 旧凭据、旧冻结任务及未授权新工具不获得新增能力；实时 ACL 撤销在等待锁或预检后仍能阻止执行             |
| A11  | Web 编辑与 MCP 并发、版本漂移、快照与待处理更新均受正确版本检查保护，冲突不覆盖已有修改               |
| A12  | 中途失败不产生部分业务写入；响应丢失、进程退出及幂等重试可通过持久回执和 outbox 正确恢复              |
| A13  | 错误可定位到操作、块和属性，给出可执行建议，不泄露正文、凭据或不可见目标                              |
| A14  | Linux 聚焦测试和真实编辑器回读、样式检查通过，明确记录本地源码、native addon 与部署环境的版本对应关系 |

优先复用现有测试入口：

- [copilot-mcp-resources.spec.ts](../../packages/backend/server/src/__tests__/copilot/copilot-mcp-resources.spec.ts) 与 [copilot-mcp-resources.e2e.ts](../../packages/backend/server/src/__tests__/copilot/copilot-mcp-resources.e2e.ts)。
- [structured.spec.ts](../../packages/backend/server/src/core/doc/__tests__/structured.spec.ts)。
- [原生 roundtrip_tests.rs](../../vendor/affine_doc_loader-0.1.4/src/roundtrip_tests.rs)，以及对应表格更新单测。

## 8 建议实施顺序及交付边界

1. 检查 `git status`，保留已有修改；本轮开始时存在与 MCP 无关的前端 AI 输入、会话和 i18n 改动，接手时应以最新工作区状态为准。读取当前契约并建立真实编辑器回归夹具。
2. 先完成 M02—M04 的聚焦修复，定义空块等价规则及共用解析判定；同时补充 M06、M07 的读取覆盖和诊断契约。不能把格式丢失改成静默接受。
3. 设计并实现表格定点编辑和结构保留，再接其他块类型。先确定公开 schema 与授权兼容；不要为了快速恢复日志直接暴露内部泛型写接口。
4. 补充原子事务、并发、幂等及失败路径验证，再同步接入文档、应用内帮助和日志 skill。需要改公开契约时同步 source-of-truth；需要数据结构变化时再评估迁移，不能预设必须重写所有历史文档。
5. 在 Linux 使用固定 `localmind-affine:test` 做聚焦验证。只有满足仓库条件时才重建 `dev-base` 或 `local`，重建前检查磁盘，不创建任务专属镜像 tag，不删除业务数据卷。
6. 报告完成和未完成的验收项、具体命令、镜像是否重建、版本证据及剩余限制。修复代码、同步本地运行环境和生产部署是不同结果；未经授权不提交、推送或部署。

补充边界：

- 目录日期排序当前不在 MCP 保证范围，已有产品契约明确由用户在 UI 手动处理。本次标记为「内容已保存，日期排序未完成」，不应顺手将排序列为缺陷并扩大修复范围。
- 恢复回执的版本与稍后回读的版本不同，但正文核对一致；没有证据将这一现象定性为版本算法缺陷。只有独立复现并排除编辑器后续写入后才能新增问题。
- 本次只完成文档交接和本机内存复现，未新增产品测试或修复代码，也未进行 Docker、生产同步或部署。新对话不得据此报告修复验收通过。

可用于新对话的任务说明：

> 请先阅读 `docs/ai-modernization/mcp-document-editing-handoff.zh-CN.md` 和当前 MCP 契约，按文档实施修复。优先解决空文档写入、读写判定不一致和代码字面量误判，再完成表格及其他块类型的结构化适配、格式保留和错误诊断。保留已有工作区改动；不要再次清空或修改已恢复的 11.3 日志。按仓库规范完成 Linux 聚焦测试和编辑器验证，未获授权不要提交、推送或部署。
