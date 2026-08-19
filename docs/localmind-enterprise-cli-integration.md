# LocalMind 企业协作 CLI 接入

## 产品边界

用户只在 LocalMind 中对话。LocalMind 的内置 AI 和通过 `delegate_to_localmind` 调用的 AI 共用同一套工具注册中心，并把企业微信、飞书和钉钉作为出站数据源与操作目标。

本接入不提供企业平台聊天机器人入口，也不把三家 CLI 或 MCP 直接暴露给模型。模型只能看到 LocalMind 根据当前用户、工作区、连接状态和工具白名单投影出的工具。

## 三轮设计结论

### 第一轮：先固定交互方向

```text
用户 -> LocalMind Chat -> LocalMind AI -> 企业工具 -> 企业平台
```

企业微信、飞书和钉钉都位于 LocalMind AI 的工具侧，不位于用户消息入口侧。

### 第二轮：统一连接与执行模型

```text
ToolRuntime
  -> EnterpriseToolRegistry
      -> EnterpriseConnectionService
          -> EnterpriseCliDriverRegistry
              -> WeComCliDriver
              -> LarkCliDriver
              -> DingTalkCliDriver
          -> EnterpriseCliRuntime
```

- `EnterpriseToolRegistry`：把当前用户已启用的只读工具投影到模型上下文。
- `EnterpriseConnectionService`：管理用户级连接、工具目录、白名单、状态和审计。
- `EnterpriseCliDriverRegistry`：按平台选择驱动，隔离三家命令差异。
- `EnterpriseCliRuntime`：统一负责受控子进程、profile 隔离、超时、输出和参数限制。

### 第三轮：按能力与风险分阶段开放

1. 先接入连接模型、工具发现和只读执行。
2. 再实现 LocalMind 内的扫码/OAuth 授权会话。
3. 最后接入写操作确认票据；在此之前，写工具不会进入模型上下文。

## 已实现

- Prisma 连接与审计模型，以及数据库迁移。
- 三家 CLI 的用户级独立 profile 和凭据数据目录。
- 三家授权状态检查、schema 工具发现、参数转换和结构化输出解析。
- GraphQL 连接创建、列表、刷新、工具白名单、禁用和删除接口。
- 最多 32 个已启用只读工具进入一次模型上下文。
- 内置 AI 与 delegated LocalMind Agent 共用 `ToolRuntime` 的 `enterprise` 类别。
- CLI binary 只来自服务端配置，使用 `spawn(binary, argv, { shell: false })`。
- 命令、参数、profile、超时、输出大小、工具目录和调用参数均有限制。
- 每次调用记录参数指纹、结果指纹、资源引用和执行状态，不记录明文 token。
- 执行前重新读取连接，确保禁用、删除或白名单变更立即生效。
- 删除连接时先禁用调用，再清理对应的本地 profile 凭据目录；清理失败会保留禁用记录以便重试。
- 授权会话通过 BullMQ `copilot.enterpriseAuthorization.run` 在云端执行，API 实例只创建、查询和取消会话。
- 用户从 LocalMind 打开三家官方 HTTPS 授权页；企业微信二维码由受鉴权的同源接口按需读取。
- 授权完成后自动刷新连接状态和工具目录，前端以 1.5 秒间隔轮询并更新设置页。
- 取消状态写入数据库，任意 worker 实例都能在 1 秒内发现并终止对应 CLI 子进程。
- 官方授权 URL 在 worker 内按平台域名白名单校验，未经校验的 URL 不会进入 GraphQL。
- 飞书 `device_code`、三家 token 和 Secret 仅存在 CLI 进程内存或云端 profile，不进入浏览器或授权会话表。

## 三家 CLI 契约

| 平台     | 授权状态                        | 工具发现                                   | 业务输出                | profile 隔离                                         |
| -------- | ------------------------------- | ------------------------------------------ | ----------------------- | ---------------------------------------------------- |
| 企业微信 | `wecom-cli auth show --status`  | `wecom-cli schema list`                    | `--json`，分页为 NDJSON | `WECOM_CLI_CONFIG_DIR`                               |
| 飞书     | `lark-cli auth status --json`   | `lark-cli schema`                          | `--format json`         | `LARKSUITE_CLI_CONFIG_DIR`、`LARKSUITE_CLI_DATA_DIR` |
| 钉钉     | `dws auth status --format json` | `dws schema --all --compact --format json` | `--format json`         | `DWS_CONFIG_DIR`、`DWS_KEYCHAIN_DIR`                 |

企微 schema 没有统一风险元数据，因此只对白名单中的明确读取命令判定为 `read`，其余默认按写操作处理。飞书使用 `_meta.risk`。钉钉同时使用 `effect`、`risk` 和 `confirmation=user_required`。

## 云端授权流程

```text
LocalMind 设置页
  -> GraphQL 创建授权会话
  -> BullMQ copilot 队列
  -> 云端 worker 启动平台 CLI
  -> CLI 返回官方 URL、二维码或用户码
  -> worker 校验域名并更新数据库
  -> LocalMind 前端轮询并打开官方页面
  -> CLI 在云端等待官方授权完成
  -> worker 刷新工具目录并标记 AUTHORIZED
```

