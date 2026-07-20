import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import {
  DISCOVER_MEDIA_JS,
  keepDir,
  pullCatalog,
  tmpDir,
} from './_media_utils.js';

function resolveTargetUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new ArgumentError('media-download requires <target> (thread id, messages URL, or post/photo URL)');
  if (/^https?:\/\//i.test(value)) return value.split('#')[0];
  // bare thread id or fbid
  if (/^\d+$/.test(value)) {
    // heuristic: long messenger thread ids vs fbid — both numeric; prefer messages if used via fb pull historically
    // caller can pass full URL for posts
    return `https://www.facebook.com/messages/t/${value}/`;
  }
  if (/^[a-zA-Z0-9._-]+$/.test(value)) {
    return `https://www.facebook.com/messages/t/${value}/`;
  }
  throw new ArgumentError(`Unrecognized target: ${value}`);
}

function namespaceFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/messages\/t\/([^/]+)/);
    if (m) return m[1];
    const fbid = u.searchParams.get('fbid');
    if (fbid) return `post-${fbid}`;
    const posts = u.pathname.match(/\/posts\/([^/]+)/);
    if (posts) return `post-${posts[1]}`;
    return u.pathname.replace(/\W+/g, '_').slice(0, 40) || 'media';
  } catch {
    return 'media';
  }
}

cli({
  site: 'facebook',
  name: 'media-download',
  access: 'read',
  description:
    'Unified temp-download for Messenger threads OR public posts. Discovers photos/videos/files/links, resolves full-size when possible, saves to ~/.local/state/fb/tmp/<id> (disposable).',
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
      help: 'Thread id, messages URL, or post/photo/reel URL',
    },
    { name: 'out', type: 'str', required: false, help: 'Output directory override' },
    { name: 'limit', type: 'int', default: 30, help: 'Max attachments to pull' },
    { name: 'keep', type: 'bool', default: false, help: 'Write under keep/ instead of tmp/' },
  ],
  columns: ['index', 'kind', 'name', 'path', 'bytes', 'source_url', 'viewer_url', 'tmpdir'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for media-download');
    const limit = Math.min(Math.max(Number(args.limit || 30), 1), 80);
    const keep = Boolean(args.keep);
    const url = resolveTargetUrl(args.target);
    const ns = namespaceFromUrl(url);
    const outDir = args.out ? String(args.out) : keep ? keepDir(ns) : tmpDir(ns);

    try {
      await page.goto(url, { settleMs: 4000 });
    } catch (err) {
      throw new CommandExecutionError(
        `Failed to open target: ${err instanceof Error ? err.message : err}`,
      );
    }
    await page.wait(2);

    // hydrate
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate(`(() => {
        for (const el of document.querySelectorAll('[role="main"], [role="grid"], [role="log"]')) {
          if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = Math.max(0, el.scrollTop - 1200);
        }
        window.scrollBy(0, 600);
      })()`);
      await page.wait(0.55);
    }

    const auth = await page.evaluate(`(() => {
      const p = location.pathname || '';
      return /\\/(login|checkpoint)/i.test(p);
    })()`);
    if (auth) throw new AuthRequiredError('www.facebook.com', 'Log in to Facebook in Chrome first.');

    const catalog = await page.evaluate(DISCOVER_MEDIA_JS);
    let items = Array.isArray(catalog?.items) ? catalog.items : [];

    // Prefer viewer-backed items over tiny previews
    const hasViewer = items.some((i) => i.viewer_url);
    if (hasViewer) {
      items = items.filter((i) => i.viewer_url || i.kind === 'link' || i.kind === 'video' || i.kind === 'pdf' || i.kind === 'file');
    }

    // For posts: also treat current photo page as a viewer item if large image present but empty catalog
    if (!items.length && /photo\/\?fbid=|\/posts\/|\/reel\//i.test(url)) {
      items.push({
        kind: /reel|video/i.test(url) ? 'video' : 'photo',
        name: 'main',
        source_url: '',
        viewer_url: url,
        page_url: url,
      });
    }

    if (!items.length) {
      throw new EmptyResultError(
        'facebook media-download',
        'No attachments found on this page. Scroll so media is visible, or open the post/thread in Chrome first.',
      );
    }

    const rows = await pullCatalog(page, items, {
      outDir,
      limit,
      referer: url,
    });

    const saved = rows.filter((r) => r.bytes > 0 || r.kind === 'link');
    if (!saved.length) {
      throw new CommandExecutionError(
        'Found attachment references but could not download bytes.',
        'Try again with the item visible, or pass a direct messenger_media / photo URL.',
      );
    }

    // return to original target
    try {
      await page.goto(url, { settleMs: 400 });
    } catch {
      /* ignore */
    }

    return rows.map((r) => ({
      index: r.index,
      kind: r.kind,
      name: r.name,
      path: r.path,
      bytes: r.bytes,
      source_url: r.source_url,
      viewer_url: r.viewer_url || '',
      tmpdir: r.tmpdir,
    }));
  },
});
