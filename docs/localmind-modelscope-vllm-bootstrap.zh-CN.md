# LocalMind 本地模型一键启动方案记录

> 状态：需求分析与实现设计，尚未实现脚本，也未下载或启动模型。
>
> 目标设备：一台 Spark GX10。用户说明模型位于 `Documents/data` 一类目录下，
> 但实现前仍需确认该目录在 GX10 上的绝对路径、大小写和挂载方式。

## 1. 需求

提供一套可以从未安装 LocalMind 的机器开始执行的一键脚本，支持两条入口：

1. **魔搭下载模式**：从魔搭社区下载指定模型到固定模型根目录，启动 vLLM，
   将该服务注册为 LocalMind 的 OpenAI-compatible provider，然后启动或刷新
   LocalMind。
2. **本地发现模式**：扫描指定的本机模型根目录，选择一个已经存在且可由 vLLM
   加载的模型，启动 vLLM，配置 LocalMind，然后启动或刷新 LocalMind。

期望最终使用方式类似：

```sh
yarn localmind:model up \
  --source modelscope \
  --model Qwen/example-model \
  --model-root /absolute/path/Documents/data/models \
  --served-model-name example-model
```

```sh
yarn localmind:model up \
  --source local \
  --model-dir /absolute/path/Documents/data/models/modelscope/Qwen/example-model \
  --served-model-name example-model
```

交互式扫描可以作为便利入口，但必须同时支持完整的非交互参数，便于 systemd、
CI 或远程运维调用。

## 2. 当前仓库可以复用的能力

LocalMind 已有本地模型接入所需的主要运行时边界：

- `copilot.providers.profiles` 支持多个 provider profile；
- `openaiCompatible` 已明确支持 vLLM；
- provider profile 可以声明 `privacy: "local"`、模型 ID、模型定义和优先级；
- `copilot.providers.defaults` 可以设置 text、structured 和 fallback provider；
- `copilot.prompts.defaults` 可以把文本 prompt 指向具体的
  `<provider-id>/<model-id>`；
- Provider Health 支持本地合同检查，并可通过
  `LOCALMIND_PROVIDER_HEALTH_NETWORK_PROBE=1` 启用真实最小文本探测；
- 自托管 LocalMind 已将持久配置目录挂载到容器内
  `/root/.affine/config`。

因此，这个脚本不应新增另一套推理协议或模型注册表。它应负责模型文件和 vLLM
进程的生命周期，再复用现有 OpenAI-compatible profile 和模型路由。

### 2.1 `codex/local-model-runtime` 分支调研

2026-08-26 只读检查了本地和 `origin` 的 `codex/local-model-runtime`。两者都指向
`ee6d41558e6bd9aeb6a9e72161a81c00b03957d9`，对应 worktree 干净，并已合入当前
`origin/main`。该分支相对 `main` 有四个提交，其中实际功能提交主要是 Qwen3.6
运行时适配和后续加固。

该分支**没有**实现以下内容：

- ModelScope 默认缓存探测或模型下载；
- vLLM 安装、启动、停止、重启或持久化 service；
- LocalMind 仓库 clone/ff-only 更新；
- 一键生成自托管 `.env`、配置 provider 并启动 Compose；
- `localmind:model` package script；
- Compose vLLM service 或宿主机 `host-gateway`。

该分支已经提供、可以复用的能力是：

- Qwen3.6 专属 model adapter、route lock、工具策略、completion evidence 和
  capability release gate；
- `qwen3.6-35b-a3b` 与 `qwen3.6-35b-a3b-fp8` 的精确 adapter 匹配；
- 其他模型使用 `passthrough` adapter，继续走通用 provider 行为；
- Qwen3.6 认证 runner 可以临时切换 provider/default route、重启 LocalMind、执行
  MCP 场景并恢复配置；
- 已验证的 Qwen3.5 vLLM 启动参数，包括单并发、Qwen tool parser 和
  `enable_thinking=false`；
- Qwen3.6 实机记录使用 `qwen-lan`、`qwen3.6-35b-a3b` 和
  `http://192.168.20.207:8000/v1` 完成过端到端接入。