三家具体命令：

```text
wecom-cli auth init --noninteractive --no-browser --output-qrcode authorization-<session-id>.png
lark-cli auth login --recommend --no-wait --json
lark-cli auth login --device-code <仅 worker 内存可见> --json
dws auth login --device --no-browser --recommend --format json
```

- 企业微信：官方 URL 只允许 `work.weixin.qq.com`；二维码按授权会话唯一命名，临时写入当前 profile 并在终态后删除。
- 飞书：官方 URL 只允许 `feishu.cn` 和 `larksuite.com` 的根域或子域；`device_code` 不落库。首次连接分为两个明确步骤：先点击“配置飞书 CLI 应用”在官方页面创建或选择 CLI 应用；云端 CLI 生成用户权限授权 URL 后，LocalMind 将按钮更新为“授权飞书 CLI”，用户再次点击并完成权限授权。该流程不依赖浏览器跨域窗口自动跳转。
- 钉钉：官方 URL 只允许 `dingtalk.com`、`dingtalk.cn` 和 `dingtalk.io` 的根域或子域；不启动 `127.0.0.1` loopback callback。
- 钉钉：设备授权完成但组织尚未开启 CLI 数据访问时，LocalMind 的定制 CLI 会用内存中的用户令牌向钉钉返回的首位主管理员发送官方开通申请，并轮询审批结果；令牌和管理员标识不会进入浏览器或授权会话表。
- 钉钉：主管理员批准后，如推荐权限仍需当前用户确认，CLI 会继续轮询 `open-dev.dingtalk.com` 的个人权限流程；LocalMind 将官方链接更新为“授权钉钉 CLI”，用户确认后才把连接标记为已授权。

授权会话表只保存连接/用户/工作区、状态、官方 URL、用户可见验证码、二维码相对文件名、过期时间和脱敏错误。GraphQL 不暴露二维码文件名，只返回同源 `qrCodeUrl`。

## 配置

```text
LOCALMIND_ENTERPRISE_CLI_ENABLED=false
LOCALMIND_ENTERPRISE_CLI_ROOT_DIR=/var/lib/localmind/enterprise-cli
LOCALMIND_WECOM_CLI_BINARY=wecom-cli
LOCALMIND_LARK_CLI_BINARY=lark-cli
LOCALMIND_DINGTALK_CLI_BINARY=dws
```

`Dockerfile.localmind` 已在云端 runtime 镜像中安装并构建期验证以下固定版本：

```text
@wecom/cli@1.1.0
@larksuite/cli@1.0.87
dingtalk-workspace-cli@1.0.58-localmind.3
```

版本可以通过同名 Docker build args 升级，但升级前必须重新审核命令、输出 schema、授权流程和凭据存储行为。企业 CLI 默认关闭，部署时仍需显式设置 `LOCALMIND_ENTERPRISE_CLI_ENABLED=true`。

## 生产部署要求

1. 三家 CLI 必须安装在处理 `copilot` 队列的云端 worker 镜像中，不依赖用户电脑。
2. `LOCALMIND_ENTERPRISE_CLI_ROOT_DIR` 必须是持久化卷。处理授权任务的 worker、执行企业工具的 AI 实例和提供二维码接口的所有 API 实例必须挂载同一个卷和相同路径；多副本部署需要支持 `ReadWriteMany`。
3. Redis/BullMQ 必须在 API 与 worker 间共享；授权 Job 不自动重试，失败由用户在 LocalMind 重新发起。
4. profile 目录应只对服务进程可读写，并纳入备份排除、密钥轮换和节点下线清理策略。
5. 多副本部署不能使用容器临时盘，否则授权完成后的 token 会随调度丢失，二维码请求也可能落到看不到文件的 API 实例。
6. 上线前执行两条迁移：`20260818000000_ai_enterprise_connections` 和 `20260818010000_ai_enterprise_authorization_sessions`。

### 钉钉 Linux 凭据与多副本

固定版本 `dingtalk-workspace-cli@1.0.58` 在 Linux 上使用随机 file-DEK 和 AES-256-GCM。`DWS_KEYCHAIN_DIR` 下的 `dws-cli/dek` 与 token 密文必须作为同一个 profile 整体持久化；完整目录可被另一 Linux Pod 读取，不依赖新 Pod 的 MAC 地址。上游代码中的 MAC 地址只用于迁移旧版凭据格式，历史 profile 不能只复制配置文件，应该使用 `dws auth export/import` 或重新授权。

共享凭据目录解决的是可用性，不等于并发控制。同一 LocalMind 连接的授权、token 刷新和业务命令需要路由到同一执行分区或通过分布式锁串行化，避免两个 Pod 同时轮换 refresh token。单副本部署不受此限制。

## 后续阶段

写操作还需要独立的 LocalMind 确认票据，票据必须绑定用户、连接、工具、参数指纹和过期时间。不能让模型通过传入 `confirmed: true` 自行绕过确认。
