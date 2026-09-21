# Tethershell Agent

Connect your Linux computer to Tethershell and use its files and terminal from
ChatGPT or another MCP client.

The Tethershell agent runs locally on your computer and makes an outbound
connection to the Tethershell gateway. You do not need to expose an SSH port,
open a firewall port, or give the agent your Tethershell account password.

> Tethershell is currently a Linux preview. Node.js 22 or later is required.

## What the agent can do

The agent can expose a workspace directory through these tools:

- list files
- read files
- write files, when explicitly enabled
- run commands, when explicitly enabled
- start and manage background processes

File reads are enabled by default.

Write access and command execution must be enabled locally when you pair the
device. They cannot be enabled remotely by Tethershell, ChatGPT, or another
MCP client.

## 1. Create a Tethershell account

Create an account at:

https://app.tethershell.com/signup

Sign in after registration. During the current preview, new accounts require
administrator approval before devices can be paired.

The dashboard is also where you can see, rename, and revoke your connected
devices.

## 2. Install the agent

### Quick install

On Linux with Node.js 22+ and Git installed, the quickest setup is:

```sh
curl -fsSL https://raw.githubusercontent.com/tethershell/tethershell-agent/main/install.sh | sudo sh
```

The installer clones or updates the agent, pairs the machine, installs a systemd
service, and starts it. The pairing code is printed in the terminal; approve it
from your Tethershell account.

The quick installer enables all agent permissions by default:

- file reads
- file writes
- command execution

When run with `sudo`, the agent service runs as `root`, so commands also run
with root operating-system privileges. The default root workspace is `/root`;
the device credential stays outside that workspace in
`/etc/tethershell/agent.json`.

To install as your current user instead:

```sh
curl -fsSL https://raw.githubusercontent.com/tethershell/tethershell-agent/main/install.sh | sh
```

That uses `$HOME/projects` as the default workspace and runs commands with your
user account privileges.

You can override defaults inline. For example:

```sh
curl -fsSL https://raw.githubusercontent.com/tethershell/tethershell-agent/main/install.sh | \
  sudo TETHERSHELL_WORKSPACE=/srv/projects sh
```

Set `TETHERSHELL_ALLOW_WRITE=0` or `TETHERSHELL_ALLOW_COMMANDS=0` to disable
either permission. The config path must remain outside the exposed workspace.

### Manual install

Install Node.js 22 or later, then clone this repository:

```sh
mkdir -p "$HOME/.local/share"
git clone https://github.com/tethershell/tethershell-agent.git \
  "$HOME/.local/share/tethershell-agent"

cd "$HOME/.local/share/tethershell-agent"
npm install --omit=dev
```

Check your Node.js version with:

```sh
node --version
```

## 3. Pair this computer

Choose the directory that Tethershell should be allowed to access.

For example, to expose `$HOME/projects`:

```sh
mkdir -p "$HOME/.config/tethershell"
chmod 700 "$HOME/.config/tethershell"

cd "$HOME/.local/share/tethershell-agent"

node apps/agent/pair.mjs \
  --gateway https://mcp.tethershell.com \
  --workspace "$HOME/projects" \
  --config "$HOME/.config/tethershell/agent.json"
```

The agent will display a short-lived pairing code and tell you where to open
Tethershell.

Sign in with your Tethershell account, enter the code, review the device, and
approve it.

The resulting device credential is stored only in the local configuration
file. The pairing CLI sends a hash of that credential to the gateway and
writes the configuration with mode `0600`.

Keep the configuration file outside the workspace you expose.

### Optional permissions

Reads are enabled by default.

To also allow file modifications:

```sh
node apps/agent/pair.mjs \
  --gateway https://mcp.tethershell.com \
  --workspace "$HOME/projects" \
  --config "$HOME/.config/tethershell/agent.json" \
  --allow-write
```

To allow terminal commands as well:

```sh
node apps/agent/pair.mjs \
  --gateway https://mcp.tethershell.com \
  --workspace "$HOME/projects" \
  --config "$HOME/.config/tethershell/agent.json" \
  --allow-write \
  --allow-commands
```

Only enable permissions you actually want to expose.

Command execution has the privileges of the operating-system account running
the agent.

## 4. Start the agent

Run:

```sh
cd "$HOME/.local/share/tethershell-agent"

node apps/agent/index.mjs \
  "$HOME/.config/tethershell/agent.json"
```

You should see:

```text
Agent connected
```

The device will then appear online in the Tethershell dashboard.

The connection is outbound HTTPS/WebSocket traffic. No inbound network port is
required.

## 5. Connect ChatGPT

The Tethershell MCP endpoint is:

https://mcp.tethershell.com/mcp

Add that MCP endpoint to ChatGPT and complete OAuth using the same Tethershell
account you used to pair the device.

After authorization, Tethershell tools can access only devices belonging to
that account.

If you change your Tethershell password, reconnect the MCP integration.
Existing paired devices remain paired.

## Running continuously

For a personal Linux machine, the agent can run as a systemd user service.

First verify the location of Node.js:

```sh
command -v node
```

Create:

```text
~/.config/systemd/user/tethershell-agent.service
```

with:

```ini
[Unit]
Description=Tethershell Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/.local/share/tethershell-agent
ExecStart=/usr/bin/node %h/.local/share/tethershell-agent/apps/agent/index.mjs %h/.config/tethershell/agent.json
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

If `command -v node` returned something other than `/usr/bin/node`, use that
path in `ExecStart`.

Then enable it:

```sh
systemctl --user daemon-reload
systemctl --user enable --now tethershell-agent
systemctl --user status tethershell-agent
```

View logs with:

```sh
journalctl --user -u tethershell-agent
```

## Updating

```sh
cd "$HOME/.local/share/tethershell-agent"
git pull --ff-only
npm install --omit=dev
systemctl --user restart tethershell-agent
```

## Security model

The workspace configured for the agent is a security boundary. Tethershell
rejects paths that escape it and does not follow workspace symlinks for file
operations.

A few important points:

- Keep `agent.json` private.
- Keep the configuration file outside the exposed workspace.
- Reads are enabled by default.
- Write access is local opt-in.
- Command execution is local opt-in.
- Commands run with the privileges of the OS account running the agent.
- Revoke a lost or unwanted device from the Tethershell dashboard.
- The Tethershell gateway relays tool arguments and results. The connection is
  encrypted in transit, but it is not end-to-end encrypted between ChatGPT and
  your computer.
- Host administrators of the Tethershell gateway can access server memory and
  configuration.

For especially sensitive machines, use a dedicated OS account and expose only
a dedicated workspace.

## Development

Install dependencies:

```sh
npm install
```

Run the tests:

```sh
npm test
```

Start an already-paired agent:

```sh
npm start -- "$HOME/.config/tethershell/agent.json"
```

## Repository layout

```text
apps/agent/          pairing, WebSocket connection and request dispatch
packages/protocol/   tool schemas and concurrency rules
packages/tools/      local file and process execution
tests/               agent tests
```

## Troubleshooting

### `HTTPS required`

Remote gateways must use HTTPS. Plain HTTP is accepted only for localhost
development.

### Device stays offline

Check:

```sh
systemctl --user status tethershell-agent
journalctl --user -u tethershell-agent
```

Also confirm that the device has not been revoked in the dashboard.

### Pairing code expired

Pairing codes last only a few minutes. Run the pairing command again and use
the new code.

### I paired the wrong workspace or permissions

Revoke the device in the dashboard, remove the old local configuration, and
pair it again with the desired workspace and permissions.
