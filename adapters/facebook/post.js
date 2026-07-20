import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import {
  cleanPostUrl,
  isUiChrome,
  postKind,
  stripNoise,
  unwrapExternal,
} from './_post_utils.js';
import { DISCOVER_MEDIA_JS } from './_media_utils.js';

function resolvePostUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new ArgumentError('facebook post requires a post/photo/reel URL or fbid');
  if (/^https?:\/\//i.test(value)) {
    if (!/facebook\.com|fb\.watch/i.test(value)) {
      throw new ArgumentError('URL must be a facebook.com post/photo/reel link');
    }
    return value;
  }
  if (/^\d+$/.test(value)) return `https://www.facebook.com/photo/?fbid=${value}`;
  throw new ArgumentError(`Unrecognized post target: ${value}`);
}

function isTimeLike(t) {
  const s = stripNoise(t);
  if (!s || s.length > 48) return false;
  if (isUiChrome(s)) return false;
  if (/^(Gaming|Home|Watch|Live|Friends|Marketplace|Menu|Reels|Notifications)$/i.test(s)) return false;
  return (
    /\bago\b/i.test(s) ||
    /yesterday|today|just now/i.test(s) ||
    /\b\d+\s*(s|m|h|d|w|min|mins|hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years)\b/i.test(s) ||
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(s) ||
    /^\d{1,2}:\d{2}/.test(s)
  );
}

function parseCommentBody(raw, authorHint = '') {
  let t = stripNoise(raw);
  // strip trailing UI: Like Reply 1 · 2w etc.
  t = t
    .replace(/\s*(Like|Reply|Réagir|Répondre|Share|Partager)(\s+\d+)?\s*$/gi, '')
    .replace(/\s*\d+[smhdw]\s*$/i, '')
    .replace(/\s*\d+\s*(w|week|weeks|d|day|days|h|hour|hours|m|min|mins)\s*$/i, '')
    .trim();
  if (authorHint && t.toLowerCase().startsWith(authorHint.toLowerCase())) {
    t = t.slice(authorHint.length).trim();
  }
  return t;
}

