# fb — Facebook / Messenger CLI

Connect Chrome **once**. Everything after that is magic.

```text
fb  →  opencli  →  your Chrome (cookies + OpenCLI extension)
```

Optional: skip Chrome entirely with a dedicated headless profile.

Not affiliated with Meta. Public / visible content only.

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

## `fb setup` — what you click, what we automate

| You do (once) | We automate |
|---------------|-------------|
| Click **Add to Chrome** on the store tab | Open the OpenCLI extension page |
| Log into Facebook if asked | Open login, poll until session works |
| — | Install adapters, binaries, optional systemd unit |
| — | Optionally: launch a headless Chrome so you don't need a visible window |

Chrome **cannot** silently install Web Store extensions (browser security). One click is the only human step for the extension.

```bash
fb setup          # re-run anytime if disconnected
```

---

## Headless mode (no Chrome window)

Default `fb` uses whatever Chrome you have open. If you don't want a visible Chrome window:

```bash
fb-headless start    # launches a dedicated headless Chrome on :9223
fb-headless status
fb-headless stop
fb-headless reset     # wipe + re-copy the headless profile
```

The headless Chrome uses its own profile with just the OpenCLI extension and your facebook.com cookies (everything else is purged on first start). It runs in parallel with your normal Chrome without conflicts.

---

## Point your agent at it

See **[AGENTS.md](./AGENTS.md)**.

Agent summary:

1. Run the one-liner / `get-fb.sh`  
2. Tell the human: *"Click Add to Chrome, then finish Facebook login if a tab appears."*  
3. Wait for `fb setup` to exit 0  
4. Use `fb … --json`  

---

## Version

**0.7.0** — headless-by-default, no wmctrl/xdotool, no window-hide dance, no required systemd units.

Previous versions managed a Chrome window and used `wmctrl`/`xdotool` to keep it hidden. That dance is gone. v0.7.0 just talks to whatever Chrome (visible or headless) is already running on :9222/:9223, and auto-starts the opencli daemon + a headless Chrome if neither is reachable.

---

## License

MIT — see [LICENSE](./LICENSE).
