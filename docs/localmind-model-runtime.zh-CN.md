# LocalMind 本地模型一键运行

本文提供两种入口：空目录 bootstrap 会 clone 固定的 `codex/local-model-runtime` 分支；
仓库内运行器负责发现或下载 ModelScope 模型、启动 vLLM、合并 LocalMind 文件配置并启动
Compose。仓库内运行器本身不会 clone、pull、merge、切换或提交任何 Git 分支。

## 1. 从空目录部署固定 Qwen3.6

在空目录中下载独立脚本并执行：

```sh
curl -fsSLO \
  https://raw.githubusercontent.com/Infinimesh-ai/LocalMind/refs/heads/codex/local-model-runtime/scripts/localmind-qwen36-bootstrap.sh
sh localmind-qwen36-bootstrap.sh
```

已有完整本地 snapshot 时，用户可以直接选择目录，跳过 ModelScope 缓存查询和下载：

```sh
sh localmind-qwen36-bootstrap.sh \
  --model-dir /absolute/path/to/Qwen3.6-35B-A3B-FP8
```

也可以通过环境变量选择：

```sh
LOCALMIND_MODEL_DIR=/absolute/path/to/Qwen3.6-35B-A3B-FP8 \
sh localmind-qwen36-bootstrap.sh
```

`--model-dir` 必须指向实际 snapshot，而不是 Hugging Face/ModelScope 缓存根目录。目录中
必须能直接看到 `config.json`、tokenizer 和权重或权重索引。脚本会把它解析为物理绝对
路径并由仓库内运行器校验完整性。

需要下载固定 Qwen3.6，但希望模型直接安装到自己指定的最终目录时：

```sh
sh localmind-qwen36-bootstrap.sh \
  --download-dir /data/models/Qwen3.6-35B-A3B-FP8
```

也可以通过环境变量指定：

```sh
LOCALMIND_MODEL_DOWNLOAD_DIR=/data/models/Qwen3.6-35B-A3B-FP8 \
sh localmind-qwen36-bootstrap.sh
```

`--model-dir` 与 `--download-dir` 互斥：前者表示“已有完整模型，直接复用”，后者表示
“缺失时下载到这个最终目录”。相对路径会按执行脚本时的当前目录转换为绝对路径。

希望选择另一个 ModelScope `cache_dir`，但仍按固定模型 ID 和 revision 查找或下载时：

```sh
sh localmind-qwen36-bootstrap.sh --model-root /absolute/modelscope/cache
```

默认完整流程为：

1. clone `https://github.com/Infinimesh-ai/LocalMind.git` 的
   `codex/local-model-runtime` 单一分支到当前目录的 `LocalMind/`；
2. 检测并补齐 Node.js 22、Docker Engine/Compose、NVIDIA 驱动和隔离 Python 环境；
3. 在 `${HOME}/Documents/data` 检查固定 ModelScope snapshot，或按参数检查用户指定目录；
4. 缓存不存在时下载
   `Qwen/Qwen3.6-35B-A3B-FP8@62836cf634afbb2a90f3e0558ded9112afbf4660`；
5. 用 served model `qwen3.6-35b-a3b` 启动或复用 `8000` 端口的 vLLM；
6. 强制构建固定镜像 `localmind-affine:local`，合并 provider 配置并启动 Compose；
7. 验证模型、最小对话、LocalMind HTTP 和容器到 vLLM 的连通性后才返回成功。

常用覆盖参数：

```sh
LOCALMIND_INSTALL_DIR=/opt/LocalMind \
LOCALMIND_MODEL_ROOT=/home/<user>/Documents/data \
LOCALMIND_RUNTIME_ROOT=/home/<user>/.local/share/localmind/qwen36-runtime \
LOCALMIND_MODEL_PORT=8000 \
LOCALMIND_MAX_MODEL_LEN=65536 \
LOCALMIND_GPU_MEMORY_UTILIZATION=0.8 \
sh localmind-qwen36-bootstrap.sh
```

已有 vLLM 运行在 Docker 容器中，且宿主机端口仅绑定到 `127.0.0.1` 时，LocalMind
容器无法通过 host gateway 访问该端口。两个容器位于同一 Docker 网络时，应同时指定
容器侧 endpoint，例如：

```sh
LOCALMIND_MODEL_PORT=8008 \
LOCALMIND_CONTAINER_MODEL_ENDPOINT=http://localmind_qwen36_vllm:8000/v1 \
sh localmind-qwen36-bootstrap.sh \
  --model-dir /absolute/path/to/Qwen3.6-35B-A3B-FP8
```

