# Agent instructions — fb-cli

You are setting up or using **fb**, a Facebook/Messenger CLI that drives the user's **real Chrome session** via opencli.

## One-liner install (human or agent)

```bash
# when published:
curl -fsSL https://raw.githubusercontent.com/Xzeroone/fb-cli/main/scripts/get-fb.sh | bash

# local tree:
FB_LOCAL_ROOT=/path/to/fb-cli bash /path/to/fb-cli/scripts/get-fb.sh
```

Or:

```bash
git clone <repo> && cd fb-cli && ./scripts/install.sh && fb setup
```

## What you must get the human to do (cannot fully automate)

Chrome **blocks silent Web Store installs**. The human must click **Add to Chrome** once.

`fb setup` automates everything else:

1. Opens the OpenCLI extension page  
2. Polls until the extension connects  
3. Opens Facebook login  
4. Polls until `fb whoami` succeeds  

Tell the human: **"Click Add to Chrome / Install when the store tab opens, then log into Facebook if asked. I'll wait."**

## After setup — magic commands

```bash
fb whoami
fb chats --limit 20
fb thread <id>
fb pull <thread_or_post_url>
fb posts "query" --limit 10
fb post "<url>"
fb research "query" --limit 3
```

Always prefer `--json` when parsing.

## Optional: headless mode (no visible Chrome)

If the user doesn't want a Chrome window open, or is on a headless server:

```bash
fb-headless start
fb whoami
fb-headless stop     # when done
```

`fb-headless` launches a dedicated headless Chrome with a minimal profile (just the OpenCLI extension and facebook.com cookies — everything else is purged on first run). `fb` will prefer the headless Chrome on :9223 if it's running, falling back to the user's visible Chrome on :9222.

## Architecture constraints

- v0.7.0+: headless-by-default; no wmctrl, no xdotool, no window-hide systemd units
- Auth = Chrome cookies for facebook.com (copied into the headless profile on first start)
- Backend can run with **zero visible UI** via `fb-headless start`
- Public / visible content only

## Health checks

```bash
opencli doctor                 # extension + daemon
fb version                     # bridge status (daemon + chrome + extension)
fb whoami                      # facebook session
fb-headless status             # headless Chrome
```

## Do not

- Invent Meta API tokens  
- Commit cookies, `~/.local/state/fb`, or Chrome profile data  
- Promise QR pairing like WhatsApp wacli  
