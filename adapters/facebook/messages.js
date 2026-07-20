import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;

function normalizeLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAX) {
    throw new ArgumentError(
      `facebook messages --limit must be an integer in [1, ${LIMIT_MAX}], got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

function parseConversation(text, href) {
  const clean = String(text || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const threadMatch = String(href || '').match(/\/messages\/t\/([^/?#]+)/);
  const thread_id = threadMatch?.[1] || '';
  const unread = /Unread message:/i.test(clean);

  let body = clean
    .replace(/^Active now\s+/i, '')
    .replace(/\bUnread message:\s*/i, '')
    .trim();

  // Trailing time: · 2h | · 1d | · Mon | · 3:45 PM
  let time = '';
  const timeMatch = body.match(
    /\s*[·•]\s*((?:\d+\s*[smhdw])|(?:Today|Yesterday|Just now)|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)|(?:\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?))\s*$/i,
  );
  if (timeMatch) {
    time = timeMatch[1].trim();
    body = body.slice(0, timeMatch.index).trim();
  }

  let name = '';
  let snippet = '';

  // "You: ..." outbox preview
  const youMatch = body.match(/^(.*?)\s+You:\s*(.*)$/i);
  if (youMatch) {
    name = youMatch[1].trim();
    snippet = `You: ${youMatch[2].trim()}`;
  } else {
    const sentMatch = body.match(/^(.*?)\s+(sent\s+\d+\s+\w+.*)$/i);
    if (sentMatch) {
      name = sentMatch[1].trim();
      // collapse duplicated page name in "Name Name sent..."
      if (name.length > 20) {
        const half = Math.floor(name.length / 2);
        const a = name.slice(0, half).trim();
        const b = name.slice(half).trim();
        if (a && b && (a === b || name.startsWith(b) || name.endsWith(a))) {
          name = a.length <= b.length ? a : b;
        }
      }
      snippet = sentMatch[2].trim();
    } else {
      // Prefer: Title Case name + lowercase/long snippet
      const words = body.split(' ').filter(Boolean);
      let cut = Math.min(3, words.length);
      for (let i = 1; i < Math.min(6, words.length); i += 1) {
        const w = words[i];
        if (/^(you:|https?:)/i.test(w)) {
          cut = i;
          break;
        }
        // switch to snippet when a lower-case word appears after a name token
        if (i >= 2 && /^[a-zàâäéèêëïîôùûüç]/.test(w) && w.length > 2) {
          cut = i;
          break;
        }
      }
      name = words.slice(0, cut).join(' ').replace(/:$/, '').trim();
      snippet = words.slice(cut).join(' ').trim();
      if (!snippet && words.length > cut) snippet = body;
    }
  }

  // De-dupe "Name Name" double titles from FB accessibility text
  if (name) {
    const parts = name.split(' ');
    if (parts.length >= 4 && parts.length % 2 === 0) {
      const mid = parts.length / 2;
      const left = parts.slice(0, mid).join(' ');
      const right = parts.slice(mid).join(' ');
      if (left === right) name = left;
    }
  }

  return {
    thread_id,
    name: name || thread_id || 'Unknown',
    snippet: snippet || '',
    time: time || '',
    unread,
    url: href ? String(href).split('?')[0] : '',
  };
}

cli({
  site: 'facebook',
  name: 'messages',
  access: 'read',
  description: 'List recent Messenger conversations (inbox)',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: LIMIT_DEFAULT, help: 'Number of conversations' },
  ],
  columns: ['index', 'thread_id', 'name', 'snippet', 'time', 'unread', 'url'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for facebook messages');
    const limit = normalizeLimit(args.limit);

    try {
      await page.goto('https://www.facebook.com/messages/', { settleMs: 4000 });
    } catch (err) {
      throw new CommandExecutionError(
        `Failed to open Messenger: ${err instanceof Error ? err.message : err}`,
        'Check that facebook.com/messages is reachable and opencli doctor is green.',
      );
    }
    await page.wait(2);

    const result = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim();
      const path = location.pathname || '';
      if (/\\/(login|checkpoint)/i.test(path)) {
        return { authRequired: true, rows: [] };
      }
      const body = clean(document.body && document.body.innerText);
      if (/log in to facebook|log into facebook/i.test(body) && !/Messenger/i.test(body)) {
        return { authRequired: true, rows: [] };
      }

      const seen = new Set();
      const rows = [];
      const links = Array.from(document.querySelectorAll('a[href*="/messages/t/"]'));
      for (const a of links) {
        const href = (a.href || a.getAttribute('href') || '').split('?')[0];
        if (!href || seen.has(href)) continue;
        const text = clean(a.innerText || a.textContent);
        if (!text || text.length < 2) continue;
        // Skip pure compose/new-message chrome
        if (/^new message$/i.test(text)) continue;
        seen.add(href);
        rows.push({ href, text });
      }

      // Fallback: role=row text + nearest thread link
      if (rows.length === 0) {
        for (const row of document.querySelectorAll('[role="row"]')) {
          const text = clean(row.innerText || row.textContent);
          if (!text || text.length < 4) continue;
          const a = row.querySelector('a[href*="/messages/t/"]');
          const href = a ? (a.href || '').split('?')[0] : '';
          if (!href || seen.has(href)) continue;
          seen.add(href);
          rows.push({ href, text });
        }
      }
      return { authRequired: false, rows };
    })()`);

    if (result?.authRequired) {
      throw new AuthRequiredError(
        'www.facebook.com',
        'Messenger requires an active Facebook login in Chrome. Run: opencli facebook login',
      );
    }

    const raw = Array.isArray(result?.rows) ? result.rows : [];
    const items = raw
      .map((r) => parseConversation(r.text, r.href))
      .filter((r) => r.thread_id);

    // Dedup by thread_id
    const byId = new Map();
    for (const item of items) {
      if (!byId.has(item.thread_id)) byId.set(item.thread_id, item);
    }
    const list = Array.from(byId.values()).slice(0, limit);
    if (list.length === 0) {
      throw new EmptyResultError(
        'facebook messages',
        'No Messenger conversations were visible. Open facebook.com/messages in Chrome and confirm the inbox loads.',
      );
    }
    return list.map((item, index) => ({
      index: index + 1,
      thread_id: item.thread_id,
      name: item.name,
      snippet: item.snippet,
      time: item.time,
      unread: Boolean(item.unread),
      url: item.url || `https://www.facebook.com/messages/t/${item.thread_id}/`,
    }));
  },
});