宿主机仍使用 `LOCALMIND_MODEL_PORT` 检查和复用 vLLM；只有 LocalMind provider 配置与
容器连通性验证使用 `LOCALMIND_CONTAINER_MODEL_ENDPOINT`。不要在 URL 中放入凭据。

`LOCALMIND_REPOSITORY_URL` 可指向内部 Git 镜像，但分支、模型 ID、revision、profile 和
served model 名不会被环境变量改变。安装目录已存在时，只有它是
`codex/local-model-runtime` checkout 才会被复用；其他目录会被拒绝，避免覆盖现有数据。

## 2. 前置条件

- Ubuntu 22.04/24.04 或 Debian 12，`amd64`/`arm64`，推荐 DGX Spark GX10；
- 可联网访问 GitHub、NodeSource、Docker、PyPI/PyTorch 和 ModelScope；
- 缺失系统包时，当前账号有 `sudo` 权限；
- 模型、Python wheel、Docker 构建缓存和 LocalMind 数据所需的充足磁盘空间；
- 使用 ModelScope 下载私有模型时，已在 SDK 支持的位置配置登录凭据。

bootstrap 的环境补全行为：

- Git 缺失时先通过系统 apt 仓库安装；
- Node.js 缺失或不是 `>=22.12.0 <23` 时，通过签名的 NodeSource 仓库安装 Node 22；
- Docker/Compose 缺失时，通过 Docker 官方签名仓库安装并启动；当前用户没有 socket
  权限时加入 `docker` 组，并为当前运行授予 socket ACL；
- 在 `${HOME}/.local/share/localmind/qwen36-runtime/venv` 创建隔离环境，固定安装
  `uv 0.12.6`、`ModelScope 1.39.1` 和 `vLLM 0.28.0`；
- vLLM 官方 wheel 带 CUDA 12.9 用户态组件，因此不安装非必要的系统 `nvcc` toolkit；
  安装后使用 PyTorch 实际验证 CUDA、GPU 名称和 compute capability；
- `nvidia-smi` 不可用时，DGX Spark 按 NVIDIA 官方 DGX OS 更新路径执行系统包升级，
  普通 Ubuntu NVIDIA 主机安装推荐驱动。驱动变更后脚本以退出码 `20` 停止，必须重启
  主机并再次运行同一 bootstrap；第二次运行会复用已 clone 的正确分支继续部署；
- Debian 支持其他环境补全，但不自动恢复缺失的 NVIDIA 驱动。

先执行只读预检：

```sh
yarn localmind:model preflight
```

## 3. 模型发现顺序

脚本按以下顺序定位模型：

1. 使用 `--model-dir` 时，直接校验该目录；
2. 使用 `--download-dir` 时，将它作为 ModelScope `local_dir`，模型缺失时直接下载到该
   最终目录；
3. 否则调用 ModelScope SDK，并以 `local_files_only=true` 查询默认缓存；
4. 使用 `--model-root` 时，将它作为 ModelScope `cache_dir`；
5. 只有 `up` 确认模型缺失后才联网下载；`discover` 永远不下载。

ModelScope 模式要求同时提供模型 ID 和 revision：

```sh
yarn localmind:model discover \
  --model Qwen/Qwen3.5-35B-A3B-FP8 \
  --revision <固定-revision>
```

不要依赖随时间移动的模型版本。生产部署应记录并复用经过验证的 revision。

脚本使用 SDK 返回的绝对 snapshot 路径，不拼接或猜测
`~/.cache/modelscope/...`。鉴权失败、revision 不存在和缓存损坏不会被当作普通的“尚未
下载”。下载失败时不会删除 ModelScope 已有缓存或 partial 文件。

## 4. 仓库内一键启动

ModelScope 默认缓存或下载：

```sh
yarn localmind:model up \
  --model Qwen/Qwen3.5-35B-A3B-FP8 \
  --revision <固定-revision> \
  --profile qwen35
```

下载到用户选择的最终模型目录：

```sh
yarn localmind:model up \
  --model Qwen/Qwen3.6-35B-A3B-FP8 \
  --revision <固定-revision> \
  --download-dir /data/models/Qwen3.6-35B-A3B-FP8 \
  --profile qwen36
```

Spark GX10 已有模型位于 `Documents/data` 时：

```sh
yarn localmind:model up \
  --model-dir /home/<user>/Documents/data/Qwen3.5-35B-A3B-FP8 \
  --profile qwen35 \
  --served-model-name qwen3.5-35b-a3b
```

如果 `/home/<user>/Documents/data` 本身是 ModelScope `cache_dir`，使用：