分支也明确暴露了当前缺口：实机 vLLM 是 transient systemd service，GPU 服务器重启
后需要人工重启；Qwen3.6 capability 仍处于 `testing`、`disabled` 或 `unavailable`，
生产 release gate 尚未通过。因此一键脚本可以把模型 endpoint 配置成可用 provider，
但不能把“vLLM 健康”描述成“所有 LocalMind Agent 功能均已认证可用”。

认证 runner 只适合测试，不能直接变成部署脚本。它会写完整配置文件、重启容器，并为
隔离评测直接操作特定数据库 route/credential。生产脚本只能复用其环境变量、配置快照、
等待就绪和 finally 恢复思路，不能复用直接 SQL 或测试 credential 写入方式。

生产 bootstrap 不应默认部署功能分支。应先把需要的 Qwen adapter 变更经过评审落入
`main`，脚本再默认 clone `main`。开发认证可以显式传
`--repo-ref codex/local-model-runtime`，但最终报告必须标为 evaluation deployment，
不能与主线生产部署混淆。

## 3. 关键约束

### 3.1 模型目录不能靠猜测

用户描述的 `document/data` 目前不是足够明确的绝对路径。Linux 路径区分大小写，
`document/data`、`Documents/data` 和独立数据盘挂载点可能完全不同。

建议解析顺序：

1. 显式 `--model-dir`，直接使用一个已有 snapshot；
2. 命令行 `--model-root` 或 `LOCALMIND_MODEL_ROOT`，作为 ModelScope
   `cache_dir` 覆盖；
3. 都没有时使用 GX10 上安装的 ModelScope SDK 默认 cache；
4. 实际 snapshot 路径始终以 SDK 返回值为准。

首次下载前必须显示解析后的 cache root、目标文件系统和剩余空间。脚本不能静默把模型
下载到仓库目录，也不能因为用户提到 `Documents/data` 就猜测一个不存在的路径。

实现前应在 GX10 上确认：

- 模型根目录的绝对路径；
- 目录所在文件系统和剩余容量；
- LocalMind 与 vLLM 是否运行在同一台 GX10；
- LocalMind 是宿主机进程还是 Docker Compose 容器。

### 3.2 LocalMind 配置存在多层优先级

当前服务会依次读取仓库内默认配置和持久化目录中的 `config.json`，启动后还会加载
数据库中的 Admin 配置覆盖。数据库覆盖的优先级高于文件。

这意味着：

- 脚本不得修改并提交 `packages/backend/server/config.json`；
- 新部署可以原子更新 `CONFIG_LOCATION/config.json`；
- 已通过 Admin 保存过 AI 配置的实例，仅修改文件可能不会生效；
- 已运行实例应通过受支持的 Admin GraphQL mutation 更新配置，并保留操作者身份；
- 不能为了“一键”直接修改 PostgreSQL 配置表或删除既有 DB override。

当前仓库没有面向无人值守脚本的部署管理员 token 流程。若第一版要覆盖“已有运行中
实例的一键配置”，需要在以下方案中选一个：

1. 使用管理员已登录会话，通过受支持的 `updateAppConfig` mutation 写入；
2. 新增一个容器内受控的部署配置 CLI，复用配置校验、持久化和审计语义；
3. 第一版只支持新部署或确认没有冲突 DB override 的实例，已有实例输出配置差异并
   引导管理员在 Admin 中确认。

推荐先完成第 3 项，再设计第 2 项。脚本不应接收明文管理员密码，也不应把 Cookie、
API key 或 vLLM token 放在命令行参数中。

### 3.3 容器中的 `127.0.0.1` 不是 GX10 宿主机

如果 vLLM 在 GX10 宿主机运行，而 LocalMind 在 Compose 容器中运行，LocalMind
profile 里的 `http://127.0.0.1:8000/v1` 会指向 LocalMind 容器本身，不会到达
vLLM。

支持形态应明确区分：