cli({
  site: 'facebook',
  name: 'post',
  access: 'read',
  description:
    'Deep-read a public Facebook post: text, reactions, media URLs, outbound links, comments + replies.',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'target',
      type: 'str',
      positional: true,
      required: true,
      help: 'Post/photo/reel URL or numeric fbid',
    },
    {
      name: 'comments',
      type: 'int',
      default: 20,
      help: 'Max comments to extract including replies (0-50)',
    },
  ],
  columns: [
    'author',
    'text',
    'time',
    'likes',
    'loves',
    'reactions',
    'comments_count',
    'shares',
    'url',
    'links',
    'media_kind',
    'media_urls',
    'kind',
    'comments_json',
  ],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for facebook post');
    const url = resolvePostUrl(args.target);
    const commentsLimit = Math.min(Math.max(Number(args.comments ?? 20), 0), 50);

    try {
      await page.goto(url, { settleMs: 4500 });
    } catch (err) {
      throw new CommandExecutionError(
        `Failed to open post: ${err instanceof Error ? err.message : err}`,
      );
    }
    await page.wait(2);

    // 1) Expand caption "See more" only (before comments pollute the DOM)
    await page.evaluate(`(() => {
      for (const b of document.querySelectorAll('[role="button"], div[role="button"]')) {
        const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
        if (/^(See more|Voir plus)$/i.test(t)) {
          // avoid buttons inside comment threads
          let p = b; let inC = false;
          for (let i = 0; i < 6 && p; i += 1, p = p.parentElement) {
            const al = (p.getAttribute && p.getAttribute('aria-label')) || '';
            if (/^Comment by\\b|Write a comment/i.test(al)) { inC = true; break; }
          }
          if (!inC) { try { b.click(); } catch (_) {} }
        }
      }
    })()`);
    await page.wait(0.6);

    // 2) Caption = longest non-comment dir=auto block (most reliable on FB web)
    const earlyText = await page.evaluate(`(() => {
      const stripNoise = (s) => String(s || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim()
        .replace(/(?:[a-z0-9]\\s){5,}[a-z0-9]?/gi, ' ').replace(/\\s+/g, ' ').trim();
      let best = '';
      for (const n of document.querySelectorAll('[dir="auto"]')) {
        let p = n; let skip = false;
        for (let i = 0; i < 10 && p; i += 1, p = p.parentElement) {
          const al = (p.getAttribute && p.getAttribute('aria-label')) || '';
          if (/^Comment by\\b|^Reply by\\b|Write a comment/i.test(al)) { skip = true; break; }
        }
        if (skip) continue;
        const t = stripNoise(n.innerText || n.textContent || '');
        if (!t || t.length < 40) continue;
        if (/^Most relevant is selected/i.test(t)) continue;
        if (/^(Like|Comment|Share)\\b/i.test(t)) continue;
        if (t.length > best.length) best = t;
      }
      return best.replace(/\\s*(See more|See less|Voir plus|Voir moins)\\s*$/i, '');
    })()`);

    // 3) Expand comments + replies
    for (let round = 0; round < 5; round += 1) {
      const clicked = await page.evaluate(`(() => {
        let n = 0;
        for (const b of document.querySelectorAll('[role="button"], div[role="button"]')) {
          const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
          if (/more comments/i.test(t) || (/\\brepl(y|ies)\\b/i.test(t) && !/^Hide\\b/i.test(t) && !/^Reply$/i.test(t))) {
            try { b.click(); n += 1; } catch (_) {}
          }
        }
        return n;
      })()`);
      if (!clicked) break;
      await page.wait(0.85);
    }

    const result = await page.evaluate(
      `((commentsLimit) => {
      const clean = (s) => String(s || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim();
      const stripNoise = (s) => clean(s)
        .replace(/(?:[a-z0-9]\\s){5,}[a-z0-9]?/gi, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
      const path = location.pathname || '';
      if (/\\/(login|checkpoint)/i.test(path)) return { authRequired: true };

      function isChrome(t) {
        if (!t) return true;
        if (/^(Like|Comment|Share|Follow|Most relevant|Comments|Write a comment|Write a comment…|All reactions|Log in|Sign up|Gaming|Home|Watch|Live|Reply|Réagir|Répondre)$/i.test(t)) return true;
        if (/^React with\\b|^Comment on\\b|^See who reacted|^Comment with\\b|^Post comment$/i.test(t)) return true;
        return false;
      }

      function isTimeLike(t) {
        const s = stripNoise(t);
        if (!s || s.length > 48 || isChrome(s)) return false;
        if (/^(Gaming|Home|Watch|Live|Friends|Marketplace|Menu|Reels)$/i.test(s)) return false;
        return /\\bago\\b|yesterday|today|just now|\\b\\d+\\s*(s|m|h|d|w|min|hr|hour|day|week|month|year)/i.test(s)
          || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\b/i.test(s)
          || /^\\d{1,2}:\\d{2}/.test(s);
      }

      // author
      let author = '';
      for (const sel of [
        'h2 a[role="link"]', 'h3 a[role="link"]', 'h4 a[role="link"]',
        '[data-ad-rendering-role="profile_name"] a', 'strong a[role="link"]',
      ]) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = stripNoise(el.innerText || el.textContent || '');
        if (t && !isChrome(t) && t.length <= 80) { author = t; break; }
      }

      // body text
      let text = '';
      const candidates = [];
      const seenBlocks = new Set();
      const roots = [
        document.querySelector('[data-ad-preview="message"]'),
        document.querySelector('[data-ad-comet-preview="message"]'),
        document.querySelector('[data-ad-rendering-role="story_message"]'),
        ...Array.from(document.querySelectorAll('[role="article"]')).slice(0, 3),
        document.querySelector('[role="main"]'),
      ].filter(Boolean);

      for (const root of roots) {
        for (const n of root.querySelectorAll('[dir="auto"]')) {
          let p = n;
          let inCommentUi = false;
          for (let i = 0; i < 8 && p; i += 1, p = p.parentElement) {
            const al = (p.getAttribute && p.getAttribute('aria-label')) || '';
            if (/^Comment by\\b|^Reply by\\b|Write a comment/i.test(al)) { inCommentUi = true; break; }
          }
          if (inCommentUi) continue;
          const t = stripNoise(n.innerText || n.textContent || '');
          if (!t || isChrome(t) || t === author || t.length < 12) continue;
          if (seenBlocks.has(t)) continue;
          seenBlocks.add(t);
          candidates.push(t);
        }
        if (candidates.some((c) => c.length > 80)) break;
      }
      candidates.sort((a, b) => {
        const score = (t) => t.length + (/[.!?]/.test(t) ? 40 : 0) + (/(https?:|#\\w)/i.test(t) ? 20 : 0);
        return score(b) - score(a);
      });
      text = (candidates[0] || '').replace(/\\s*(See more|See less|Voir plus|Voir moins)\\s*$/i, '');

      // reactions
      let likes = '', loves = '', reactions = '', commentsCount = '', shares = '', time = '';
      for (const el of document.querySelectorAll('[aria-label]')) {
        const a = clean(el.getAttribute('aria-label') || '');
        let m;
        m = a.match(/^Like:\\s*([\\d,.\\sKMB]+)\\s*people/i); if (m) likes = m[1].replace(/\\s+/g, '');
        m = a.match(/^Love:\\s*([\\d,.\\sKMB]+)\\s*people/i); if (m) loves = m[1].replace(/\\s+/g, '');
        m = a.match(/^All reactions?:\\s*([\\d,.\\sKMB]+)/i); if (m) reactions = m[1].replace(/\\s+/g, '');
        m = a.match(/([\\d,.\\sKMB]+)\\s*comments?/i); if (m && !commentsCount) commentsCount = m[1].replace(/\\s+/g, '');
        m = a.match(/([\\d,.\\sKMB]+)\\s*shares?/i); if (m && !shares) shares = m[1].replace(/\\s+/g, '');
      }
      if (!reactions) {
        const parts = [];
        if (likes) parts.push(likes + ' like');
        if (loves) parts.push(loves + ' love');
        reactions = parts.join(', ');
      }
      for (const a of document.querySelectorAll('a[href]')) {
        for (const cand of [clean(a.getAttribute('title') || ''), clean(a.getAttribute('aria-label') || ''), clean(a.innerText || '')]) {
          if (isTimeLike(cand)) { time = cand; break; }
        }
        if (time) break;
      }

      // outbound links (non-profile, non-nav)
      const links = [];
      const seenL = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        let href = a.href || '';
        if (!href || href.startsWith('javascript:')) continue;
        if (/facebook\\.com\\/(login|friends|marketplace|gaming|watch\\/?$|reel\\/\\?s=tab|search\\/|photo\\/\\?|profile\\.php\\?.*comment_id)/i.test(href)) continue;
        const isRedirect = /l\\.facebook\\.com|lm\\.facebook\\.com/i.test(href);
        const isExternal = !/facebook\\.com/i.test(href) && /^https?:/i.test(href);
        if (!isRedirect && !isExternal) continue;
        try {
          if (isRedirect) {
            const u = new URL(href);
            if (u.searchParams.get('u')) href = decodeURIComponent(u.searchParams.get('u'));
          }
          const u2 = new URL(href);
          u2.searchParams.delete('fbclid');
          href = u2.toString();
        } catch (_) {}
        if (seenL.has(href)) continue;
        seenL.add(href);
        links.push(href);
        if (links.length >= 10) break;
      }

      // ---- comments + replies ----
      // Structure: elements with aria-label "Comment by NAME TIME"
      // Nested replies often appear as subsequent "Comment by" under a parent, or text "X replied to Y"
      const comments = [];
      const commentEls = [];
      for (const el of document.querySelectorAll('[aria-label]')) {
        const aria = clean(el.getAttribute('aria-label') || '');
        if (!/^Comment by /i.test(aria) && !/^Reply by /i.test(aria)) continue;
        commentEls.push({ el, aria });
      }

      function depthOf(el) {
        // approximate nesting via offsetLeft / padding parents
        let d = 0;
        let p = el;
        for (let i = 0; i < 12 && p; i += 1, p = p.parentElement) {
          try {
            const st = window.getComputedStyle(p);
            const pl = parseInt(st.paddingLeft || '0', 10) || 0;
            const ml = parseInt(st.marginLeft || '0', 10) || 0;
            if (pl >= 24 || ml >= 24) d += 1;
          } catch (_) {}
        }
        // also check if previous sibling chain mentions "replied"
        return Math.min(d, 3);
      }

      for (const { el, aria } of commentEls) {
        if (comments.length >= commentsLimit) break;
        const isReply = /^Reply by /i.test(aria) || /replied to/i.test(aria);
        const m = aria.match(/^(?:Comment|Reply) by (.+?)(?:\\s+\\d|\\s*$)/i)
          || aria.match(/^(?:Comment|Reply) by (.+)$/i);
        let authorC = m ? m[1].replace(/\\s+\\d+\\s*(weeks?|days?|hours?|months?|years?|w|d|h|m)\\s*ago.*$/i, '').trim() : '';
        // time from aria
        let timeC = '';
        const tm = aria.match(/(\\d+\\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|s|m|h|d|w)\\s*ago|yesterday|just now)/i);
        if (tm) timeC = tm[1];

        let body = stripNoise(el.innerText || '');
        // Prefer dir=auto children for body
        const dirTexts = [];
        el.querySelectorAll('[dir="auto"]').forEach((n) => {
          const t = stripNoise(n.innerText || '');
          if (t && !isChrome(t) && t !== authorC) dirTexts.push(t);
        });
        if (dirTexts.length) {
          body = dirTexts.sort((a, b) => b.length - a.length)[0];
        }
        // cleanup
        if (authorC && body.toLowerCase().startsWith(authorC.toLowerCase())) {
          body = body.slice(authorC.length).trim();
        }
        body = body
          .replace(/\\s*(Like|Reply|Réagir|Répondre)(\\s+\\d+)?\\s*$/gi, '')
          .replace(/\\s*\\d+[smhdw]\\s*$/i, '')
          .trim();

        if (!body || body.length < 1) continue;
        if (isChrome(body)) continue;

        const depth = isReply ? Math.max(1, depthOf(el)) : depthOf(el) > 0 ? depthOf(el) : 0;

        // media in comment
        const media_urls = [];
        el.querySelectorAll('img').forEach((img) => {
          const src = img.currentSrc || img.src || '';
          if (!src || /data:|rsrc\\.php|emoji|s100x100|s40x40|s50x50|s160x160|s200x200/i.test(src)) return;
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (w && h && w * h < 100 * 100) return;
          media_urls.push(src);
        });

        comments.push({
          author: authorC.slice(0, 80),
          text: body.slice(0, 500),
          time: timeC,
          is_reply: depth > 0 || isReply,
          depth,
          media_urls: media_urls.slice(0, 3),
        });
      }

      // parent threading: if depth unknown, mark consecutive shorter-indented as replies when "replied" in nearby text
      for (let i = 1; i < comments.length; i += 1) {
        if (comments[i].is_reply) continue;
        // heuristic: very short reply-like under previous
        if (comments[i].text.length < 80 && comments[i - 1] && !comments[i].author.includes(comments[i - 1].author)) {
          // leave as top-level unless clearly nested
        }
      }

      let kind = 'post';
      const href = location.href;
      if (/photo\\/\\?fbid=/i.test(href) || /fbid=\\d+/i.test(href)) kind = 'photo';
      else if (/\\/reel\\//i.test(href)) kind = 'reel';
      else if (/\\/videos\\//i.test(href) || /\\/watch\\//i.test(href)) kind = 'video';

      return {
        authRequired: false,
        author,
        text,
        time,
        likes,
        loves,
        reactions,
        comments_count: commentsCount,
        shares,
        url: href,
        links,
        kind,
        comments,
      };
    })(${commentsLimit})`,
    );

    if (result?.authRequired) {
      throw new AuthRequiredError('www.facebook.com', 'Log in to Facebook in Chrome first.');
    }
    if (!result?.text && !result?.author) {
      throw new EmptyResultError(
        'facebook post',
        'Could not extract post content (private, deleted, or UI not loaded).',
      );
    }

    // media catalog on the post page
    const mediaCat = await page.evaluate(DISCOVER_MEDIA_JS);
    const mediaItems = (mediaCat?.items || []).filter((i) => i.kind !== 'link' || !/facebook\\.com/i.test(i.source_url || ''));
    const mediaUrls = [];
    const mediaKinds = new Set();
    for (const it of mediaItems) {
      if (it.kind === 'link') continue;
      const u = it.source_url || it.viewer_url;
      if (!u) continue;
      if (/s100x100|s40x40|s50x50|s160x160|profile/i.test(u)) continue;
      mediaUrls.push(u);
      mediaKinds.add(it.kind || 'photo');
    }

    let time = result.time || '';
    if (time && !isTimeLike(time)) time = '';

    const links = (Array.isArray(result.links) ? result.links : [])
      .map((l) => unwrapExternal(l))
      .filter(Boolean);

    const comments = Array.isArray(result.comments) ? result.comments : [];
    // polish comment texts
    const polishedComments = comments.map((c) => ({
      author: stripNoise(c.author || ''),
      text: parseCommentBody(c.text || '', c.author || ''),
      time: c.time || '',
      is_reply: Boolean(c.is_reply),
      depth: Number(c.depth || 0),
      media_urls: Array.isArray(c.media_urls) ? c.media_urls : [],
    })).filter((c) => c.text && c.text.length > 0);

    // Prefer early caption snapshot (captured before comments expand)
    let text = stripNoise(earlyText || result.text || '')
      .replace(/\s*(See more|See less|Voir plus|Voir moins)\s*$/i, '')
      .trim();
    if (polishedComments.some((c) => c.author === text || c.text === text)) {
      text = stripNoise(earlyText || '');
    }
    if (!text) {
      text = stripNoise(result.text || '')
        .replace(/\s*(See more|See less|Voir plus|Voir moins)\s*$/i, '')
        .trim();
    }

    const canonical = cleanPostUrl(result.url || url) || result.url || url;
    const media_kind = [...mediaKinds].join(',') || (result.kind === 'photo' ? 'photo' : result.kind === 'video' || result.kind === 'reel' ? result.kind : '');

    return [
      {
        author: stripNoise(result.author || ''),
        text,
        time,
        likes: result.likes || '',
        loves: result.loves || '',
        reactions: result.reactions || '',
        comments_count: result.comments_count || String(polishedComments.length || ''),
        shares: result.shares || '',
        url: canonical,
        links: links.join(' | '),
        media_kind,
        media_urls: mediaUrls.slice(0, 12).join(' | '),
        kind: result.kind || postKind(canonical),
        comments_json: JSON.stringify(polishedComments),
      },
    ];
  },
});
