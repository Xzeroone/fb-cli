# Auth — how fb stays logged in

## Model

fb does **not** implement Meta OAuth or QR multi-device login.

1. You log into facebook.com in **normal Chrome** (your Default profile).  
2. `fb-headless start` copies a **minimal** slice of that profile into  
   `~/.local/state/fb/chrome`:  
   - OpenCLI extension  
   - Cookies (incl. `c_user`, `xs`, `fr`, `datr`)  
   - `Local State` (cookie encryption key)  
   - Slim Preferences (OpenCLI only)  
3. Headless Chrome on **:9223** uses that copy. opencli + the extension drive Facebook.  
4. If headless is down, fb falls back to visible Chrome CDP on **:9222**.

## Refresh

The headless profile is **not** continuously synced.

```bash
fb-headless reset && fb-headless start
fb whoami
```

## Failure modes

| Symptom | Fix |
|---------|-----|
| `Browser Bridge extension not connected` | Install OpenCLI in **visible** Chrome, then reset headless |
| `not logged in` / empty whoami | Log into FB in visible Chrome, then reset headless |
| SingletonLock / default data directory errors | Never point headless at `~/.config/google-chrome` as data dir — use `fb-headless` |
| CDP not reachable | `fb-headless start` or `systemctl --user start fb-headless` |

## Privacy

Cookies and profile data stay on disk under `~/.local/state/fb/`. Do not commit that tree.
