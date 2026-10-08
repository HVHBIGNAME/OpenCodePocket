# OCC companion

Pair OpenCode with the [OpenCode Pocket](https://github.com/HVHBIGNAME/OpenCodePocket) Android / iOS client.

```sh
npx --yes --package=https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.1/hvhbigname-occ-bridge-1.0.1.tgz occ-pocket install
```

This command needs Node.js 22+. `cloudflared` is downloaded automatically from the official release and SHA-256-verified. For a machine without Node.js, use [Install-Pocket.cmd](https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.1/Install-Pocket.cmd) on Windows or [install-pocket.sh](https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.1/install-pocket.sh) on macOS/Linux; both bootstrap a private runtime without administrator access.

Restart OpenCode, then run `/pocket-qr` to open the QR in the computer's browser. `/pocket` opens the TUI menu, `/pocket-status` shows connectivity, and `/pocket-config` configures the mode, name and port. In desktop, these slash commands use the plugin's `pocket_manage` tool via the agent. No pairing secret is returned to the agent. Connection settings take effect after restarting OpenCode.

The installer copies standalone server/TUI/CLI bundles, adds the TUI plugin while preserving existing JSONC comments and plugins, and configures a local HTTP port if none exists. It does not require a global npm installation. The CLI remains available as `node ~/.config/opencode/occ-pocket/cli.mjs`.

A tunnel QR is created only after its public health endpoint responds. If Cloudflare is unavailable, use `/pocket-config` to select LAN and restart OpenCode. The QR is also saved to `~/.config/opencode/occ-pocket/pairing.html`.

Use `start --upstream http://127.0.0.1:4096 --tunnel` for an existing listening OpenCode server; use `--lan` for Wi-Fi/VPN, or `--url https://your-tunnel.example` for your own tunnel to port 4141. `--lan` listens on all interfaces; other modes bind loopback.

Pairing codes expire after 10 minutes and are single-use. Each device gets a revocable bearer token. Only token hashes are stored on the computer. The mobile client uses the platform secure store. OpenCode credentials are never included in the QR.

`OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` must match your OpenCode server. APNs and ntfy notification configuration is described in [the notification guide](https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/notifications.md).
