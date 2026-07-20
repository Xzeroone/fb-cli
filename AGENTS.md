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
5. Optionally enables systemd units  

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

## Architecture constraints

- Not headless-CDP primary; uses **OpenCLI extension bridge**  
- Auth = Chrome cookies for facebook.com  
- Backend windows default to **background** (invisible)  
- Public / visible content only  

## Health checks

```bash
opencli doctor     # extension + daemon
fb daemon status   # auth + bridge
fb whoami
```

## Do not

- Invent Meta API tokens  
- Commit cookies, `~/.local/state/fb`, or Chrome profile data  
- Promise QR pairing like WhatsApp wacli  
