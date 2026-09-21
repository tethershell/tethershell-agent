#!/bin/sh
set -eu

GATEWAY=${TETHERSHELL_GATEWAY:-https://mcp.tethershell.com}
REPO_URL=${TETHERSHELL_REPO_URL:-https://github.com/tethershell/tethershell-agent.git}
ALLOW_WRITE=${TETHERSHELL_ALLOW_WRITE:-1}
ALLOW_COMMANDS=${TETHERSHELL_ALLOW_COMMANDS:-1}

case "$ALLOW_WRITE:$ALLOW_COMMANDS" in
  0:0|0:1|1:0|1:1) ;;
  *) echo "TETHERSHELL_ALLOW_WRITE and TETHERSHELL_ALLOW_COMMANDS must be 0 or 1." >&2; exit 1 ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
  echo "Tethershell agent currently supports Linux." >&2
  exit 1
fi

for command in git node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    echo "Install Node.js 22+ and Git, then run this installer again." >&2
    exit 1
  fi
done

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or later is required; found $(node --version)." >&2
  exit 1
fi

NODE_BIN=$(command -v node)
NPM_BIN=$(command -v npm)
IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1

if [ "$IS_ROOT" -eq 1 ]; then
  INSTALL_DIR=${TETHERSHELL_INSTALL_DIR:-/opt/tethershell-agent}
  CONFIG_FILE=${TETHERSHELL_CONFIG:-/etc/tethershell/agent.json}
  WORKSPACE=${TETHERSHELL_WORKSPACE:-/root}
  SERVICE_FILE=${TETHERSHELL_SERVICE_FILE:-/etc/systemd/system/tethershell-agent.service}
else
  INSTALL_DIR=${TETHERSHELL_INSTALL_DIR:-$HOME/.local/share/tethershell-agent}
  CONFIG_FILE=${TETHERSHELL_CONFIG:-$HOME/.config/tethershell/agent.json}
  WORKSPACE=${TETHERSHELL_WORKSPACE:-$HOME/projects}
  SERVICE_FILE=${TETHERSHELL_SERVICE_FILE:-$HOME/.config/systemd/user/tethershell-agent.service}
fi

mkdir -p "$WORKSPACE"
if "$NODE_BIN" -e '
 const path=require("node:path");
 const workspace=path.resolve(process.argv[1]),config=path.resolve(process.argv[2]);
 const rel=path.relative(workspace,config);
 process.exit(rel===""||(!rel.startsWith(".."+path.sep)&&rel!=="..")?0:1);
' "$WORKSPACE" "$CONFIG_FILE"; then
  echo "TETHERSHELL_CONFIG must be outside TETHERSHELL_WORKSPACE." >&2
  exit 1
fi

echo "Tethershell agent installer"
echo "  Gateway:        $GATEWAY"
echo "  Workspace:      $WORKSPACE"
echo "  Install dir:    $INSTALL_DIR"
echo "  Config:         $CONFIG_FILE"
echo "  OS account:     $(id -un) (uid $(id -u))"
echo "  File writes:    $([ "$ALLOW_WRITE" = 1 ] && echo enabled || echo disabled)"
echo "  Commands:       $([ "$ALLOW_COMMANDS" = 1 ] && echo enabled || echo disabled)"
echo
echo "Commands run with the privileges of this OS account."

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
elif [ -e "$INSTALL_DIR" ]; then
  echo "$INSTALL_DIR exists but is not a Git checkout; refusing to replace it." >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
"$NPM_BIN" ci --omit=dev

if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$(dirname "$CONFIG_FILE")"
  chmod 700 "$(dirname "$CONFIG_FILE")"

  set -- "$NODE_BIN" apps/agent/pair.mjs     --gateway "$GATEWAY"     --workspace "$WORKSPACE"     --config "$CONFIG_FILE"

  [ "$ALLOW_WRITE" = 1 ] && set -- "$@" --allow-write
  [ "$ALLOW_COMMANDS" = 1 ] && set -- "$@" --allow-commands
  [ -n "${TETHERSHELL_DEVICE_NAME:-}" ] && set -- "$@" --name "$TETHERSHELL_DEVICE_NAME"

  "$@"
else
  chmod 600 "$CONFIG_FILE"
  echo "Existing configuration found; keeping $CONFIG_FILE."
fi

if [ "$IS_ROOT" -eq 1 ]; then
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Tethershell Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$INSTALL_DIR
Environment=TETHERSHELL_AGENT_CONFIG=$CONFIG_FILE
ExecStart=$NODE_BIN $INSTALL_DIR/apps/agent/index.mjs
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
  chmod 644 "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl enable --now tethershell-agent.service
  systemctl is-active --quiet tethershell-agent.service
else
  mkdir -p "$(dirname "$SERVICE_FILE")"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Tethershell Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
Environment=TETHERSHELL_AGENT_CONFIG=$CONFIG_FILE
ExecStart=$NODE_BIN $INSTALL_DIR/apps/agent/index.mjs
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
EOF
  chmod 600 "$SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable --now tethershell-agent.service
  systemctl --user is-active --quiet tethershell-agent.service
fi

echo
echo "Tethershell agent installed and running."
echo "Dashboard: https://app.tethershell.com/"
echo "Docs:      https://tethershell.com/docs"
