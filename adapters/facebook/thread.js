import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

const LIMIT_DEFAULT = 30;
const LIMIT_MAX = 200;

function normalizeLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAX) {
    throw new ArgumentError(
      `facebook thread --limit must be an integer in [1, ${LIMIT_MAX}], got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

function resolveThreadUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new ArgumentError('facebook thread requires <thread> (thread id, vanity, or messages URL)');
  }
  if (/^https?:\/\//i.test(value)) {
    if (!/facebook\.com\/messages\//i.test(value) && !/messenger\.com\//i.test(value)) {
      throw new ArgumentError('URL must be a facebook.com/messages or messenger.com link');
    }
    return value.split('?')[0];
  }
  if (/^\d+$/.test(value) || /^[a-zA-Z0-9._-]+$/.test(value)) {
    return `https://www.facebook.com/messages/t/${value}/`;
  }
  throw new ArgumentError(`Unrecognized thread target: ${value}`);
}

export function isChromeText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (t.length > 2000) return true;
  if (/^(Messenger|Chats|Messages|Message|Search|Search Messenger|Inbox|Communities|Marketplace|Filtered messages|Spam|Archived|Requests|Friends|Home|Reels|Gaming|Notifications|Menu|More|Aa|Send|Photo|GIF|Sticker|File|Voice clip|Thumbs up button|Open more actions|Start a call|Chats list|New message|Typing…|Typing\.\.\.|Media, files and links|Attach a file up to 25 MB|Choose a sticker|Choose a GIF)$/i.test(t)) {
    return true;
  }
  if (/^(Active now|Online|Offline|Seen|Sent|Delivered|Opened|Just now)$/i.test(t)) return true;
  if (/^Conversation with\b/i.test(t)) return true;
  if (/^Go to replied message$/i.test(t)) return true;
  if (/\breplied to\b/i.test(t) && t.length < 80) return true;
  if (/^Open photo\b/i.test(t)) return true;
  if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?$/i.test(t)) {
    return true;
  }
  if (/^(?:Today|Yesterday|Just now|\d+\s*(?:s|m|h|d|w|min|sec|hour|day|week)s?)$/i.test(t)) {
    return true;
  }
  return false;
}

