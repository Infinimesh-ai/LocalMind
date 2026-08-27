#!/bin/sh

set -eu

VLLM_VERSION=0.28.0
MODELSCOPE_VERSION=1.39.1
UV_VERSION=0.12.6

RUNTIME_ROOT=${LOCALMIND_RUNTIME_ROOT:-"${HOME:?HOME must be set}/.local/share/localmind/qwen36-runtime"}
VENV_DIR="$RUNTIME_ROOT/venv"
VENV_PYTHON="$VENV_DIR/bin/python"
VENV_UV="$VENV_DIR/bin/uv"
VENV_VLLM="$VENV_DIR/bin/vllm"
OS_RELEASE_FILE=${LOCALMIND_OS_RELEASE_FILE:-/etc/os-release}

APT_REFRESHED=0
TEMP_ROOT=

usage() {
  cat <<'EOF'
Provision the supported LocalMind Qwen3.6 host environment.

This internal helper supports Ubuntu 22.04/24.04 and Debian 12 on amd64 or
arm64. It installs missing Node.js 22, Docker Engine with Compose, and an
isolated Python environment containing pinned ModelScope and vLLM packages.

If an NVIDIA driver is missing on DGX Spark, the helper applies the official
DGX OS package update and exits with code 20 so the machine can be rebooted.
On ordinary Ubuntu NVIDIA hosts it installs the recommended compute driver
and also exits with code 20. Re-run the bootstrap after reboot.
EOF
}

log() {
  printf '[environment] %s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEMP_ROOT" ] && [ -d "$TEMP_ROOT" ]; then
    rm -rf "$TEMP_ROOT"
  fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

ensure_temp_root() {
  if [ -z "$TEMP_ROOT" ]; then
    TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/localmind-environment.XXXXXX")
  fi
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  command -v sudo >/dev/null 2>&1 || die "sudo is required to install system packages"
  sudo "$@"
}

apt_refresh() {
  if [ "$APT_REFRESHED" -eq 0 ]; then
    run_root apt-get update
    APT_REFRESHED=1
  fi
}

apt_install() {
  apt_refresh
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

load_platform() {
  [ "$(uname -s)" = Linux ] || die "automatic environment setup only supports Linux"
  [ -r "$OS_RELEASE_FILE" ] || die "cannot read $OS_RELEASE_FILE"

  # shellcheck disable=SC1090
  . "$OS_RELEASE_FILE"
  OS_ID=${ID:-}
  OS_VERSION=${VERSION_ID:-}
  OS_CODENAME=${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}
  MACHINE_ARCH=$(uname -m)

  case "$MACHINE_ARCH" in
    x86_64|aarch64) ;;
    *) die "unsupported CPU architecture: $MACHINE_ARCH" ;;
  esac
  case "$OS_ID:$OS_VERSION" in
    ubuntu:22.04|ubuntu:24.04|debian:12) ;;
    *) die "unsupported Linux release: $OS_ID $OS_VERSION" ;;
  esac
  [ -n "$OS_CODENAME" ] || die "Linux release does not provide VERSION_CODENAME"
}

ensure_base_tools() {
  if command -v curl >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1; then
    return
  fi
  log "Installing package repository prerequisites"
  apt_install ca-certificates curl gnupg
}

node_supported() {
  command -v node >/dev/null 2>&1 && node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
process.exit(major === 22 && minor >= 12 ? 0 : 1);
' >/dev/null 2>&1
}

ensure_node() {
  if node_supported; then
    log "Node.js 22 is available"
    return
  fi

  log "Installing Node.js 22 from the signed NodeSource repository"
  ensure_base_tools
  ensure_temp_root
  curl -fsSL \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    -o "$TEMP_ROOT/nodesource.asc"
  gpg --batch --yes --dearmor \
    --output "$TEMP_ROOT/nodesource.gpg" \
    "$TEMP_ROOT/nodesource.asc"
  printf '%s\n' \
    'Types: deb' \
    'URIs: https://deb.nodesource.com/node_22.x' \
    'Suites: nodistro' \
    'Components: main' \
    "Architectures: $(dpkg --print-architecture)" \
    'Signed-By: /usr/share/keyrings/nodesource.gpg' \
    > "$TEMP_ROOT/nodesource.sources"
  run_root install -d -m 0755 /usr/share/keyrings
  run_root install -m 0644 "$TEMP_ROOT/nodesource.gpg" /usr/share/keyrings/nodesource.gpg
  run_root install -m 0644 "$TEMP_ROOT/nodesource.sources" /etc/apt/sources.list.d/nodesource.sources
  APT_REFRESHED=0
  apt_install nodejs
  node_supported || die "Node.js 22 installation did not produce a supported node command"
}

docker_ready() {
  command -v docker >/dev/null 2>&1 &&
    docker compose version >/dev/null 2>&1 &&
    docker version >/dev/null 2>&1
}

install_docker() {
  log "Installing Docker Engine and Docker Compose from Docker's signed repository"
  ensure_base_tools
  ensure_temp_root
  curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o "$TEMP_ROOT/docker.asc"
  chmod 0644 "$TEMP_ROOT/docker.asc"
  printf '%s\n' \
    'Types: deb' \
    "URIs: https://download.docker.com/linux/$OS_ID" \
    "Suites: $OS_CODENAME" \
    'Components: stable' \
    "Architectures: $(dpkg --print-architecture)" \
    'Signed-By: /etc/apt/keyrings/docker.asc' \
    > "$TEMP_ROOT/docker.sources"
  run_root install -d -m 0755 /etc/apt/keyrings
  run_root install -m 0644 "$TEMP_ROOT/docker.asc" /etc/apt/keyrings/docker.asc
  run_root install -m 0644 "$TEMP_ROOT/docker.sources" /etc/apt/sources.list.d/docker.sources
  APT_REFRESHED=0
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable --now docker || true
  elif command -v service >/dev/null 2>&1; then
    run_root service docker start || true
  fi
}