| vLLM         | LocalMind | LocalMind 使用的 endpoint               | 说明                                               |
| ------------ | --------- | --------------------------------------- | -------------------------------------------------- |
| 宿主机       | 宿主机    | `http://127.0.0.1:<port>/v1`            | 最简单，但不是当前标准 Compose 部署                |
| 宿主机       | Compose   | `http://host.docker.internal:<port>/v1` | Linux Compose 需增加 `host-gateway` 映射           |
| 同一 Compose | Compose   | `http://vllm:<port>/v1`                 | 网络稳定，但要解决 GPU runtime、镜像和模型目录挂载 |
| 另一台 GX10  | Compose   | `http://<gx10-lan-ip>:<port>/v1`        | 需要防火墙、鉴权和明确 LAN 地址                    |

当前 `compose.localmind.yml` 尚未声明 `host.docker.internal:host-gateway`，也没有
vLLM service。第一版若采用“宿主机 vLLM + Compose LocalMind”，实现任务需要同步
补上可预测的宿主机网络入口，不能把某个临时 Docker bridge IP 写死。

### 3.4 聊天模型不能覆盖 embedding/rerank

普通生成模型只应配置 text 路由。除非另外下载、启动并验证 embedding 或 rerank
模型，否则脚本必须保留现有：

- `copilot.providers.defaults.embedding`；
- `copilot.providers.defaults.rerank`；
- `copilot.tasks.models.embedding`；
- `copilot.tasks.models.workspaceIndexing`；
- `copilot.tasks.models.rerank`。

脚本不得因为新增了一个 vLLM chat endpoint，就把工作区索引和重排也指向该模型。

## 4. 模型缓存与运行状态目录

用户要求优先检查魔搭默认下载目录。该目录不能由 LocalMind 自己拼接，因为
ModelScope 新旧版本存在不同缓存布局，而且 `MODELSCOPE_CACHE`、`cache_dir` 和
`local_dir` 都能改变位置。

脚本应调用 GX10 上实际安装的 ModelScope SDK：

1. 先调用 `snapshot_download(model_id, revision, local_files_only=True)`；
2. 成功时使用 SDK 返回的绝对 snapshot 路径，不重新下载；
3. 仅在明确的“本地缓存不存在”错误时，再调用
   `snapshot_download(model_id, revision, local_files_only=False)`；
4. 下载完成后仍使用 SDK 返回路径，不假设 `<namespace>/<model>` 的内部层级；
5. 不能把鉴权失败、revision 不存在或缓存损坏误判为“未下载”后无限重试。

ModelScope 当前兼容入口支持 `local_files_only`，并会尝试复用旧缓存布局；这比写死
`~/.cache/modelscope/hub/...` 更可靠。用户显式传入 `--model-root` 时，将该值作为
ModelScope `cache_dir`，仍由 SDK 管理其内部布局。

LocalMind 自己只管理独立的运行状态目录。以 `<STATE_ROOT>` 表示用户确认的数据盘位置：

```text
<MODELSCOPE_CACHE>/
  <由 ModelScope SDK 管理的 snapshot 布局>

<STATE_ROOT>/
  .localmind-model-runtime/
    manifests/
    locks/
    logs/
    pids/
    tmp/
```

约束：

- 模型位置以 ModelScope 返回的 snapshot 绝对路径为准；
- revision 必须固定并写入 LocalMind manifest；
- 下载恢复和临时文件优先交给 ModelScope SDK，LocalMind 不移动 SDK 正在管理的缓存；
- 下载中断保留可恢复状态，不自动删除大型模型文件；
- 运行状态、日志和锁不能混入模型快照目录；
- `--source local` 先查询 ModelScope 默认 cache，再扫描显式 `--model-root`；
- 允许显式 `--model-dir` 指向根目录外模型时，应要求额外确认参数；
- 扫描时忽略 ModelScope partial、隐藏目录、运行状态目录和不完整快照。

模型 manifest 至少记录：

