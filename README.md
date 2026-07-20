# fb — Facebook / Messenger CLI

Connect Chrome **once**. Everything after that is magic.

```text
fb  →  opencli  →  your Chrome (cookies + OpenCLI extension)
```

Not affiliated with Meta. Public / visible content only.

---

## One-liner install

When this repo is on GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/Xzeroone/fb-cli/main/scripts/get-fb.sh | bash
```

Local / agent:

```bash
FB_LOCAL_ROOT=/path/to/fb-cli bash /path/to/fb-cli/scripts/get-fb.sh
```

That installs packages, then runs **`fb setup`** automatically.

---

## `fb setup` — what you click, what we automate

| You do (once) | We automate |
|---------------|-------------|
| Click **Add to Chrome** on the store tab | Open the OpenCLI extension page |
| Log into Facebook if asked | Open login, poll until session works |
| — | Install adapters, bins, optional systemd |
| — | Hide Chrome windows; default invisible mode |

Chrome **cannot** silently install Web Store extensions (browser security). One click is the only human step for the extension.

```bash
fb setup          # re-run anytime if disconnected
```

---

## Point your agent at it

See **[AGENTS.md](./AGENTS.md)**.

Agent summary:

1. Run the one-liner / `get-fb.sh`  
2. Tell the human: *“Click Add to Chrome, then finish Facebook login if a tab appears.”*  
3. Wait for `fb setup` to exit 0  
4. Use `fb … --json`  

---

## After setup

```bash
fb whoami
fb chats --limit 20
fb thread <id>
fb pull <thread_or_post_url>
fb posts "query" --limit 10
fb post "<url>"
fb research "topic" --limit 3
```

Invisible backend by default (`--window background`).

---

## Requirements

- Node.js ≥ 20  
- Google Chrome  
- Linux recommended for systemd extras  

---

## Optional always-on (Linux)

```bash
fb-service install
systemctl --user enable --now fb-chrome-lean   # uses your real Default profile
loginctl enable-linger $USER                   # survive logout
```

---

## Auth model (honest)

- **Not** QR multi-device like WhatsApp `wacli`  
- **Yes** your normal Facebook login in Chrome  
- Session lasts while Chrome stays logged in  

Details: [docs/AUTH.md](./docs/AUTH.md)

---

## Uninstall

```bash
fb-service uninstall
rm -rf ~/.opencli/clis/facebook
rm -f ~/bin/fb ~/bin/fb-service ~/bin/fb-chrome-lean
```

## License

MIT
