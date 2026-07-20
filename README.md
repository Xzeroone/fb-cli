# fb — Facebook / Messenger CLI

CLI for **public Facebook posts** and **Messenger**, built on [opencli](https://github.com/jackwener/opencli) + your normal Chrome session.

Not an official Meta product. Uses the WhatsApp-adjacent idea of a local CLI (`wacli`-style UX), but **Facebook has no personal multi-device protocol** — so the backend is:

```text
fb  →  opencli  →  Chrome (your profile + OpenCLI extension)
```

Windows stay in **background** by default (invisible automation). Chrome must be running and logged into Facebook.

---

## Is the auth flow easy enough for everyone?

**Yes for most desktop users**, if they already use Chrome. It’s multi-step, but each step is normal software setup — not reverse-engineering.

| Step | What they do | Difficulty |
|------|----------------|------------|
| 1 | Install Node 20+ | Easy |
| 2 | `npm i -g @jackwener/opencli` + this repo’s `install.sh` | Easy |
| 3 | Install **OpenCLI** from Chrome Web Store | Easy (one click) |
| 4 | Log into **facebook.com** in Chrome (their own account) | Easy (they already know how) |
| 5 | `opencli doctor` then `fb whoami` | Easy |
| 6 | (Optional) `fb-service install` for reboot | Medium (Linux systemd) |

**Not easy / not for:**

- Headless servers with no browser  
- People who refuse browser extensions  
- Pure “scan a QR and forget Chrome” like WhatsApp `wacli`  

**Honest UX:** first-time setup is ~10 minutes. After that, if Chrome stays logged in, `fb …` just works — no re-auth every command.

---

## Requirements

- **OS:** Linux recommended (systemd units included). macOS/Windows: CLI works; services are Linux-oriented.  
- **Node.js ≥ 20**  
- **Google Chrome** (or Chromium with the extension)  
- **OpenCLI** extension + CLI  
- Active **Facebook login** in that Chrome profile  

---

## Install

```bash
git clone https://github.com/YOUR_USER/fb-cli.git
cd fb-cli
./scripts/install.sh
```

Ensure `~/bin` (or your install bin dir) is on `PATH`.

### Auth (do once)

1. Install the extension:  
   [OpenCLI on Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)  
2. Open Chrome → log into [facebook.com](https://www.facebook.com)  
3. Verify:

```bash
opencli doctor    # daemon + extension connected
fb whoami         # logged_in: true
```

If not logged in:

```bash
fb auth           # opens a visible Facebook login once
```

### Optional: always-on (Linux)

```bash
fb-service install              # opencli daemon + hide timer (~70MB)
systemctl --user enable --now fb-chrome-lean.service   # attach/start your real Chrome profile
# optional after reboot without desktop session:
loginctl enable-linger $USER
```

Lean Chrome uses **your Default profile** (cookies + extension) — no second empty profile.

---

## Quick start

```bash
fb daemon status

# Messenger
fb chats --limit 20
fb thread <thread_id>
fb pull <thread_id>          # temp-download photos/files
fb open ~/.local/state/fb/tmp/<id>/001-....jpg
fb keep <id>                 # promote tmp → keep
fb purge all

# Public posts
fb posts "search query" --limit 10
fb post "https://www.facebook.com/photo/?fbid=..."
fb research "topic" --limit 3

# JSON for scripts / agents
fb chats --json
fb post "<url>" --json
```

Default window mode is **background** (invisible). Debug with:

```bash
fb --window foreground whoami
```

---

## Architecture

| Piece | Role | Weight |
|-------|------|--------|
| `fb` | User CLI | tiny |
| opencli adapters in `~/.opencli/clis/facebook/` | Messenger + posts | tiny |
| opencli daemon | Extension bridge | ~20–80 MB |
| Chrome + OpenCLI ext | Session + DOM | your browser |

**Auth** = Chrome cookies for facebook.com (not a QR linked-device session).

---

## Repo layout

```text
fb-cli/
  adapters/facebook/   # opencli site adapters
  bin/                 # fb, fb-service, fb-chrome-lean
  systemd/             # user units (templated by install)
  scripts/install.sh
  README.md
  LICENSE
```

---

## Limitations

- Public / visible content only (what your account can see in the browser)  
- Facebook UI changes can break selectors  
- Not official Meta API; use at your own risk  
- Feed scraping is flaky; Messenger + post deep-read are stronger  
- Not a drop-in for `wacli` protocol-level offline sync  

---

## Uninstall

```bash
fb-service uninstall   # if you installed units
rm -rf ~/.opencli/clis/facebook
rm -f ~/bin/fb ~/bin/fb-service ~/bin/fb-chrome-lean
# optional: rm -rf ~/.local/state/fb
```

---

## License

MIT — see [LICENSE](./LICENSE).

OpenCLI is separate software ([@jackwener/opencli](https://www.npmjs.com/package/@jackwener/opencli)).