```json
{
  "source": "modelscope",
  "sourceModelId": "Qwen/example-model",
  "revision": "pinned-revision",
  "localPath": "/absolute/path/to/model",
  "servedModelName": "example-model",
  "downloadedAt": "ISO-8601 timestamp",
  "configFingerprint": "sha256-of-small-metadata",
  "weightFiles": ["bounded relative file list"]
}
```

不建议每次启动都对数百 GB 权重做完整哈希。应固定上游 revision，检查配置、权重
索引、文件存在性和小型 manifest 指纹；完整校验可以作为显式的 `verify --full`。

## 5. 建议的命令设计

脚本应分成两层。

第一层是无需仓库即可运行的 `scripts/localmind-bootstrap.sh`。它只负责环境预检、仓库
获取和把参数传给仓库内编排器：

- 仓库不存在时从 `Infinimesh-ai/LocalMind` clone `main`；
- 仓库存在时核对 remote、branch 和 dirty worktree；
- 只执行 `fetch` 和 `pull --ff-only`，失败时停止，不自动 merge、rebase 或 reset；
- 记录实际部署 commit；
- 然后执行该 commit 内的 `yarn localmind:model up`。

bootstrap 应作为带 SHA-256 校验的 release artifact 或由运维预先放到 GX10，避免不经
审核直接 `curl | sh`。仓库目录通过 `--repo-dir` 或 `LOCALMIND_REPO_DIR` 指定，不能
覆盖一个来源不明或有未提交改动的目录。

第二层是仓库内的 `tools/localmind-model-runtime.mjs`。仓库已有 Node.js 22 和
`tools/*.mjs` 模式；该编排器负责模型、vLLM、配置、Compose 和验证。所有外部命令通过
参数数组执行，不拼接 shell 字符串；ModelScope 和 vLLM 仍运行在独立 Python 环境中。

计划入口：

```text
yarn localmind:model preflight
yarn localmind:model discover
yarn localmind:model download
yarn localmind:model serve
yarn localmind:model configure
yarn localmind:model up
yarn localmind:model status
yarn localmind:model stop
```

`up` 是组合命令，内部顺序为：

```text
加锁
  -> 环境预检
  -> 下载或发现模型
  -> 校验模型快照
  -> 解析 vLLM 启动参数
  -> 启动并等待 /v1/models
  -> 最小 chat/completions 探测
  -> 生成 LocalMind 配置差异
  -> 原子配置或经 Admin API 配置
  -> 启动/刷新 LocalMind
  -> 从 LocalMind 容器验证 endpoint 可达
  -> 验证 LocalMind 模型路由
  -> 写入无 secret 的运行 manifest
```

完整的一键入口顺序建议是：

```text
bootstrap 自检
  -> clone 或 ff-only 更新 LocalMind main
  -> 执行当前 commit 的 localmind:model up
  -> ModelScope local_files_only 检查默认 cache
  -> 缺失时下载固定 revision
  -> 按模型运行 profile 生成 vLLM 参数
  -> 安装/刷新脚本拥有的 systemd service
  -> vLLM 健康和最小生成探测
  -> 生成并校验 LocalMind 配置差异
  -> Compose config/migration/build/up
  -> LocalMind 容器到 vLLM 的连通性与路由探测
  -> 输出 commit、model revision、端口、服务和验证摘要
```

先获得项目再执行模型编排，比在一个长期不更新的外部 shell 中实现全部模型逻辑更安全；
模型缓存仍会在下载前检查，已有 snapshot 不会重复下载。

### 5.1 建议的文件边界

| 文件                                            | 职责                                                |
| ----------------------------------------------- | --------------------------------------------------- |
| `scripts/localmind-bootstrap.sh`                | clone/ff-only 更新仓库并调用版本化编排器            |
| `tools/localmind-model-runtime.mjs`             | CLI、加锁、阶段编排、配置 diff、Compose 和验证      |
| `tools/localmind-model-runtime/modelscope.py`   | SDK cache-only 探测、下载和 snapshot 元数据输出     |
| `tools/localmind-model-runtime/profiles/*.json` | 经验证的模型到 vLLM/LocalMind 参数映射，不含 secret |
| `tools/localmind-model-runtime/*.test.mjs`      | 路径、幂等、端口冲突、配置 merge 和失败恢复测试     |
| `package.json`                                  | 暴露 `localmind:model` 命令                         |
| `.docker/selfhost/compose.localmind.yml`        | 为宿主机 vLLM 增加可预测的 `host-gateway`           |
| `.docker/selfhost/.env.example`                 | 记录 endpoint/端口和模型 runtime 的非敏感开关       |