ensure_docker_access() {
  if docker_ready; then
    log "Docker Engine and Compose are available"
    return
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    install_docker
  fi

  if docker_ready; then
    log "Docker Engine and Compose are available"
    return
  fi

  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable --now docker || true
  elif command -v service >/dev/null 2>&1; then
    run_root service docker start || true
  fi
  if docker_ready; then
    log "Started the existing Docker Engine"
    return
  fi

  if ! run_root docker version >/dev/null 2>&1; then
    die "Docker daemon is unavailable after installation"
  fi
  if [ "$(id -u)" -eq 0 ]; then
    die "Docker is only available through an unexpected root-only configuration"
  fi

  log "Granting the current user Docker access for this run and future logins"
  run_root groupadd -f docker
  run_root usermod -aG docker "$(id -un)"
  command -v setfacl >/dev/null 2>&1 || apt_install acl
  [ -S /var/run/docker.sock ] || die "Docker socket /var/run/docker.sock is missing"
  run_root setfacl -m "u:$(id -u):rw" /var/run/docker.sock
  docker_ready || die "Docker is installed, but the current user still cannot reach the daemon"
}

hardware_description() {
  {
    [ ! -r /proc/device-tree/model ] || tr '\000' ' ' < /proc/device-tree/model
    [ ! -r /sys/class/dmi/id/product_name ] || cat /sys/class/dmi/id/product_name
    command -v lspci >/dev/null 2>&1 && lspci || true
  } 2>/dev/null
}

ensure_nvidia_driver() {
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    GPU_SUMMARY=$(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null | head -n 1 || true)
    log "NVIDIA driver is available${GPU_SUMMARY:+: $GPU_SUMMARY}"
    return
  fi

  HARDWARE=$(hardware_description)
  printf '%s' "$HARDWARE" | grep -Eiq 'NVIDIA|DGX[[:space:]]+Spark|GB10' ||
    die "no working NVIDIA driver or supported NVIDIA GPU was detected"
  [ "$OS_ID" = ubuntu ] || die "automatic NVIDIA driver recovery is only supported on Ubuntu"

  if printf '%s' "$HARDWARE" | grep -Eiq 'DGX[[:space:]]+Spark'; then
    log "NVIDIA driver is unavailable on DGX Spark; applying the official DGX OS package update"
    apt_refresh
    run_root env DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y
  else
    log "Installing the Ubuntu-recommended NVIDIA compute driver"
    apt_install "linux-headers-$(uname -r)" ubuntu-drivers-common
    if ! run_root ubuntu-drivers install --gpgpu; then
      run_root ubuntu-drivers autoinstall
    fi
  fi

  printf '%s\n' \
    'NVIDIA driver packages were installed or updated.' \
    'Reboot the host, then run localmind-qwen36-bootstrap.sh again.' >&2
  exit 20
}

python_supported() {
  command -v python3 >/dev/null 2>&1 && python3 -c '
import sys
raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)
' >/dev/null 2>&1
}

managed_packages_ready() {
  [ -x "$VENV_PYTHON" ] && "$VENV_PYTHON" -c "
from importlib.metadata import version
raise SystemExit(0 if version('vllm') == '$VLLM_VERSION' and version('modelscope') == '$MODELSCOPE_VERSION' else 1)
" >/dev/null 2>&1
}

ensure_python_runtime() {
  if ! python_supported; then
    log "Installing a supported Python runtime and venv support"
    apt_install python3 python3-venv
  elif ! python3 -m venv --help >/dev/null 2>&1; then
    log "Installing Python venv support"
    apt_install python3-venv
  fi
  python_supported || die "Python 3.10 through 3.13 is required"

  mkdir -p "$RUNTIME_ROOT"
  if [ ! -x "$VENV_PYTHON" ]; then
    log "Creating isolated Python environment at $VENV_DIR"
    python3 -m venv "$VENV_DIR"
  fi
  if [ ! -x "$VENV_UV" ]; then
    log "Installing uv $UV_VERSION in the isolated environment"
    "$VENV_PYTHON" -m pip install --disable-pip-version-check "uv==$UV_VERSION"
  fi
  if ! managed_packages_ready; then
    log "Installing ModelScope $MODELSCOPE_VERSION and vLLM $VLLM_VERSION"
    "$VENV_UV" pip install \
      --python "$VENV_PYTHON" \
      --torch-backend=auto \
      "modelscope==$MODELSCOPE_VERSION" \
      "vllm==$VLLM_VERSION"
  else
    log "Pinned ModelScope and vLLM packages are already installed"
  fi

  managed_packages_ready || die "managed ModelScope/vLLM installation is incomplete"
  [ -x "$VENV_VLLM" ] || die "managed vLLM executable is missing: $VENV_VLLM"
  "$VENV_PYTHON" -c '
import torch
if not torch.cuda.is_available():
    raise SystemExit("PyTorch cannot access CUDA")
capability = torch.cuda.get_device_capability(0)
if capability < (7, 5):
    raise SystemExit(f"GPU compute capability {capability} is below 7.5")
print(f"[environment] CUDA ready: {torch.cuda.get_device_name(0)}; torch={torch.__version__}; cuda={torch.version.cuda}; capability={capability}")
'
  "$VENV_VLLM" --version
}

case ${1:-} in
  '') ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    die "unknown argument: $1"
    ;;
esac

load_platform
ensure_base_tools
ensure_node
ensure_docker_access
ensure_nvidia_driver
ensure_python_runtime
log "Host environment is ready"
