# Auth flow (for end users)

## Goal

One-time setup so `fb` can use **their** Facebook session. No QR multi-device API exists for personal Facebook.

## Steps (copy into README demos)

1. **Chrome** installed  
2. **OpenCLI extension** from Chrome Web Store  
3. **Log into facebook.com** in that same Chrome profile  
4. `opencli doctor` → extension connected  
5. `fb whoami` → `logged_in: true`  

If step 5 fails: `fb auth` (visible login once).

## Why this is “easy enough”

- Same skills as “install a Chrome extension and log into a website”  
- No API keys, no Meta developer app, no phone pairing codes  
- Session lasts as long as Chrome stays logged into Facebook  

## Why it fails for some people

- Corporate locked-down Chrome (no extensions)  
- Only Firefox / Safari  
- Pure SSH server with no display and no Chrome  
- Expecting WhatsApp-style QR without a browser  

## Security notes for README

- Treat Chrome profile + `~/.local/state/fb` as sensitive  
- Don’t commit cookies or `fb.db`  
- Automation may violate Meta ToS — personal/research use only  