模型 profile 必须版本化。Qwen3.5/3.6 profile 可以复用分支实测参数和稳定 model ID，
其他模型先使用保守通用 profile；不能给所有从 ModelScope 发现的模型强行加
`qwen3_xml`、thinking、量化或 context 参数。

所有修改命令都应支持：

```text
--dry-run
--yes
--json
--timeout <seconds>
```

`--dry-run` 必须显示将使用的模型目录、端口、endpoint、LocalMind 配置 key 和需要
重启的服务，但不得显示 secret。

## 6. 模型发现和下载

### 6.1 魔搭下载模式

第一版只接受明确的：

- 魔搭 model ID；
- 固定 revision；
- 可选的 cache root 覆盖；
- 对外提供的稳定 `servedModelName`。

不要默认跟随一个可变的最新 revision。若用户省略 revision，脚本可以先解析当前
revision，再将解析结果写入 manifest 并要求确认。

下载前预检：

- ModelScope CLI/Python 包版本；
- 目标目录可写；
- 磁盘可用空间和 inode；
- 网络连通性；
- 同名目录是否为完整的同 revision 快照；
- 是否已有另一个下载/启动操作持有锁。

存在性检查和下载必须是同一个 Python helper 的两个阶段，输出结构化 JSON，例如：

```json
{
  "status": "cached",
  "modelId": "Qwen/example-model",
  "revision": "pinned-revision",
  "snapshotPath": "/absolute/path/returned/by/modelscope"
}
```

Node 编排器只消费结构化结果，不解析 ModelScope 的人类日志，也不自行推导默认 cache
目录。

模型仓库可能要求执行自定义代码。`trust_remote_code` 默认关闭，只能通过显式参数
开启，并在 dry-run 和最终报告中突出显示。

### 6.2 本地发现模式

候选目录至少要有：

- `config.json`；
- tokenizer 配置或处理器配置；
- safetensors 权重、权重索引或 vLLM 明确支持的其他格式；
- 不存在下载未完成标记。

发现结果应显示模型架构、精度/量化信息、权重总大小、mtime、推测的 context length
和是否需要 `trust_remote_code`，但“推测”不能直接变成未经确认的 vLLM 参数。

第一版建议以 Hugging Face/ModelScope snapshot 目录为正式支持范围。GGUF、多个 LoRA、
多模态处理器和自定义量化后端分别作为显式扩展，不能仅因目录中有一个权重文件就
宣称可启动。

## 7. vLLM 生命周期

基线命令形态：

```sh
vllm serve /absolute/path/to/model \
  --served-model-name example-model \
  --host 0.0.0.0 \
  --port 8000
```

实际参数必须由预检和用户配置确定：

- 单 GPU 默认不主动设置 `--tensor-parallel-size`；
- `--dtype`、量化后端和最大 context length 不靠模型名称猜测；
- `--gpu-memory-utilization` 提供保守默认值并允许覆盖；
- 不因启动 OOM 自动反复降低精度或 context length；
- `servedModelName` 使用不含 `/` 的稳定 ID，避免与 LocalMind 的
  `<provider-id>/<model-id>` 路由形式混淆；
- 端口被非本脚本进程占用时停止，不能杀死未知进程；
- endpoint 已存在时，必须比较 `/v1/models`、进程 manifest 和请求模型 ID，匹配才
  可幂等复用。

`codex/local-model-runtime` 的实测说明还需要模型专属启动 profile：

- Qwen3.5 已验证 `--enable-auto-tool-choice --tool-call-parser qwen3_coder` 和
  `--default-chat-template-kwargs '{"enable_thinking":false}'`；
