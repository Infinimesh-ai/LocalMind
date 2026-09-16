# Qwen 3.8 兼容性诊断（2026-09-16）

用户明确后续使用 Qwen 3.8；本次以服务器现有 `qwen3.8-flash` 配置为验证目标。已定位到协议选择和原生流式解析问题。Chat 协议下的结构化规划，以及诊断代理修正后的工具调用闭环均已通过；这些结果尚未成为生产修复。

本记录承接[今日日志上传失败诊断](./localmind-daily-log-upload-failure-diagnosis.execution-20260916.zh-CN.md)。删除日志中的否定语句不能解决这里的协议和解析缺陷。

## 环境与验证边界

- 通过 `ssh localmind`，加载运行容器 `localmind_affine_server` 中的 `/app/dist/server-native.node`。
- 运行代码为 `b10a1b40cf4bc1d9a0b9b2e3732bac9ace8a6e6f`；镜像 `localmind-affine:local`。
- 使用当前 Workspace 已配置的阿里云 Token Plan 凭据与端点，模型固定为 `qwen3.8-flash`。端点为 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
- 凭据只在服务器内存中读取并发往原配置端点；没有导出凭据、生产文档正文或用户私密提示词。
- 请求均为合成测试文本。工具 `diagnostic_echo` 只在诊断进程中返回结果；没有创建业务文档或修改任务历史。
- 此轮没有修改产品源码、模型配置或权限，没有重启服务、重建镜像。现网默认顺序仍先 GPT、后 Qwen，尚未统一为 Qwen。

## 1. 当前 BYOK 把 Qwen 固定送往 Responses

