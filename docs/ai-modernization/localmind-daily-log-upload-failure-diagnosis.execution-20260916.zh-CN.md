# 今日日志上传失败诊断记录（2026-09-16）

本次按用户要求再次通过公开 MCP 提交日志，同时 SSH 监测服务器。上传仍未完成。本轮在规划阶段终止，没有文档写入；另确认上一轮“仅检索却显示完成”的判定缺陷，并在运行镜像的原生模块中复现 Responses 流式工具调用重复及失败终态丢失。

## 环境与范围

- 服务器：SSH 别名 `localmind`。
- 源码提交：`b10a1b40cf4bc1d9a0b9b2e3732bac9ace8a6e6f`。
- 镜像：`localmind-affine:local`，ID `sha256:83730a05d16b889baed74a8b9905f20c22f3b8a6f4720d634dcacf5b245d1d0f`。
- 应用容器：`localmind_affine_server`，诊断结束时 running，restartCount=0。
- 日志标题：`2026-09-16｜member-01｜工作日志`。
- 目标目录：`Infinimesh/陆天毅/2026-09`。
- 本轮只重试已授权日志提交、读取相关任务证据、监测日志并运行无业务副作用的原生模块模拟。没有修改代码、配置、权限或任务状态，没有重启应用或重建镜像。日志跟踪进程已停止。
- 日志正文保存在 [本地草稿](/Users/dev2/.codex/outputs/localmind-daily-log-2026-09-16.md)。

## 1. 本次失败：规划返回值不符合 JSON Schema

任务：`38c63a61-69e1-4d07-aa25-ad158169f618`。Agent run：`cb88b94e-af0f-4063-9e62-286dc809ec59`。

| UTC 时间     | 观察                           |
| ------------ | ------------------------------ |
| 08:34:49.935 | 启动 SSH 日志监测              |
| 08:35:00.963 | MCP 创建任务                   |
| 08:35:25.152 | 记录本次规划模型使用量         |
| 08:35:25.180 | 服务端记录规划 Schema 校验错误 |
| 08:35:25.237 | 任务进入 failed 终态           |

服务端明确错误：

```text
Structured output does not match JSON schema:
"docId" is a required property;
"content" is a required property;
"summary" is a required property;
Additional properties are not allowed
('document_update', 'tool_agent' were unexpected)
```

对应 HTTP trace：`selfhosted:http:343149f3-411e-4e51-addd-4a9c5bea36df`。公开任务返回 `ai_planning_failed`、`terminal=true`，无 plan、无 artifact。数据库中的该请求工具调用数量为 0，因此没有到文档写入、目录挂载或写入审批环节。

使用记录显示本次最终返回规划的模型为 `qwen3.8-flash`，来源 `byok_server`，prompt/completion/total tokens 为 2443/715/3158。任务规划没有持久化完整的逐候选路由尝试链，不能仅凭这些记录断言优先配置的其他模型为何未成为最终返回者。

代码位置：

