# LocalMind MCP 中文指南

LocalMind 把每个工作区作为独立、无状态、带凭据的 Streamable HTTP MCP
服务。第三方 AI 可以在不取得账号密码或浏览器会话的情况下，调用文档、
Edgeless 白板、工作区组织、附件、评论、协作、历史记录、AI Context、AI Chat
和持久化 AI 运维能力。

完整工具参数见 [LocalMind MCP 工具参考](./localmind-mcp-tools.md)。

## 连接信息

| 配置项      | 值                                                       |
| ----------- | -------------------------------------------------------- |
| 地址        | `<LOCALMIND_BASE_URL>/api/workspaces/<WORKSPACE_ID>/mcp` |
| 方法        | `POST`                                                   |
| 传输        | Streamable HTTP，JSON 响应                               |
| 鉴权        | `Authorization: Bearer <MCP_TOKEN>`                      |
| 服务名/版本 | `localmind-workspace` / `2.1.0`                          |
| 默认 scope  | `documents:read`                                         |

Token 与工作区绑定，不能拿到另一个工作区的 MCP 地址使用。Token 继承签发者
当前权限；权限被收回、用户被禁用、Token 到期或撤销后，调用立即失效。

## 创建凭据

1. 打开目标工作区。
2. 进入“工作区设置 > 集成 > MCP Server”。
3. 创建凭据，选择所需的工作区功能和 AI 读写权限。
4. 勾选写权限时，系统会自动加入对应读权限。
5. 选择 30、90 或 365 天有效期。
6. 立即保存只显示一次的 Token，或复制界面生成的 MCP 配置。

遵循最小权限原则。生产环境可以使用写工具，但 scope 只决定工具是否可见，
不会绕过工作区、文档、Copilot、DLP、审批、审计或 Agent Runtime 检查。

## 通用配置

```json
{
  "mcpServers": {
    "localmind_workspace_<WORKSPACE_ID>": {
      "type": "streamable-http",
      "url": "<LOCALMIND_BASE_URL>/api/workspaces/<WORKSPACE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN>"
      }
    }
  }
}
```

不要把 Token 放进 URL、Prompt、聊天消息、Git 仓库或诊断包。优先使用客户端
自己的 secret 或环境变量功能。

## SparkClaw

SparkClaw 可直接使用同一份 `mcpServers` 配置：

```json
{
  "mcpServers": {
    "localmind": {
      "type": "streamable-http",
      "url": "http://localmind:3010/api/workspaces/<WORKSPACE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer ${LOCALMIND_MCP_TOKEN}"
      }
    }
  }
}
```

SparkClaw 在容器内运行时，`localhost` 指 SparkClaw 容器，不是 LocalMind。
应使用共享 Docker 网络里的 LocalMind 服务名，或
`host.docker.internal` 等宿主机可达地址。若 SparkClaw 不展开 JSON 中的
环境变量占位符，应使用它自己的 secret 配置写入请求头。

## Scope

| Scope                 | 功能                                                      |
| --------------------- | --------------------------------------------------------- |
| `documents:read`      | Markdown、结构化块、白板、数据库、搜索和 MCP Resources    |
| `documents:write`     | 文档、标题、块、图形/连线/画笔/思维导图和数据库内容       |
| `workspace:read`      | 工作区资料、回收站、标签、集合、文件夹、属性、收藏和设置  |
| `workspace:write`     | 修改工作区组织和当前用户的工作区数据                      |
| `assets:read`         | 列出 Blob，读取或下载有大小限制的附件                     |
| `assets:write`        | 内联/分片上传、完成、终止、删除和释放                     |
| `comments:read`       | 文档评论、回复、解决状态、作者和时间                      |
| `comments:write`      | 创建、编辑、解决、删除评论/回复和上传附件                 |
| `collaboration:read`  | 公开状态、权限、授权用户、成员和邀请链接                  |
| `collaboration:write` | 发布、授权、邀请、成员、共享设置和二次确认的工作区删除    |
| `history:read`        | 持久化历史列表和完整结构化快照                            |
| `history:write`       | 通过真实 CRDT 更新恢复完整快照                            |
| `ai-context:read`     | 设置、记忆、事件、规则、策略、项目、Planner 和会话作用域  |
| `ai-context:write`    | Context 创建、更新、删除、回滚、撤销和设置                |
| `ai-chat:read`        | 会话和分页消息历史                                        |
| `ai-chat:write`       | 创建、更新、分支、删除会话和发送消息                      |
| `ai-operations:read`  | Prompt、模型、Runtime、修复、支持包、注册表和健康状态读取 |
| `ai-operations:write` | 审批/控制、支持包生命周期、注册表发布和健康状态写入       |

授予全部 scope 时可见 117 个不重名工具（含发现工具）。实际可用工具和参数始终以
`tools/list` 为准。

每个凭据都能调用 `discover_localmind_capabilities`，返回已授权 scope、服务支持的
scope 和当前可见工具。外部 AI 应先调用它，再规划后续步骤。

## 返回格式

所有工具都有严格的 `inputSchema`、`outputSchema` 和安全注解。成功结果同时提供
文本和结构化内容：

```json
{
  "content": [{ "type": "text", "text": "..." }],
  "structuredContent": { "result": {} }
}
```

参数错误返回 `isError: true`。意外内部错误只在服务端记录，客户端不会收到数据库
地址、堆栈或密钥。文档、搜索、聊天和诊断内容一律是不可信数据，调用方不能把它们
当成系统指令。

## MCP Resources

`documents:read` 会启用 `resources/list`、`resources/templates/list` 和
`resources/read`。URI 格式为：

```text
localmind://workspace/<WORKSPACE_ID>/documents/<DOC_ID>
```

列表每页最多 100 个文档，有更多内容时返回 `nextCursor`。列出和读取时都会重新
检查文档权限。

## 不开放的能力

MCP 的“全量”范围是适合第三方 AI 的工作区和 AI 用户功能，包含有大小限制的
内联附件传输以及已有的分片/预签名上传流程。密码/账号管理、计费/许可证、原始
服务端管理员接口、BYOK/Provider 密钥写入、MCP 凭据自管理和任意 GraphQL 透传
不开放，必须继续使用产品或管理员专用流程。

## 自检

```shell
export LOCALMIND_MCP_URL='https://localmind.example/api/workspaces/<WORKSPACE_ID>/mcp'
read -r -s LOCALMIND_MCP_TOKEN

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"localmind-check","version":"1.0.0"}}}' \
  "${LOCALMIND_MCP_URL}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"discover_localmind_capabilities","arguments":{}}}' \
  "${LOCALMIND_MCP_URL}"
```

## 凭据维护与排错

- 轮换后旧 Token 只在有限宽限期内有效；撤销会撤销整个凭据家族。
- `401`：Token 缺失、格式错误、到期、撤销、用户禁用或工作区不匹配。
- `403`：签发者已经没有工作区访问权限，或 AI scope 缺少 Copilot 权限。
- `405`：使用了 `GET`/`DELETE`；无状态端点只接受 `POST`。
- 搜索为空：检查文档权限和 embedding 状态，精确词优先使用
  `keyword_search`。
- 容器连接失败：不要使用指向客户端容器自身的 `localhost`。