[ByokService.modelDefinition](../../packages/backend/server/src/plugins/copilot/byok/service.ts#L1237) 对所有 `provider=openai` 的模型固定生成 `backendKind=openai_responses`，不区分兼容端点支持的协议。

[providerConfig](../../packages/backend/server/src/plugins/copilot/byok/service.ts#L1030) 只构造 `apiKey` 和 `baseURL`。[OpenAIProvider](../../packages/backend/server/src/plugins/copilot/providers/openai.ts#L187) 默认也使用 Responses；Workspace BYOK 当前没有把可选协议传到这里。

因此，仅把默认模型名称或优先级改为 Qwen，仍会走现有问题路径。修复需要覆盖 BYOK 模型定义与 Provider 配置，不能只改其中一处，也不能全局改变其他 OpenAI 模型的协议。

## 2. 当前 Token Plan Responses 端点未遵守严格 Schema

将同一合成规划请求及相同 JSON Schema 分别通过运行中的 native 模块发送到两个协议：

| 测试                                                  | HTTP | 结果                                              |
| ----------------------------------------------------- | ---- | ------------------------------------------------- |
| Responses，09:03:41–09:03:46 UTC                      | 200  | 输出缺少 `result` 包装和必需字段，Schema 校验失败 |
| Chat，09:03:41–09:03:49 UTC                           | 200  | 固定对象结构通过 Schema 校验                      |
| Responses，增加字段说明，09:05:48–09:06:04 UTC        | 200  | 仍缺少 `result` 包装，Schema 校验失败             |
| Chat，当前规划器实际系统提示词，09:07:43–09:07:56 UTC | 200  | Schema 和选中分支的字段语义均通过                 |

Responses 请求明确带有 `text.format.type=json_schema`、`strict=true`、必需字段和 `additionalProperties=false`，服务仍返回如下结构：

```json
{
  "kind": "tool_agent",
  "summary": "Create a document titled Diagnostic example in the workspace and save the text Hello.",
  "answer": ""
}
```

它不能通过 LocalMind 的固定 `result` 契约。这里确认的是当前端点对本次请求的行为，不能推广为所有 Qwen 服务或所有 Responses 能力均不可用。

Chat 请求使用 `response_format.type=json_schema`。只给简化提示词时，虽然 Schema 通过，模型仍在无关字段填入了合成文档 ID；这说明结构校验不能替代语义校验。换为当前 `delegation.ts` 的完整规划系统提示词和实际工具类别列表后，结果为 `kind=tool_agent`、非空 `summary`，`answer/docId/content/reason` 全部为空，符合当前分支契约。测试使用同形的六字段 Schema、合成请求和空文档上下文；没有重放用户私密内容，也不等同于完整 MCP 端到端验收。

阿里云[结构化输出文档](https://help.aliyun.com/zh/model-studio/qwen-structured-output)列出 Qwen 3.8 Flash 的 JSON Schema 能力，并以 Chat 的 `response_format` 说明用法；[Responses 文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)列出该模型，但接口可调用本身不能证明具体 Schema 参数得到执行。

## 3. Chat 工具参数丢失：空 ID 覆盖了分片归属

真实 Qwen Chat SSE 中，一个调用的分片形态如下：

```json
{"index":0,"id":"call_example","function":{"name":"diagnostic_echo","arguments":""}}
{"index":0,"id":"","function":{"arguments":"{\"value\": "}}
{"index":0,"id":"","function":{"arguments":"\"probe\"}"}}
```

原始流按 `index=0` 合并后是 `{"value":"probe"}`，但原生工具回调实际收到 `{}`。问题来自已锁定的 `llm_adapter 0.2.11`，`src/stream/parse.rs` 中的 `OpenaiChatStreamParser::merge_tool_call_delta` / `resolve_tool_call_id`：空字符串仍被当作显式调用 ID，覆盖 `index_to_call_id` 映射。名称保留在真实 ID 的状态中，参数则落到空 ID 的另一个状态中。

首次探测还观察到模型反复调用直到 `ToolCallLoop max steps reached`；再次探测在空参数回声被接受后结束。可稳定确认的是参数丢失，后续循环次数取决于模型如何处理工具结果。

因果验证：在独立回环诊断代理中，仅移除工具分片为空的 `id/call_id/name` 字段，保留其余响应。运行中的 native 模块随即按 index 合并到真实调用 ID。最终验证加入参数检查和最终文本检查，结果：

```json
{
  "callbacks": [{ "name": "diagnostic_echo", "args": { "value": "probe" } }],
  "nativeErrors": [],
  "finalText": "OK",
  "verified": true
}
```

工具仅执行一次，随后模型读取工具结果并回答 `OK`。这是诊断代理内的修正验证，未把代理接入生产服务；正式修复应在原生解析器中忽略空身份字段并保留同一调用的状态。

## 4. Responses 还存在重复调用与终态解析缺陷

08:58:48–08:58:51 UTC 的真实 Qwen Responses 探测中，上游一次 `diagnostic_echo` 调用触发两次本地回调：`call_0` 和真实 `call_5c71d4ff661747469d7a8e5b`，参数均为 `{"value":"probe"}`。

这与此前本地 SSE 模拟一致：arguments 事件的 `item_id` 未映射到 output item 的 `call_id`。它是 LocalMind 所依赖解析器的问题，不能靠换成 Qwen 消除，也不能仅按“工具名称加参数相同”去重，因为两个相同参数的调用也可能是用户有意要求。

真实完成事件中的 usage 位于嵌套 `response.usage`，当前解析器读取事件顶层，导致 native 缺失用量事件。此前模拟还证明 `response.failed` 被忽略；本次真实 Qwen 探测没有发生该失败终态，不将模拟结论冒充真实故障抓包。

## 修复与统一使用 Qwen 的验收条件

1. 为 OpenAI 兼容 BYOK 明确选择协议，当前阿里云 Qwen 配置使用 Chat；同步模型定义、请求构造及 Workspace/Project 对应配置路径。Project 仍使用独立全局 Project BYOK，保持现有凭据边界。
2. 在原生解析器修复 Chat 空 ID/空名称处理，并回归分片、交错多调用、参数损坏和续跑。同步修复 Responses 的 item/call 映射、失败终态及嵌套 usage，防止其他路径重复写入或丢失错误。
3. 保留严格 Schema 与当前分支语义检查。将 Schema 失败纳入有界重试和可审计的路由失败判定，不能把失败对象直接放进任务队列，也不能靠关闭校验让任务继续。
4. 修复后把已授权使用范围的规划和执行路由统一为 `qwen3.8-flash`，验证实际选中模型，不能把“配置存在”当作“所有阶段已使用”。
5. 通过公开 MCP 重新提交今日日志，核对唯一文档、完整正文、月份目录和持久化顺序；返回真实 artifact 后才算完成。当前日志仍未确认写入。

## 复现材料

- [Chat 参数及最终回答验证](/Users/dev2/.codex/outputs/localmind-qwen38-chat-verified-20260916.jsonl)
- [Responses 结构化输出证据](/Users/dev2/.codex/outputs/localmind-qwen38-planner-responses-20260916.jsonl)
- [Chat 简化规划提示词对照](/Users/dev2/.codex/outputs/localmind-qwen38-planner-chat-20260916.jsonl)
- [Chat 当前规划系统提示词验证](/Users/dev2/.codex/outputs/localmind-qwen38-actual-planner-chat-20260916.jsonl)

复现脚本保存在 `/tmp/localmind-daily-log-20260916-member01/`，其中没有实际凭据。关键命令：

```sh
ssh localmind 'docker exec -i -w /app localmind_affine_server node - openai_chat' \
  < /tmp/localmind-daily-log-20260916-member01/probe-qwen-actual-planner-prompt.cjs
ssh localmind 'docker exec -i -w /app localmind_affine_server node - openai_chat normalize' \
  < /tmp/localmind-daily-log-20260916-member01/probe-qwen-chat-verified.cjs
```

未构建镜像，未新增 tag 或删除 Docker 资源；上述验证使用现有生产 Linux 容器加载同一原生模块，在独立诊断进程中完成。
