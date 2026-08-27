#!/bin/sh

set -eu

REPOSITORY_URL=${LOCALMIND_REPOSITORY_URL:-https://github.com/Infinimesh-ai/LocalMind.git}
BRANCH=codex/local-model-runtime
MODEL=Qwen/Qwen3.6-35B-A3B-FP8
MODEL_REVISION=62836cf634afbb2a90f3e0558ded9112afbf4660
SERVED_MODEL_NAME=qwen3.6-35b-a3b

INSTALL_DIR=${LOCALMIND_INSTALL_DIR:-"$(pwd)/LocalMind"}
MODEL_DIR=${LOCALMIND_MODEL_DIR:-}
DOWNLOAD_DIR=${LOCALMIND_MODEL_DOWNLOAD_DIR:-}
MODEL_ROOT=${LOCALMIND_MODEL_ROOT:-"${HOME:?HOME must be set}/Documents/data"}
RUNTIME_ROOT=${LOCALMIND_RUNTIME_ROOT:-"$HOME/.local/share/localmind/qwen36-runtime"}
MODEL_PORT=${LOCALMIND_MODEL_PORT:-8000}
CONTAINER_MODEL_ENDPOINT=${LOCALMIND_CONTAINER_MODEL_ENDPOINT:-}
MODEL_TIMEOUT=${LOCALMIND_MODEL_TIMEOUT:-900}

usage() {
  cat <<'EOF'
Bootstrap LocalMind with the fixed Qwen3.6 ModelScope snapshot.

Usage:
  sh localmind-qwen36-bootstrap.sh [model location option]

Model location options:
  --model-dir <path>       Use an existing complete snapshot; no download
  --download-dir <path>    Download the fixed model directly into this directory
  --model-root <path>      Use this ModelScope cache_dir

The script clones only codex/local-model-runtime, downloads or reuses the
fixed Qwen3.6 model, starts vLLM, builds LocalMind, configures the provider,
and starts LocalMind Compose.

Optional environment variables:
  LOCALMIND_INSTALL_DIR                Checkout path (default: ./LocalMind)
  LOCALMIND_MODEL_DIR                  Complete local model snapshot; skips download
  LOCALMIND_MODEL_DOWNLOAD_DIR         Final directory for a new model download
  LOCALMIND_MODEL_ROOT                 ModelScope cache_dir
                                       (default: $HOME/Documents/data)
  LOCALMIND_RUNTIME_ROOT               Managed Python/vLLM environment
                                       (default: $HOME/.local/share/localmind/qwen36-runtime)
  LOCALMIND_MODEL_PORT                 vLLM port (default: 8000)
  LOCALMIND_CONTAINER_MODEL_ENDPOINT   Model URL reachable from LocalMind container
  LOCALMIND_MODEL_TIMEOUT              Readiness timeout in seconds
  LOCALMIND_PYTHON_BIN                 Override managed Python executable
  LOCALMIND_VLLM_BIN                   Override managed vLLM executable
  LOCALMIND_MAX_MODEL_LEN              Optional vLLM max model length
  LOCALMIND_GPU_MEMORY_UTILIZATION     Optional vLLM GPU memory fraction
  LOCALMIND_TENSOR_PARALLEL_SIZE       Optional vLLM tensor parallel size
  LOCALMIND_REPOSITORY_URL             Git mirror URL; branch remains fixed

The script supports Ubuntu 22.04/24.04 and Debian 12 on amd64 or arm64. It
uses sudo when system packages are missing. A newly installed NVIDIA driver
requires one reboot and a second invocation of this script.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 was not found in PATH"
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  command -v sudo >/dev/null 2>&1 || die "sudo is required to install Git"
  sudo "$@"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi
  [ "$(uname -s)" = Linux ] && command -v apt-get >/dev/null 2>&1 ||
    die "Git is missing and automatic installation requires Ubuntu or Debian"
  printf 'Installing Git before cloning LocalMind\n'
  run_root apt-get update
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates git
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --model-dir)
      [ "$#" -ge 2 ] || die "missing value for --model-dir"
      shift
      MODEL_DIR=$1
      ;;
    --model-root)
      [ "$#" -ge 2 ] || die "missing value for --model-root"
      shift
      MODEL_ROOT=$1
      ;;
    --download-dir)
      [ "$#" -ge 2 ] || die "missing value for --download-dir"
      shift
      DOWNLOAD_DIR=$1
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