export function parseMessageAria(aria) {
  const raw = String(aria || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const patterns = [
    [/^(?:Enter,\s*)?Message sent\s+(.+?)\s+by\s+You:\s*(.+)$/i, 'you_body'],
    [/^(?:Enter,\s*)?Message sent\s+(.+?)\s+by\s+You\s*$/i, 'you_empty'],
    [/^(?:Enter,\s*)?Message sent\s+(.+?)\s+by\s+(.+?):\s*(.+)$/i, 'name_body'],
    [/^(?:Enter,\s*)?Message sent\s+(.+?)\s+by\s+(.+)$/i, 'name_empty'],
    [/^(?:Entrée,\s*)?Message envoyé\s+(.+?)\s+par\s+Vous\s*:\s*(.+)$/i, 'you_body'],
    [/^(?:Entrée,\s*)?Message envoyé\s+(.+?)\s+par\s+(.+?)\s*:\s*(.+)$/i, 'name_body'],
  ];
  for (const [re, kind] of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    if (kind === 'you_body') {
      return { from_me: true, sender: 'You', time: m[1].trim(), text: m[2].trim(), needsBody: false };
    }
    if (kind === 'you_empty') {
      return { from_me: true, sender: 'You', time: m[1].trim(), text: '', needsBody: true };
    }
    if (kind === 'name_body') {
      const sender = m[2].trim();
      const from_me = /^(you|vous)$/i.test(sender);
      return {
        from_me,
        sender: from_me ? 'You' : sender,
        time: m[1].trim(),
        text: m[3].trim(),
        needsBody: false,
      };
    }
    if (kind === 'name_empty') {
      const sender = m[2].trim();
      if (sender.length > 80) return null;
      const from_me = /^(you|vous)$/i.test(sender);
      return {
        from_me,
        sender: from_me ? 'You' : sender,
        time: m[1].trim(),
        text: '',
        needsBody: true,
      };
    }
  }
  return null;
}

function joinUrls(list, max = 8) {
  const uniq = [];
  const seen = new Set();
  for (const u of list || []) {
    const s = String(u || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    uniq.push(s);
    if (uniq.length >= max) break;
  }
  return uniq.join(' | ');
}

export function postFilterMessages(messages) {
  const out = [];
  const seen = new Set();

  for (const m of messages) {
    let text = String(m.text || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    text = text
      .replace(/^(?:Enter,\s*)?Message sent\s+.+?\s+by\s+You:\s*/i, '')
      .replace(/^(?:Enter,\s*)?Message sent\s+.+?\s+by\s+[^:]+:\s*/i, '')
      .trim();

    if (/^(?:Enter,\s*)?Message sent\b/i.test(text)) text = '';
    if (/^(?:Entrée,\s*)?Message envoyé\b/i.test(text)) text = '';
    if (text && isChromeText(text)) text = '';

    const links = Array.isArray(m.links) ? m.links : [];
    const media_urls = Array.isArray(m.media_urls) ? m.media_urls : [];
    const attachment_urls = Array.isArray(m.attachment_urls) ? m.attachment_urls : [];
    const kind = m.kind || (media_urls.length ? 'photo' : links.length ? 'link' : text ? 'text' : 'unknown');

    // Keep media/link-only messages even without text body
    if (!text && !links.length && !media_urls.length && !attachment_urls.length) continue;

    if (!text) {
      if (kind === 'photo' || media_urls.length) text = `[${media_urls.length || 1} photo(s)]`;
      else if (kind === 'video') text = '[video]';
      else if (kind === 'file') text = '[file attachment]';
      else if (kind === 'sticker') text = '[sticker]';
      else if (kind === 'gif') text = '[gif]';
      else if (links.length) text = `[shared link] ${links[0]}`;
      else text = '[attachment]';
    }

    const from_me = Boolean(m.from_me);
    const sender = m.sender || (from_me ? 'You' : '');
    const time = m.time || '';
    const key = `${from_me ? 1 : 0}|${text.slice(0, 120).toLowerCase()}|${media_urls[0] || ''}|${links[0] || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let dominated = false;
    for (const prev of out) {
      const p = prev.text.toLowerCase();
      const c = text.toLowerCase();
      if (p === c && (prev.media_urls || '') === joinUrls(media_urls)) {
        dominated = true;
        break;
      }
      if (
        !media_urls.length &&
        !links.length &&
        p.startsWith(c) &&
        p.length > c.length + 5
      ) {
        dominated = true;
        break;
      }
      if (
        !media_urls.length &&
        !links.length &&
        c.startsWith(p) &&
        c.length > p.length + 5
      ) {
        prev.text = text;
        prev.time = time || prev.time;
        prev.sender = sender || prev.sender;
        prev.from_me = from_me;
        dominated = true;
        break;
      }
    }
    if (dominated) continue;

    out.push({
      from_me,
      sender,
      text,
      time,
      kind,
      links: joinUrls(links),
      media_urls: joinUrls(media_urls),
      attachment_urls: joinUrls(attachment_urls),
    });
  }
  return out;
}

cli({
  site: 'facebook',
  name: 'thread',
  access: 'read',
  description: 'Read recent messages from a Messenger thread (text, shared links, photo/file attachments)',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'thread',
      type: 'str',
      positional: true,
      required: true,
      help: 'Thread id, messages URL, or username id',
    },
    { name: 'limit', type: 'int', default: LIMIT_DEFAULT, help: 'Max messages to return' },
  ],
  columns: ['index', 'from_me', 'sender', 'text', 'time', 'kind', 'links', 'media_urls', 'attachment_urls'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for facebook thread');
    const limit = normalizeLimit(args.limit);
    const url = resolveThreadUrl(args.thread);

    try {
      await page.goto(url, { settleMs: 4000 });
    } catch (err) {
      throw new CommandExecutionError(
        `Failed to open thread: ${err instanceof Error ? err.message : err}`,
      );
    }
    await page.wait(2);
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(`(() => {
        const roots = Array.from(document.querySelectorAll('[role="main"], [role="grid"], [role="log"]'));
        for (const el of roots) {
          if (el.scrollHeight > el.clientHeight + 20) {
            el.scrollTop = Math.max(0, el.scrollTop - 1200);
          }
        }
      })()`);
      await page.wait(0.6);
    }

    const result = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim();
      const path = location.pathname || '';
      if (/\\/(login|checkpoint)/i.test(path)) return { authRequired: true, messages: [] };

      const threadMatch = path.match(/\\/messages\\/t\\/([^/?#]+)/);
      const thread_id = threadMatch?.[1] || '';
      const main = document.querySelector('[role="main"]') || document.body;

      function isChrome(t) {
        if (!t) return true;
        if (/^(Messenger|Chats|Messages|Message|Search|Aa|Send|Photo|GIF|Sticker|File|Thumbs up button|New message|Typing…|Media, files and links|Attach a file up to 25 MB|Choose a sticker|Choose a GIF)$/i.test(t)) return true;
        if (/^(Active now|Online|Offline|Seen|Sent|Delivered|Opened|Just now)$/i.test(t)) return true;
        if (/^Conversation with\\b/i.test(t)) return true;
        if (/^Go to replied message$/i.test(t)) return true;
        if (/\\breplied to\\b/i.test(t) && t.length < 80) return true;
        if (/^Open photo\\b/i.test(t)) return true;
        if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\\s*\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)?$/i.test(t)) return true;
        if (/^(?:Today|Yesterday|Just now|\\d+\\s*(?:s|m|h|d|w)s?)$/i.test(t)) return true;
        return false;
      }

      function parseAria(aria) {
        const raw = clean(aria);
        if (!raw) return null;
        let m;
        m = raw.match(/^(?:Enter,\\s*)?Message sent\\s+(.+?)\\s+by\\s+You:\\s*(.+)$/i);
        if (m) return { from_me: true, sender: 'You', time: clean(m[1]), text: clean(m[2]), needsBody: false };
        m = raw.match(/^(?:Enter,\\s*)?Message sent\\s+(.+?)\\s+by\\s+You\\s*$/i);
        if (m) return { from_me: true, sender: 'You', time: clean(m[1]), text: '', needsBody: true };
        m = raw.match(/^(?:Enter,\\s*)?Message sent\\s+(.+?)\\s+by\\s+(.+?):\\s*(.+)$/i);
        if (m) {
          const sender = clean(m[2]);
          const from_me = /^(you|vous)$/i.test(sender);
          return { from_me, sender: from_me ? 'You' : sender, time: clean(m[1]), text: clean(m[3]), needsBody: false };
        }
        m = raw.match(/^(?:Enter,\\s*)?Message sent\\s+(.+?)\\s+by\\s+(.+)$/i);
        if (m) {
          const sender = clean(m[2]);
          if (sender.length > 80) return null;
          const from_me = /^(you|vous)$/i.test(sender);
          return { from_me, sender: from_me ? 'You' : sender, time: clean(m[1]), text: '', needsBody: true };
        }
        return null;
      }

      function isUsefulLink(href) {
        if (!href || href.startsWith('javascript:')) return false;
        if (/facebook\\.com\\/messages\\/t\\//i.test(href)) return false;
        if (/facebook\\.com\\/l\\.php/i.test(href)) return true;
        if (/lm\\.facebook\\.com/i.test(href)) return true;
        if (/facebook\\.com\\/messenger_media\\//i.test(href)) return false; // attachment viewer, separate field
        if (/facebook\\.com\\/(permalink|posts|story\\.php|photo\\/?\\?|reel|watch|share|groups\\/[^/]+\\/posts)/i.test(href)) return true;
        if (/^https?:\\/\\//i.test(href) && !/facebook\\.com\\/(ajax|privacy|help|settings)/i.test(href)) {
          // external or fb post-ish
          if (/fbcdn\\.net|scontent/i.test(href)) return false;
          return true;
        }
        return false;
      }

      function unwrapFacebookRedirect(href) {
        try {
          const u = new URL(href);
          if (u.hostname.includes('l.facebook.com') || u.hostname.includes('lm.facebook.com')) {
            const target = u.searchParams.get('u');
            if (target) return decodeURIComponent(target);
          }
        } catch (_) { /* ignore */ }
        return href;
      }

      function collectMedia(root) {
        const links = [];
        const media_urls = [];
        const attachment_urls = [];
        let kindHints = new Set();

        for (const a of root.querySelectorAll('a[href]')) {
          const href = a.href || a.getAttribute('href') || '';
          const aria = clean(a.getAttribute('aria-label') || '');
          if (/messenger_media\\//i.test(href)) {
            attachment_urls.push(href.split('#')[0]);
            if (/photo|image/i.test(aria)) kindHints.add('photo');
            else if (/video/i.test(aria)) kindHints.add('video');
            else if (/file|document|pdf/i.test(aria)) kindHints.add('file');
            else kindHints.add('attachment');
            continue;
          }
          if (isUsefulLink(href)) {
            links.push(unwrapFacebookRedirect(href));
            if (/\\/(posts|permalink|story\\.php|photo)/i.test(href)) kindHints.add('post');
            else kindHints.add('link');
          }
        }

        for (const img of root.querySelectorAll('img')) {
          const src = img.currentSrc || img.src || img.getAttribute('src') || '';
          if (!src || src.startsWith('data:')) continue;
          if (/emoji|static\\.xx\\.fbcdn\\.net\\/rsrc|rsrc\\.php|\\/images\\/icons\\//i.test(src)) continue;
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          // skip tiny avatars/icons
          if (w && h && w <= 64 && h <= 64) continue;
          if (/s100x100|s40x40|s50x50|p100x100/i.test(src) && w <= 120) continue;
          media_urls.push(src);
          kindHints.add('photo');
        }

        for (const v of root.querySelectorAll('video')) {
          const src = v.currentSrc || v.src || '';
          if (src) media_urls.push(src);
          if (v.poster) media_urls.push(v.poster);
          kindHints.add('video');
        }

        // aria-only photo openers without wrapping the img yet
        for (const el of root.querySelectorAll('[aria-label]')) {
          const aria = clean(el.getAttribute('aria-label') || '');
          if (/^Open photo\\b/i.test(aria)) kindHints.add('photo');
          if (/^Open video\\b/i.test(aria)) kindHints.add('video');
          if (/sticker/i.test(aria)) kindHints.add('sticker');
          if (/\\bGIF\\b/i.test(aria)) kindHints.add('gif');
          if (/attachment|file|document|pdf/i.test(aria)) kindHints.add('file');
        }

        let kind = 'text';
        if (kindHints.has('video')) kind = 'video';
        else if (kindHints.has('photo')) kind = 'photo';
        else if (kindHints.has('file')) kind = 'file';
        else if (kindHints.has('gif')) kind = 'gif';
        else if (kindHints.has('sticker')) kind = 'sticker';
        else if (kindHints.has('post')) kind = 'post';
        else if (kindHints.has('link') || links.length) kind = 'link';
        else if (attachment_urls.length) kind = 'attachment';

        return {
          links: [...new Set(links)],
          media_urls: [...new Set(media_urls)],
          attachment_urls: [...new Set(attachment_urls)],
          kind,
        };
      }

      function bodyFrom(el) {
        let best = '';
        for (const node of el.querySelectorAll('[dir="auto"]')) {
          const t = clean(node.innerText || node.textContent);
          if (!t || isChrome(t)) continue;
          if (/^(?:Enter,\\s*)?Message sent\\b/i.test(t)) continue;
          if (t.length > best.length) best = t;
        }
        if (best) return best;
        const t = clean(el.innerText || el.textContent);
        if (!t || isChrome(t)) return '';
        return t.replace(/^(?:Enter,\\s*)?Message sent\\s+.+?\\s+by\\s+[^:]+:\\s*/i, '').trim();
      }

      // Expand search root: message containers can sit outside pure aria parents
      function mediaRoot(el) {
        // climb a bit to include sibling media tiles under the same bubble group
        let node = el;
        for (let i = 0; i < 6 && node && node !== main; i += 1) {
          const media = collectMedia(node);
          if (media.media_urls.length || media.attachment_urls.length || media.links.length) {
            return { node, media };
          }
          node = node.parentElement;
        }
        return { node: el, media: collectMedia(el) };
      }

      const messages = [];
      const seenEls = new WeakSet();

      for (const el of main.querySelectorAll('[aria-label]')) {
        const aria = el.getAttribute('aria-label') || '';
        const parsed = parseAria(aria);
        if (!parsed) continue;
        if (seenEls.has(el)) continue;
        let parentHit = false;
        let p = el.parentElement;
        for (let i = 0; i < 5 && p; i += 1, p = p.parentElement) {
          if (p.getAttribute && parseAria(p.getAttribute('aria-label') || '')) {
            parentHit = true;
            break;
          }
        }
        if (parentHit) continue;
        seenEls.add(el);

        let text = parsed.text;
        if (parsed.needsBody || !text) text = bodyFrom(el) || text;
        if (text && isChrome(text)) text = '';

        const { media } = mediaRoot(el);
        if (!text && !media.media_urls.length && !media.attachment_urls.length && !media.links.length) {
          // photo-only message with empty aria body still counts if nearby open-photo
          continue;
        }

        messages.push({
          from_me: parsed.from_me,
          sender: parsed.sender,
          text: text || '',
          time: parsed.time || '',
          kind: media.kind,
          links: media.links,
          media_urls: media.media_urls,
          attachment_urls: media.attachment_urls,
        });
      }

      // Also pick up orphan media clusters tied to "Open photo" near a recent empty message sent aria
      // Fallback: scan message-sent empties already handled via needsBody + mediaRoot

      // Global fallback: if very few messages, harvest text path without media
      if (messages.length < 1) {
        for (const el of main.querySelectorAll('[dir="auto"]')) {
          const text = clean(el.innerText || el.textContent);
          if (!text || isChrome(text) || text.length > 2000) continue;
          const { media } = mediaRoot(el);
          messages.push({
            from_me: false,
            sender: '',
            text,
            time: '',
            kind: media.kind,
            links: media.links,
            media_urls: media.media_urls,
            attachment_urls: media.attachment_urls,
          });
        }
      }

      // Thread-level media inventory (helps when photos aren't nested under aria message nodes)
      const inventory = collectMedia(main);

      return {
        authRequired: false,
        thread_id,
        title: clean(document.title),
        messages,
        inventory,
      };
    })()`);

    if (result?.authRequired) {
      throw new AuthRequiredError('www.facebook.com', 'Log in to Facebook in Chrome first.');
    }

    let messages = postFilterMessages(Array.isArray(result?.messages) ? result.messages : []);

    // If photo inventory exists but no message captured media, append inventory rows
    const inv = result?.inventory || {};
    const hasMediaInMessages = messages.some((m) => m.media_urls || m.attachment_urls);
    if (!hasMediaInMessages && (inv.media_urls?.length || inv.attachment_urls?.length)) {
      messages.push({
        from_me: false,
        sender: '',
        text: `[${(inv.media_urls || []).length || (inv.attachment_urls || []).length} attachment(s) in view]`,
        time: '',
        kind: inv.kind || 'photo',
        links: joinUrls(inv.links || []),
        media_urls: joinUrls(inv.media_urls || []),
        attachment_urls: joinUrls(inv.attachment_urls || []),
      });
    }

    messages = messages.filter((m, idx, arr) => {
      if (!/(…|\.\.\.)$/.test(m.text)) return true;
      const stem = m.text.replace(/(…|\.\.\.)$/, '').trim().toLowerCase();
      if (stem.length < 12) return true;
      return !arr.some(
        (other, j) => j !== idx && other.text.toLowerCase().startsWith(stem) && other.text.length > m.text.length,
      );
    });

    if (messages.length > limit) messages = messages.slice(-limit);
    if (messages.length === 0) {
      throw new EmptyResultError(
        'facebook thread',
        'No messages extracted from this thread. The thread UI may have changed or the chat is empty.',
      );
    }
    return messages.map((m, i) => ({
      index: i + 1,
      from_me: Boolean(m.from_me),
      sender: m.sender || (m.from_me ? 'You' : ''),
      text: m.text || '',
      time: m.time || '',
      kind: m.kind || 'text',
      links: m.links || '',
      media_urls: m.media_urls || '',
      attachment_urls: m.attachment_urls || '',
    }));
  },
});