- Qwen3.6 部署记录使用 Qwen XML parser、单并发和固定 served model ID；
- `--max-model-len 262144`、FP8、`--gpu-memory-utilization 0.95` 等是特定 48 GB
  测试机结果，不能直接作为 Spark GX10 默认值；
- Qwen3.6 若要命中分支专属 adapter，served model ID 必须规范为
  `qwen3.6-35b-a3b` 或 `qwen3.6-35b-a3b-fp8`；
- 未命中专属 adapter 的模型会走 `passthrough`，脚本应在最终报告中明确这一点。

Spark GX10 需要额外预检 CPU 架构、NVIDIA driver、CUDA、可见 GPU、统一内存/显存、
Python 和 vLLM wheel/container 的兼容性。不能把普通 x86 CUDA 服务器的安装命令直接
视为 GX10 可用方案。

进程管理建议：

1. 开发阶段可使用脚本拥有的 PID、日志和锁文件；
2. 稳定部署优先生成 `systemd --user` unit 或使用一个明确的 Compose vLLM profile；
3. `stop` 只停止 manifest 中由脚本启动且进程身份匹配的 vLLM，不按名称批量杀进程；
4. 模型启动失败不删除已下载模型；
5. LocalMind 配置失败时停止是否仍保留 vLLM 由显式策略决定，默认保留并报告。

## 8. LocalMind provider 配置

对一个只验证过文本生成的本地模型，建议生成类似 profile：

```json
{
  "id": "local-vllm-chat",
  "displayName": "Local vLLM",
  "type": "openaiCompatible",
  "enabled": true,
  "priority": 200,
  "privacy": "local",
  "models": ["example-model"],
  "modelDefinitions": [
    {
      "id": "example-model",
      "rawModelId": "example-model",
      "backendKind": "openai_chat",
      "protocol": "openai_chat",
      "requestLayer": "chat_completions",
      "capabilities": [
        {
          "input": ["text"],
          "output": ["text"],
          "defaultForOutputType": true
        }
      ]
    }
  ],
  "config": {
    "baseURL": "http://host.docker.internal:8000/v1",
    "apiStyle": "chat_completions"
  }
}
```

只有通过 LocalMind structured-output 和 tool-call 聚焦验证后，才把 `object`、
`structured` 或相关行为标志加入 capability。模型目录存在不等于它能可靠完成这些
协议行为。

配置策略：

- 新部署可以把 `providers.defaults.text` 和 `fallback` 指向
  `local-vllm-chat`；
- 已有部署默认只追加或更新脚本拥有的 `local-vllm-chat` profile；
- 是否替换现有 text/fallback 必须由 `--make-default` 明确指定；
- 修改 `prompts.defaults.text` 前保存并展示旧值；
- 不覆盖其他 provider、route policy、BYOK 设置、prompt override、embedding 或
  rerank 配置；
- profile 更新按稳定 ID 做结构化 merge，不能用文本替换 JSON；
- 配置文件先写同目录临时文件，校验 JSON/schema，再原子替换；
- 每次写入前创建权限受限的时间戳备份，最终报告只记录备份路径，不输出内容。

若启用 vLLM API key，secret 应来自权限受限文件或 secret store。不能写入 Git、命令行、
日志、模型 manifest 或最终报告。

## 9. 验证和成功标准

脚本只有完成以下检查，才能报告“模型已配置并可用”：

1. 模型快照通过结构校验；
2. vLLM 进程仍存活且未处于重启循环；
3. `GET /v1/models` 返回完全匹配的 `servedModelName`；
4. 最小 `POST /v1/chat/completions` 返回非空文本；
5. 从 `localmind_affine_server` 容器内可访问同一 endpoint；
6. LocalMind 生效配置中存在目标 profile 和模型定义；
7. LocalMind 模型诊断能够解析 `<provider-id>/<model-id>`；
8. 若模型被设为默认，至少执行一次经过 LocalMind provider runtime 的最小文本请求；
9. 若声明 structured/tool 能力，分别执行对应能力探测；
10. LocalMind、PostgreSQL、Redis 和 migration 状态仍满足现有部署指南。

