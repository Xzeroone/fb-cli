import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import {
  cleanPostUrl,
  isGoodAuthor,
  isGoodSummary,
  isUiChrome,
  postKind,
  rankPostUrl,
  stripNoise,
} from './_post_utils.js';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

function normalizeLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAX) {
    throw new ArgumentError(
      `facebook search-posts --limit must be 1..${LIMIT_MAX}, got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

/** Node-side polish/dedupe of raw browser rows. */
export function polishSearchRows(rawRows, limit) {
  const rows = [];
  const seenUrl = new Set();
  const seenSummary = new Set();

  for (const r of rawRows || []) {
    let url = cleanPostUrl(r.url || '');
    let author = stripNoise(r.author || '');
    let summary = stripNoise(r.summary || '');

    // strip UI crumbs from author/summary
    author = author
      .replace(/\s*(See more|See less|Voir plus|Voir moins)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    summary = summary
      .replace(/\s*(See more|See less|Voir plus|Voir moins)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // author that is really a truncated summary is not an author
    if (author.length > 48 && /[.!?]|https?:/i.test(author)) {
      if (!summary || summary.length < author.length) summary = author;
      author = '';
    }

    if (author && !isGoodAuthor(author)) author = '';
    if (summary && !isGoodSummary(summary)) summary = '';

    // drop search-shell / empty
    if (!url && !summary) continue;
    if (url && /\/search\//i.test(url)) url = '';

    // require a real public content URL when possible; keep text-only only if strong summary
    if (!url && summary.length < 60) continue;
    if (!summary && !url) continue;

    // junk card: only "Facebook" spam
    if (/^(Facebook\s*)+$/i.test(summary)) continue;

    // author shouldn't duplicate entire summary / caption lead
    if (author && summary) {
      const a = author.toLowerCase().replace(/[…⋯.]+$/g, '').trim();
      const s = summary.toLowerCase();
      if (s.startsWith(a) || a.length >= 12 && s.includes(a.slice(0, Math.min(a.length, 24)))) {
        const rest = summary.slice(author.length).replace(/^[·\s\-:…⋯.]+/, '').trim();
        if (rest.length >= 20) summary = rest;
        // if author is just the first words of the caption, drop it
        if (s.startsWith(a)) author = '';
      }
    }

    // cap
    summary = summary.slice(0, 360);
    author = author.slice(0, 80);

    const kind = postKind(url) || r.kind || 'post';
    const urlKey = url || `text:${summary.slice(0, 100).toLowerCase()}`;
    // near-duplicate captions (same post, multi photo) → keep first only
    const sumKey = summary
      .slice(0, 90)
      .toLowerCase()
      .replace(/[^a-z0-9\u00c0-\u024f ]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (seenUrl.has(urlKey)) continue;
    if (sumKey && seenSummary.has(sumKey)) continue;
    seenUrl.add(urlKey);
    if (sumKey) seenSummary.add(sumKey);

    rows.push({
      author,
      summary: summary || (url ? `[${kind}]` : ''),
      url,
      kind,
      _rank: rankPostUrl(url) + (summary ? 0 : 2) + (author ? 0 : 1),
    });
  }

  rows.sort((a, b) => a._rank - b._rank || (b.summary.length - a.summary.length));
  return rows.slice(0, limit).map(({ _rank, ...rest }) => rest);
}

cli({
  site: 'facebook',
  name: 'search-posts',
  access: 'read',
  description:
    'Search public Facebook posts. Returns author, summary, canonical URL, and kind (post/photo/reel/video).',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', type: 'str', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: LIMIT_DEFAULT, help: 'Max posts (1-50)' },
  ],
  columns: ['index', 'author', 'summary', 'url', 'kind'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for facebook search-posts');
    const query = String(args.query || '').trim();
    if (!query) throw new ArgumentError('query is required');
    const limit = normalizeLimit(args.limit);

    // Prefer Posts filter URL; fall back paths if empty
    const urls = [
      `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`,
      `https://www.facebook.com/search/posts?q=${encodeURIComponent(query)}`,
      `https://www.facebook.com/search/top/?q=${encodeURIComponent(query)}`,
    ];

    let best = [];
    let lastAuth = false;

    for (const searchUrl of urls) {
      try {
        await page.goto(searchUrl, { settleMs: 5000 });
      } catch (err) {
        continue;
      }
      await page.wait(2.5);

      // Progressive scroll to hydrate results. Scale with requested limit so
      // --limit 50 actually loads more than a single viewport.
      const scrollRounds = Math.min(22, Math.max(6, Math.ceil(limit / 3) + 4));
      let lastCount = 0;
      let stagnant = 0;
      for (let i = 0; i < scrollRounds; i += 1) {
        await page.evaluate(`(() => { window.scrollBy(0, Math.floor(window.innerHeight * 0.9)); })()`);
        await page.wait(i < 3 ? 1.1 : 0.75);
        // early stop if link density stops growing
        const cnt = await page.evaluate(`(() => {
          let n = 0;
          for (const a of document.querySelectorAll('a[href]')) {
            const h = a.href || '';
            if (/\\/posts\\/|permalink\\.php|story\\.php|photo\\/\\?fbid=|\\/reel\\/|\\/videos\\/|fbid=\\d+/i.test(h) && !/\\/search\\//i.test(h)) n += 1;
          }
          return n;
        })()`);
        if (typeof cnt === 'number') {
          if (cnt <= lastCount) stagnant += 1; else stagnant = 0;
          lastCount = cnt;
          if (cnt >= limit * 2 && stagnant >= 2) break;
          if (stagnant >= 4 && i > 6) break;
        }
      }

      const extracted = await page.evaluate(`(() => {
        const clean = (s) => String(s || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim();
        const stripNoise = (s) => clean(s)
          .replace(/(?:[a-z0-9]\\s){5,}[a-z0-9]?/gi, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
        const path = location.pathname || '';
        if (/\\/(login|checkpoint)/i.test(path)) return { authRequired: true, rows: [] };

        function isChrome(t) {
          if (!t) return true;
          if (/^(Like|Comment|Share|Follow|Join|See more|See less|Voir plus|All|People|Posts|Reels|Pages|Groups|Events|Marketplace|Filters|Search results|Most relevant|Newest)$/i.test(t)) return true;
          if (/^(Facebook\\s*)+$/i.test(t)) return true;
          return false;
        }

        function looksLikePostHref(h) {
          return /\\/posts\\/|permalink\\.php|story\\.php|photo\\/\\?fbid=|\\/reel\\/|\\/videos\\/|fbid=\\d+/i.test(h)
            && !/\\/search\\//i.test(h)
            && !/\\/reel\\/\\?s=tab/i.test(h);
        }

        const rows = [];
        const push = (row) => {
          if (!row) return;
          rows.push(row);
        };

        // Strategy A: role=article cards
        for (const el of document.querySelectorAll('[role="article"]')) {
          const full = stripNoise(el.innerText || el.textContent || '');
          if (full.length < 20) continue;
          if (/^Filters\\b/i.test(full) || /^Search results\\b/i.test(full)) continue;

          let author = '';
          const heading = el.querySelector('h2 a[href], h3 a[href], h4 a[href], strong a[href]');
          if (heading) author = stripNoise(heading.innerText || heading.textContent || '');
          if (!author || isChrome(author)) {
            for (const n of el.querySelectorAll('[dir="auto"]')) {
              const t = stripNoise(n.innerText || '');
              if (t && t.length >= 2 && t.length <= 70 && !isChrome(t)) { author = t; break; }
            }
          }

          let summary = '';
          for (const n of el.querySelectorAll('[dir="auto"]')) {
            const t = stripNoise(n.innerText || '');
            if (!t || isChrome(t) || t === author) continue;
            if (t.length < 18) continue;
            if (t.length > summary.length) summary = t;
          }
          if (!summary && full.length > 30) {
            summary = full;
            if (author && summary.startsWith(author)) summary = summary.slice(author.length).trim();
          }
          summary = summary.replace(/\\s*See more\\s*$/i, '').replace(/\\s*Voir plus\\s*$/i, '').slice(0, 360);

          const candidates = [];
          for (const a of el.querySelectorAll('a[href]')) {
            const href = a.href || '';
            if (looksLikePostHref(href)) candidates.push(href);
          }
          candidates.sort((a, b) => {
            const score = (h) => (/\\/posts\\/|permalink|story\\.php/i.test(h) ? 0 : /photo|fbid=/i.test(h) ? 1 : 2);
            return score(a) - score(b);
          });
          const url = candidates[0] || '';
          if (!summary && !url) continue;
          push({ author, summary, url, kind: 'post' });
        }

        // Strategy B: harvest every public content link + nearest text bubble
        const linkMap = new Map();
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.href || '';
          if (!looksLikePostHref(href)) continue;
          if (linkMap.has(href)) continue;

          let author = '';
          let summary = '';
          // walk up for context
          let node = a.parentElement;
          for (let d = 0; d < 10 && node; d += 1, node = node.parentElement) {
            const text = stripNoise(node.innerText || '');
            if (text.length < 30 || text.length > 1200) continue;
            // too huge = whole page
            if (text.length > 900) continue;
            const dirs = [];
            node.querySelectorAll('[dir="auto"]').forEach((n) => {
              const t = stripNoise(n.innerText || '');
              if (t && !isChrome(t)) dirs.push(t);
            });
            if (dirs[0] && dirs[0].length <= 80) author = dirs[0];
            summary = dirs.filter((t) => t !== author).sort((x, y) => y.length - x.length)[0] || text;
            if (summary.length >= 24) break;
          }
          if (!summary) {
            // aria or adjacent
            summary = stripNoise(a.getAttribute('aria-label') || a.innerText || '');
          }
          linkMap.set(href, {
            author,
            summary: String(summary || '').replace(/\\s*See more\\s*$/i, '').slice(0, 360),
            url: href,
            kind: 'post',
          });
        }
        for (const row of linkMap.values()) push(row);

        // Strategy C: parse main feed-ish blocks from visible text when DOM is hostile
        if (rows.length < 2) {
          const main = document.querySelector('[role="main"]') || document.body;
          const chunks = stripNoise(main.innerText || '').split(/(?=\\bLike\\b|\\bComment\\b|\\bShare\\b)/i);
          for (const chunk of chunks) {
            const t = stripNoise(chunk);
            if (t.length < 50 || t.length > 500) continue;
            if (isChrome(t)) continue;
            // first line-ish as author
            const parts = t.split(' · ');
            let author = '';
            let summary = t;
            if (parts[0] && parts[0].length <= 60 && parts.length > 1) {
              author = parts[0];
              summary = parts.slice(1).join(' · ');
            }
            push({ author, summary: summary.slice(0, 360), url: '', kind: 'post' });
          }
        }

        return {
          authRequired: false,
          rows,
          articleCount: document.querySelectorAll('[role="article"]').length,
          linkCount: linkMap.size,
          href: location.href,
        };
      })()`);

      if (extracted?.authRequired) {
        lastAuth = true;
        continue;
      }
      const polished = polishSearchRows(extracted?.rows || [], limit);
      if (polished.length > best.length) best = polished;
      // Prefer Posts filter; stop once we have enough (or nearly enough) hits
      if (best.length >= limit) break;
      if (best.length >= Math.min(limit, 12) && /\/search\/posts/i.test(searchUrl)) break;
    }

    if (lastAuth && !best.length) {
      throw new AuthRequiredError('www.facebook.com', 'Log in to Facebook in Chrome first.');
    }
    if (!best.length) {
      throw new EmptyResultError(
        'facebook search-posts',
        'No public posts extracted. Facebook may be throttling search — try a simpler query, wait, or open Posts search in Chrome once.',
      );
    }

    return best.map((r, i) => ({
      index: i + 1,
      author: r.author || '',
      summary: r.summary || '',
      url: r.url || '',
      kind: r.kind || postKind(r.url) || 'post',
    }));
  },
});
