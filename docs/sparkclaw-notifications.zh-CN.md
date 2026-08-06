# LocalMind 主动推送 SparkClaw 通知

LocalMind 可以通过 ISCP Relay 主动把文档和评论中的 `@` 提及发送给用户已连接的 SparkClaw。SparkClaw Bridge 主动建立出站 WebSocket，因此运行 SparkClaw 的电脑不需要公网 IP，也不需要开放入站端口。

## 用户操作

1. 在 LocalMind 的“账户设置 > 集成”中点击“连接” SparkClaw。
2. 在运行 SparkClaw 的电脑上进入 SparkClaw 源码仓库，并执行页面显示的一条命令。
3. 回到 LocalMind 点击“完成”。连接状态会显示在同一页面。

脚本会构建现有的 `iscp-bridge`、在本机生成设备密钥、完成一次性注册，并安装为 launchd、systemd 用户服务或后台进程。SparkClaw Gateway 使用默认无鉴权配置时不需要额外操作；如果 Gateway 配置了 API token，执行命令前只需设置 `SPARKCLAW_API_TOKEN`。

通知可在“设置 > 通知 > SparkClaw 通知”中关闭。LocalMind 只发送通知类型和指向原文的链接，不发送文档标题、正文或评论内容。

## 服务端部署

ISCP 服务属于可选 Compose profile。为 LocalMind 服务端设置以下变量：

```dotenv
ISCP_ENABLED=true
ISCP_CONTROLLER_TOKEN=<至少 32 个随机字符>
ISCP_RELAY_PUBLIC_BASE_URL=https://localmind.example.com/iscp
ISCP_RELAY_PUBLIC_WS_URL=wss://localmind.example.com/iscp/v2/relay/connect
```

然后启动：

```sh
docker compose -f .docker/selfhost/compose.localmind.yml --profile iscp up -d
```

反向代理需要将 `/iscp/v2/relay/connect` 的 WebSocket 请求转发到本机 `${ISCP_RELAY_PORT:-8080}`，并将 `/iscp/v2/relay/envelopes` 与 `/iscp/v2/relay/devices/refresh-access` 转发到本机 `${ISCP_CONTROLLER_PORT:-8091}`。转发时去掉 `/iscp` 前缀。公网入口必须使用有效证书的 HTTPS/WSS；内部 Controller token 不得暴露给浏览器或 SparkClaw。

Controller 的状态目录保存 LocalMind Trust Root 和 peer 私钥，数据库保存 Relay 凭证及消息队列。两者都必须持久化和备份。

## 当前兼容性边界

当前 SparkClaw 没有被动通知 capability。LocalMind 暂时使用 `agent.message.send.v1` 投递到专用 Agent session，这能让 SparkClaw Runtime 收到消息，但 SparkClaw WebChat 尚不能保证在任意页面显示全局红点或 toast。LocalMind 不会为了通知执行工具或修改文档；原生全局提示需要 SparkClaw 增加被动通知协议和 UI 支持。