- [规划契约](./../../packages/backend/server/src/plugins/copilot/mcp/delegation.ts#L190)规定 result 下的固定字段；即使选择 tool_agent，无关字段也应为字符串空值。
- [规划入口与错误归并](./../../packages/backend/server/src/plugins/copilot/mcp/delegation.ts#L805)将错误收敛为 ai_planning_failed。
- [结构化执行](./../../packages/backend/server/src/plugins/copilot/runtime/native-execution-engine.ts#L356)先完成 native 路由派发并记录 usage，再做 JSON Schema 校验。Schema 错误在路由派发之后抛出，因此当前这一步不会触发 native 候选路由的逐路由重试。
- 已锁定的 llm_adapter 0.2.11 的结构化 fallback 只处理派发/解码错误；上层 Schema 校验失败不在该循环内。

## 2. 上一轮误报完成：日志正文被当成禁止写入指令

关联任务：`8573a1b7-996c-4bbf-8aa1-5d38a72a5035`。它在 08:29:29–08:30:50 UTC 执行后返回 completed，但没有文档 artifact。

线上持久化的完成契约：

```json
{ "kind": "none", "version": "localmind-tool-agent-completion-contract/v4" }
```

工具回执仅有两次相同的 `workspace_doc_keyword_search`，没有 create、update、folder 或 placement 操作。最终回答仍是“先检查现有文档和目录”的计划性语句。

本地以同一请求调用当前源码的 `buildToolAgentCompletionContract`，稳定得到 `kind: none`。触发全局否定正则的正文片段为：

```text
不要求账号登录，也不执行
```

这是日志中对已完成部署验收范围的描述。正则把“不要求”的前两个字“不要”识别为否定指令，又在后续范围内匹配“执行”，从而把整个任务的写入完成要求清空。

代码位置：

- [WRITE_DENIAL_PATTERNS 与 deniesWriteAction](./../../packages/backend/server/src/plugins/copilot/mcp/tool-agent-completion.ts#L162)。
- [全局否定命中后提前返回空要求](./../../packages/backend/server/src/plugins/copilot/mcp/tool-agent-completion.ts#L250)。
- [空要求转换为 kind: none](./../../packages/backend/server/src/plugins/copilot/mcp/tool-agent-completion.ts#L407)。
- [运行结束校验与完成持久化](./../../packages/backend/server/src/plugins/copilot/agent-runtime-localmind-tool-agent-adapter.ts#L1308)只对明确 requirements 做必需工具证据检查。

因此，“模型停止输出”和“日志确实保存”在该输入下没有被正确区分。这不是账号登录或写入 ACL 拒绝的证据。

## 3. 原生 Responses 解析：单次调用被执行两次

上一轮数据库中保存了同一工具、同一参数的两个不同调用：

| ordinal | callId                        | toolName                     |
| ------- | ----------------------------- | ---------------------------- |
| 0       | call_0                        | workspace_doc_keyword_search |
| 1       | call_2793c5f4e3794902828e5b62 | workspace_doc_keyword_search |

在运行容器中加载同一个 `/app/dist/server-native.node`，使用回环 HTTP 服务模拟 Responses SSE。测试工具只在进程内记录回声调用，不访问数据库、业务资源或真实模型服务。

输入只有一个 function_call，arguments 事件使用 item_id，output_item 事件携带真实 call_id。实际工具回调执行了两次：

```json
{
  "rounds": 2,
  "calls": [
    { "callId": "call_0", "name": "diagnostic_echo", "args": { "value": "probe" } },
    { "callId": "call_diagnostic", "name": "diagnostic_echo", "args": { "value": "probe" } }
  ]
}
```

已锁定依赖 `llm_adapter 0.2.11` 的 `src/stream/parse.rs` 中，`extract_call_id` 仅找 call_id/id，否则使用 call_0；arguments 与 output_item 的事件没有通过 item_id/output_index 建立同一调用映射，形成两个状态条目。此模拟与线上重复调用的特征一致；线上原始 SSE 未持久化，不能将模拟当作原始网络抓包。

额外终态模拟：第二轮明确发送 `response.failed`，原生模块依旧正常结束，`nativeErrors=[]`。依赖解析器仅处理 `response.error`，缺少 `response.failed` 分支；对 completed 的 status/usage 读取也在事件顶层，未读取嵌套 response。该缺陷已独立复现，但现有证据不足以确认上一轮最后实际收到的是 failed 事件。

## 复现材料与验证

诊断脚本：

- [任务记录读取脚本](/tmp/localmind-daily-log-20260916-member01/diagnose-requests.mjs)
- [原生 SSE 模拟](/tmp/localmind-daily-log-20260916-member01/replay-native-stream.cjs)
- [本轮完整提交请求](/tmp/localmind-daily-log-20260916-member01/monitored-request.txt)

原生模拟命令：

```sh
ssh localmind 'docker exec -i -w /app localmind_affine_server node' \
  < /tmp/localmind-daily-log-20260916-member01/replay-native-stream.cjs
ssh localmind 'docker exec -i -w /app localmind_affine_server node - failed' \
  < /tmp/localmind-daily-log-20260916-member01/replay-native-stream.cjs
```

第一种模拟观察单次调用被执行两次；第二种模拟同时确认失败终态未传播。未执行真实模型接口探测，未导出凭据或文档正文。诊断未改变现网任务的历史证据。

## 建议修复顺序

1. 修复 Responses 调用身份映射与终态处理，保证同一工具调用只执行一次，失败事件传播为失败；补充与真实事件形态一致的原生回归。
2. 完成要求从明确任务目标/结构化计划产生，避免扫描包含历史日志正文的整段请求来判定禁止写入；日志提交必须核对文档写入、准确目录挂载与排序证据。
3. 将结构化 Schema 校验纳入每条候选路由的执行结果判定，加入有界修复/重试或下一候选路由，并保留脱敏的路由尝试与失败类别；保持严格 Schema。
4. 修复并验证后重新通过公开 MCP 提交同一日期日志，先核对同名文档，返回实际文档 artifact、目录与持久化顺序。当前没有可确认的已上传日志文档 ID。
