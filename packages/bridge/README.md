# OCC companion

Pair OpenCode with the [OpenCode Pocket](https://github.com/HVHBIGNAME/OpenCodePocket) Android / iOS client.

```sh
npx --yes --package=https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/hvhbigname-occ-bridge-1.0.0.tgz occ-pocket install --tunnel
```

Requires Node.js 22+ and `cloudflared` for automatic tunnels. Restart OpenCode with `opencode --port 4096`, then run the same command with `pair` instead of `install --tunnel` and scan the QR in OCC. The QR is also saved to `~/.config/opencode/occ-pocket/pairing.html`.

Use `start --upstream http://127.0.0.1:4096 --tunnel` for an existing listening OpenCode server; use `--lan` for Wi-Fi/VPN, or `--url https://your-tunnel.example` for your own tunnel to port 4141. `--lan` listens on all interfaces; other modes bind loopback.

Pairing codes expire after 10 minutes and are single-use. Each device gets a revocable bearer token. Only token hashes are stored on the computer. The mobile client uses the platform secure store. OpenCode credentials are never included in the QR.

`OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` must match your OpenCode server. APNs and ntfy notification configuration is described in [the notification guide](https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/notifications.md).