```sh
yarn localmind:model up \
  --model Qwen/Qwen3.5-35B-A3B-FP8 \
  --revision <固定-revision> \
  --model-root /home/<user>/Documents/data \
  --profile qwen35
```

`up` 默认行为：

- 端口为 `8000`；
- LocalMind provider 为 Qwen profile 的 `qwen-lan`，通用模型为 `local-vllm`；
- 新模型成为 text/object/structured 默认路由，已有全局 fallback 保持不变；
- embedding、workspace indexing、rerank、image、其他 provider 和 BYOK 配置保持不变；
- 已有 `localmind-affine:local` 镜像时复用，没有时才构建；
- 首次创建 `.docker/selfhost/.env` 时生成随机 `DB_PASSWORD`，且不输出密码；
- 文件配置写入前备份为 `config.json.bak.<timestamp>`，再原子替换。

只注册模型、不修改默认 chat 路由：

```sh
yarn localmind:model up <模型参数> --no-make-default
```

当前分支源码发生变化后强制重建固定 runtime 镜像：

```sh
yarn localmind:model up <模型参数> --build
```

已经确认镜像与当前分支一致时可以明确禁止构建：

```sh
yarn localmind:model up <模型参数> --no-build
```

脚本在构建前执行 `docker system df`。它只使用仓库约定的
`localmind-affine:local`，不会创建里程碑专属 tag，也不会删除 Docker volume、模型缓存
或 LocalMind 数据。

## 5. vLLM profile 和资源参数

`--profile auto` 会从 ModelScope ID 或目录名识别 `qwen36`、`qwen35`，其他模型使用
`generic`。

- `qwen36`：单并发、language-only、`qwen3_xml` tool parser、关闭 thinking；
- `qwen35`：单并发、language-only、`qwen3_coder` tool parser、关闭 thinking；
- `generic`：只添加通用 `vllm serve`、host、port 和 served model 参数。

脚本不会默认设置 `--max-model-len 262144`、`--gpu-memory-utilization 0.95`、FP8 或
tensor parallel。应根据 GX10 的模型格式、显存和并发目标显式设置：

```sh
yarn localmind:model up <模型参数> \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.8
```

其他 vLLM 参数通过可重复的 `--vllm-arg` 传入：

```sh
yarn localmind:model up <模型参数> \
  --vllm-arg --kv-cache-dtype \
  --vllm-arg auto
```

Qwen3.6 要命中本分支的专属 adapter，served model 必须精确使用
`qwen3.6-35b-a3b` 或 `qwen3.6-35b-a3b-fp8`。

## 6. 网络、状态和停止

vLLM 监听宿主机 `0.0.0.0:<port>`。LocalMind 容器通过以下地址访问：

```text
http://host.docker.internal:<port>/v1
```

Compose 为 `affine` service 映射 `host.docker.internal:host-gateway`。端口已由目标 vLLM
占用时脚本复用它；端口由未知服务或其他模型占用时脚本停止并报告，不会杀掉该进程。
如果复用仅发布到宿主机 loopback 的 vLLM 容器，使用上述
`LOCALMIND_CONTAINER_MODEL_ENDPOINT` 指向同一 Docker 网络内的模型容器。
由于 vLLM 默认未启用 API key，服务器防火墙不应把该端口暴露到不受信任网络。

状态和日志位于 Git 忽略的部署数据目录：

```text
.docker/selfhost/data/localmind/runtime/vllm.json
.docker/selfhost/data/localmind/runtime/vllm.log
```

查看状态：

```sh
yarn localmind:model status
```

停止 Compose 和由本脚本启动的 vLLM，但保留 volume 和持久化数据：

```sh
yarn localmind:model stop
```

脚本不会停止它只发现但未启动的外部 vLLM。

## 7. 成功标准和边界

`up` 返回成功前会验证：

1. snapshot 包含有效 `config.json`、tokenizer 和权重；
2. vLLM `/v1/models` 包含 served model；
3. 最小 `/v1/chat/completions` 返回成功；
4. Compose 配置可解析，migration 和 LocalMind 能启动；
5. `localmind_affine_server` 容器内可以访问宿主机 vLLM；
6. 文件配置包含目标 provider 和 model。

Admin 发布的 DB-backed provider/model/task route revision 可能覆盖文件配置。脚本不会绕过
Admin 授权直接改数据库，因此第一版面向新部署或明确由文件配置管理 provider 的专用部署。
若已有 DB override，应在 Admin 中归档或调整它，再执行真实 LocalMind 对话验证。

vLLM 健康和最小对话成功只证明 endpoint 可用，不表示 Qwen3.6 的全部 Agent Runtime、
工具、审批和附件能力已经通过生产 capability gate。
