# Agent instructions — fb-cli

You are setting up or using **fb**, a Facebook/Messenger CLI that drives a
**Chrome session** via opencli. Default transport is **headless Chrome on :9223**.

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

Chrome **blocks silent Web Store installs**. The human must click **Add to Chrome** once
(in their **visible** Chrome). That installs the OpenCLI extension into the real profile;
`fb-headless` then copies it + cookies into the headless profile.

`fb setup` automates everything else:

1. Opens the OpenCLI extension page  
2. Polls until the extension connects  
3. Opens Facebook login  
4. Polls until `fb whoami` succeeds  
5. Optionally enables systemd (`fb-service install`)  

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

## Architecture (v0.7)

- Default: **headless CDP** `http://127.0.0.1:9223` via `fb-headless`  
- Fallback: visible Chrome CDP `:9222`  
- opencli daemon `:19825` + Browser Bridge extension  
- Auth = Facebook cookies copied from `~/.config/google-chrome/Default`  
- Headless profile: `~/.local/state/fb/chrome` (minimal — OpenCLI files + FB cookies; prefs unmodified for trust)  
- Public / visible content only  

## Health checks

```bash
opencli doctor
fb-headless status
fb status
fb whoami
```

## Session refresh

If whoami fails after the user re-logged in the normal browser:

```bash
fb-headless reset
fb-headless start
fb whoami
```

## Do not

- Invent Meta API tokens  
- Commit cookies, `~/.local/state/fb`, or Chrome profile data  
- Promise QR pairing like WhatsApp wacli  
- Use the real Default profile as `--user-data-dir` with headless (Chrome forbids it / SingletonLock)  
- Slim Preferences JSON (breaks Secure Preferences HMAC → OpenCLI never connects)  
- VACUUM the Cookies DB before Chrome opens it (can wipe the table)  