if [ -n "$MODEL_DIR" ]; then
  [ -d "$MODEL_DIR" ] || die "local model directory does not exist: $MODEL_DIR"
  MODEL_DIR=$(cd "$MODEL_DIR" && pwd -P)
fi
if [ -n "$MODEL_DIR" ] && [ -n "$DOWNLOAD_DIR" ]; then
  die "--model-dir and --download-dir cannot be used together"
fi

ensure_git

if [ -e "$INSTALL_DIR" ]; then
  [ -d "$INSTALL_DIR/.git" ] || die "install path exists but is not a Git checkout: $INSTALL_DIR"
  current_branch=$(git -C "$INSTALL_DIR" branch --show-current)
  [ "$current_branch" = "$BRANCH" ] ||
    die "existing checkout is on $current_branch, expected $BRANCH"
  printf 'Reusing existing %s checkout at %s\n' "$BRANCH" "$INSTALL_DIR"
else
  install_parent=$(dirname "$INSTALL_DIR")
  mkdir -p "$install_parent"
  printf 'Cloning %s (%s) into %s\n' "$REPOSITORY_URL" "$BRANCH" "$INSTALL_DIR"
  git clone \
    --branch "$BRANCH" \
    --single-branch \
    --filter=blob:none \
    "$REPOSITORY_URL" \
    "$INSTALL_DIR"
fi

runtime="$INSTALL_DIR/tools/localmind-model-runtime.mjs"
if [ ! -f "$runtime" ]; then
  die "cloned branch does not contain $runtime"
fi
provisioner="$INSTALL_DIR/tools/localmind-model-runtime/provision-host.sh"
if [ ! -f "$provisioner" ]; then
  die "cloned branch does not contain $provisioner"
fi

LOCALMIND_RUNTIME_ROOT="$RUNTIME_ROOT" sh "$provisioner"

PATH="$RUNTIME_ROOT/venv/bin:$PATH"
export PATH
PYTHON_BIN=${LOCALMIND_PYTHON_BIN:-"$RUNTIME_ROOT/venv/bin/python"}
VLLM_BIN=${LOCALMIND_VLLM_BIN:-"$RUNTIME_ROOT/venv/bin/vllm"}
require_command node
[ -x "$PYTHON_BIN" ] || die "Python executable is missing after provisioning: $PYTHON_BIN"
[ -x "$VLLM_BIN" ] || die "vLLM executable is missing after provisioning: $VLLM_BIN"

if [ -n "$MODEL_DIR" ]; then
  set -- "$runtime" up --model-dir "$MODEL_DIR"
else
  set -- \
    "$runtime" up \
    --model "$MODEL" \
    --revision "$MODEL_REVISION"
  if [ -n "$DOWNLOAD_DIR" ]; then
    set -- "$@" --download-dir "$DOWNLOAD_DIR"
  else
    set -- "$@" --model-root "$MODEL_ROOT"
  fi
fi

set -- \
  "$@" \
  --profile qwen36 \
  --served-model-name "$SERVED_MODEL_NAME" \
  --port "$MODEL_PORT" \
  --timeout "$MODEL_TIMEOUT" \
  --python-bin "$PYTHON_BIN" \
  --vllm-bin "$VLLM_BIN" \
  --build

if [ -n "$CONTAINER_MODEL_ENDPOINT" ]; then
  set -- "$@" --container-model-endpoint "$CONTAINER_MODEL_ENDPOINT"
fi
if [ -n "${LOCALMIND_MAX_MODEL_LEN:-}" ]; then
  set -- "$@" --max-model-len "$LOCALMIND_MAX_MODEL_LEN"
fi
if [ -n "${LOCALMIND_GPU_MEMORY_UTILIZATION:-}" ]; then
  set -- "$@" --gpu-memory-utilization "$LOCALMIND_GPU_MEMORY_UTILIZATION"
fi
if [ -n "${LOCALMIND_TENSOR_PARALLEL_SIZE:-}" ]; then
  set -- "$@" --tensor-parallel-size "$LOCALMIND_TENSOR_PARALLEL_SIZE"
fi

printf 'Starting fixed model %s@%s\n' "$MODEL" "$MODEL_REVISION"
exec node "$@"