`/v1/models` 成功不能代替文本生成测试，vLLM 直连成功也不能代替 LocalMind 容器内
连通性和 LocalMind 路由测试。

## 10. 幂等、失败和回滚

脚本应维护一个不含 secret 的运行 manifest，并对每个阶段采用幂等判断：

- 同 model ID、revision、目录已完整：复用，不重复下载；
- 同模型和启动参数的 vLLM 已健康：复用，不重复启动；
- 端口上是其他模型或未知进程：停止并报告；
- LocalMind profile 已是目标值：不重复写配置；
- 旧配置与目标值不同：先备份，再展示结构化差异；
- 任一步骤失败：保留模型和日志，不删除 LocalMind 数据或 Docker volume。

回滚边界：

- 文件配置写入失败：原子替换前不触碰旧文件；替换后失败则恢复备份；
- Admin API 写入失败：使用同一受支持 API 恢复脚本读取到的旧配置；
- LocalMind 启动失败：保留数据库和持久目录，按现有部署协议排查；
- vLLM 启动失败：只停止脚本确认拥有的进程；
- 模型下载失败：保留 ModelScope partial/cache 供 SDK 恢复，除非用户明确执行清理命令；
- 任何路径都不得运行 `docker compose down -v` 或删除 LocalMind 持久化目录。

## 11. 分阶段实现建议

### 阶段 A：GX10 环境确认

- 确认 `Documents/data` 的绝对路径；
- 确认 LocalMind/vLLM 的网络拓扑；
- 确认 GX10 的 vLLM 安装或容器基线；
- 选定一个小型已知模型做首次端到端验证。

### 阶段 B：只读预检和本地模型启动

- 实现 `preflight`、`discover`、`serve`、`status`、`stop`；
- 支持 `--dry-run`；
- 完成 vLLM 直连和 LocalMind 容器内连通性检查；
- 暂不修改 LocalMind 配置。

### 阶段 C：魔搭固定 revision 下载

- 加入 ModelScope cache-only 探测、下载恢复、manifest 和磁盘检查；
- 验证重复执行不会重复下载或破坏已有快照。

### 阶段 D：LocalMind 新部署配置

- 结构化合并 `CONFIG_LOCATION/config.json`；
- 只管理固定 profile ID；
- 保留现有 embedding/rerank 和其他 provider；
- 完成配置备份、schema 校验、LocalMind 启动和路由验证。

### 阶段 E：已有实例的受控配置

- 决定 Admin 会话或容器内部署 CLI 方案；
- 复用配置校验和持久化逻辑，不直写数据库；
- 增加操作者、前后配置指纹和回滚证据；
- 最终组合为真正的 `up` 一键流程。

### 阶段 F：可选扩展

- 独立 embedding/rerank 模型和端口；
- 多模型、多 GPU 和 tensor parallel 配置；
- vLLM Compose profile 或 `systemd --user` 管理；
- 模型升级、蓝绿端口切换和健康回退；
- Admin 中的本地模型状态和一键探测界面。

## 12. 实现前待确认项

1. GX10 上模型目录的准确绝对路径是什么？
2. LocalMind 是否也运行在这台 GX10 的 Docker Compose 中？
3. 第一批模型的魔搭 model ID、revision、用途和预计大小是什么？
4. 第一版只接聊天模型，还是同时管理 embedding/rerank？
5. vLLM 使用宿主机 Python、NVIDIA 容器还是现有 systemd 服务？
6. vLLM endpoint 只供本机 Compose 使用，还是需要供局域网其他机器访问？
7. 已有 LocalMind 是否通过 Admin 保存过 AI 配置？
8. 新本地模型是否要自动成为 text/fallback 默认模型？

在这些信息确认前，可以实现通用的 dry-run、目录扫描和配置差异生成，但不应把
GX10 路径、LAN IP、模型参数、API key 或默认路由硬编码进仓库。
