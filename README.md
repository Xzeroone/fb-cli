# fb — Facebook / Messenger CLI

Connect Chrome **once**. Everything after that is magic.

```text
fb  →  opencli  →  headless Chrome :9223  (cookies + OpenCLI extension)
                 ↘ fallback visible Chrome :9222
```

**v0.7.0** — headless-by-default. Not affiliated with Meta. Public / visible content only.

---

## One-liner install

```bash
curl -fsSL https://raw.githubusercontent.com/Xzeroone/fb-cli/main/scripts/get-fb.sh | bash
```

Local / agent:

```bash
FB_LOCAL_ROOT=/path/to/fb-cli bash /path/to/fb-cli/scripts/get-fb.sh
```

That installs packages, then runs **`fb setup`** automatically.

---

## Architecture (v0.7)

| Piece | Port / path | Role |
|-------|-------------|------|
| `opencli` daemon | `:19825` | Node bridge |
| OpenCLI extension | in Chrome | talks to daemon |
| Headless Chrome | `:9223` | dedicated minimal profile (`~/.local/state/fb/chrome`) |
| Visible Chrome | `:9222` | fallback if headless is down |

`fb-headless` copies a **minimal** slice of your real
`~/.config/google-chrome/Default` (not a second login):

- OpenCLI extension files only  
- Cookies + Local State (decrypt key)  
- Preferences / Secure Preferences **unmodified** (HMAC trust for OpenCLI)  
- Non-Facebook cookies trimmed **before** Chrome starts  

Typical size: **~5–20 MB** disk, not hundreds of MB.

Re-copy after re-auth in visible Chrome:

```bash
fb-headless reset && fb-headless start
```

---

## `fb setup` — what you click, what we automate

| You do (once) | We automate |
|---------------|-------------|
| Click **Add to Chrome** on the store tab | Open the OpenCLI extension page |
| Log into Facebook if asked | Open login, poll until session works |
| — | Install adapters, bins, optional systemd |
| — | Start headless Chrome on :9223 |

Chrome **cannot** silently install Web Store extensions. One click is the only human step for the extension.

```bash
fb setup          # re-run anytime if disconnected
```

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

---

## Headless ops

```bash
fb-headless start|stop|restart|status|logs|reset
fb status
# force CDP:
FB_CHROME_ENDPOINT=http://127.0.0.1:9223 fb whoami
```

---

## Optional always-on (Linux)

```bash
fb-service install                 # opencli + headless units
loginctl enable-linger $USER       # survive logout
# or:
systemctl --user enable --now fb-opencli.service fb-headless.service
```

---

## Requirements

- Node.js ≥ 20  
- Google Chrome  
- Linux recommended for systemd extras  

---

## Auth model (honest)

- **Not** QR multi-device like WhatsApp `wacli`  
- **Yes** your normal Facebook login in Chrome  
- Headless profile is a **one-shot cookie copy** — re-login in visible Chrome, then `fb-headless reset && start`  

Details: [docs/AUTH.md](./docs/AUTH.md)

---

## Agent notes

See **[AGENTS.md](./AGENTS.md)**.

---

## Uninstall

```bash
fb-service uninstall
rm -rf ~/.opencli/clis/facebook
rm -f ~/bin/fb ~/bin/fb-service ~/bin/fb-headless
# optional: wipe store + headless profile
# rm -rf ~/.local/state/fb
```

## License

MIT
