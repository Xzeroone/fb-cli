/**
 * Unified attachment model for Messenger + Posts.
 *
 * Everything useful is URL-based:
 *   - photo  → fbcdn / messenger_media / photo/?fbid=
 *   - video  → video src / poster / watch|reel URL
 *   - file   → download link / .pdf / messenger_media file
 *   - link   → external http(s) (unwrap l.facebook.com)
 *
 * Pipeline:
 *   discover (DOM) → classify → resolve (viewer if needed) → download (tmp) → keep|purge
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function storeRoot() {
  return process.env.FB_STORE_DIR || path.join(os.homedir(), '.local/state/fb');
}

export function tmpDir(namespace) {
  return path.join(storeRoot(), 'tmp', String(namespace || 'misc').replace(/[^\w.-]+/g, '_'));
}

export function keepDir(namespace) {
  return path.join(storeRoot(), 'keep', String(namespace || 'misc').replace(/[^\w.-]+/g, '_'));
}

export function extFromContentType(ct, url = '') {
  const c = String(ct || '').toLowerCase();
  if (c.includes('png')) return '.png';
  if (c.includes('webp')) return '.webp';
  if (c.includes('gif')) return '.gif';
  if (c.includes('pdf')) return '.pdf';
  if (c.includes('mp4') || c.includes('video')) return '.mp4';
  if (c.includes('jpeg') || c.includes('jpg')) return '.jpg';
  const m = String(url).match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (m && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'mp4', 'doc', 'docx', 'zip'].includes(m[1].toLowerCase())) {
    return `.${m[1].toLowerCase()}`;
  }
  return '.bin';
}

export function kindFromUrlAndType(url, contentType = '', hint = '') {
  if (hint && hint !== 'attachment') return hint;
  const u = String(url || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('pdf') || /\.pdf(\?|$)/i.test(u)) return 'pdf';
  if (ct.includes('video') || /\.(mp4|mov|webm)(\?|$)/i.test(u) || /\/videos\//i.test(u) || /\/reel\//i.test(u)) {
    return 'video';
  }
  if (ct.startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(u) || /fbcdn\.net|scontent/i.test(u) || /photo\/\?fbid=/i.test(u)) {
    return 'photo';
  }
  if (/messenger_media/i.test(u)) return 'attachment';
  if (/^https?:/i.test(u) && !/facebook\.com/i.test(u)) return 'link';
  return 'file';
}

export async function downloadBytes(url, referer = 'https://www.facebook.com/') {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: referer,
    },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const contentType = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  let filename = '';
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  if (m) filename = decodeURIComponent(m[1].replace(/"/g, '').trim());
  return { buf, contentType, filename };
}

export function saveBuffer(outDir, buf, { url = '', contentType = '', name = '', index = 1, kind = '' } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  // magic sniff
  let k = kind;
  let ct = contentType;
  if (buf.length >= 4 && buf.slice(0, 4).toString('utf8') === '%PDF') {
    k = 'pdf';
    ct = 'application/pdf';
  } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    k = 'photo';
    ct = ct || 'image/jpeg';
  }
  const ext = extFromContentType(ct, name || url);
  k = kindFromUrlAndType(url, ct, k);
  const hash = crypto.createHash('sha1').update(url || buf.slice(0, 64)).digest('hex').slice(0, 8);
  const base = (name || `att-${index}`)
    .replace(/[^\w.\-()+ ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || `att-${index}`;
  let fileName = `${String(index).padStart(3, '0')}-${hash}-${base}`;
  if (!path.extname(fileName)) fileName += ext;
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, buf);
  return { path: filePath, bytes: buf.length, kind: k, contentType: ct };
}

/**
 * Browser-side discovery script body (string) — shared discovery logic injected via page.evaluate.
 * Returns catalog items: { kind, name, source_url, viewer_url, page_url }
 */
export const DISCOVER_MEDIA_JS = `(() => {
  const clean = (s) => String(s || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim();
  const items = [];
  const seen = new Set();
  const push = (it) => {
    if (!it) return;
    const key = it.viewer_url || it.source_url || it.page_url || it.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(it);
  };

  const main = document.querySelector('[role="main"]') || document.body;

  // messenger_media viewers
  for (const a of main.querySelectorAll('a[href*="messenger_media"]')) {
    const viewer_url = (a.href || '').split('#')[0];
    const aria = clean(a.getAttribute('aria-label') || '');
    const text = clean(a.innerText || '');
    const img = a.querySelector('img');
    const src = img ? (img.currentSrc || img.src || '') : '';
    let kind = 'attachment';
    if (/photo|image|open photo/i.test(aria + ' ' + text) || src) kind = 'photo';
    else if (/video|open video/i.test(aria + ' ' + text)) kind = 'video';
    else if (/pdf/i.test(aria + ' ' + text + viewer_url)) kind = 'pdf';
    else if (/file|document|download/i.test(aria + ' ' + text)) kind = 'file';
    push({ kind, name: text || aria, source_url: src, viewer_url, page_url: location.href });
  }

  // download anchors
  for (const a of main.querySelectorAll('a[href]')) {
    const href = a.href || '';
    const aria = clean(a.getAttribute('aria-label') || '');
    const text = clean(a.innerText || '');
    const blob = aria + ' ' + text + ' ' + href;
    if (/download media attachment|download file|^download$/i.test(aria + ' ' + text) || /\\.pdf(\\?|$)/i.test(href)) {
      let kind = /pdf/i.test(blob) ? 'pdf' : /video/i.test(blob) ? 'video' : /image|photo|jpg|png/i.test(blob) ? 'photo' : 'file';
      push({ kind, name: text || aria || 'download', source_url: href, viewer_url: '', page_url: location.href });
    }
  }

  // large images
  for (const img of main.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:')) continue;
    if (/emoji|rsrc\\.php|s100x100|s40x40|s50x50|p100x100|static\\.xx\\.fbcdn/i.test(src)) continue;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w && h && w * h < 120 * 120) continue;
    // skip tiny profile avatars in comments
    if (/s200x200|s160x160|cp0|c0\\.\\d+\\.\\d+/i.test(src) && w <= 200 && h <= 200) continue;
    push({
      kind: 'photo',
      name: clean(img.alt || '').slice(0, 80),
      source_url: src,
      viewer_url: '',
      page_url: location.href,
    });
  }

  // videos
  for (const v of main.querySelectorAll('video')) {
    const src = v.currentSrc || v.src || '';
    const poster = v.poster || '';
    if (src) push({ kind: 'video', name: 'video', source_url: src, viewer_url: '', page_url: location.href });
    else if (poster) push({ kind: 'video', name: 'video-poster', source_url: poster, viewer_url: '', page_url: location.href });
  }

  // external links (not nav)
  for (const a of main.querySelectorAll('a[href^="http"]')) {
    let href = a.href || '';
    if (/facebook\\.com\\/(login|friends|marketplace|gaming|watch\\/?$|reel\\/\\?s=tab|search\\/|photo\\/\\?|profile\\.php\\?id=.*comment_id)/i.test(href)) continue;
    if (/l\\.facebook\\.com|lm\\.facebook\\.com/i.test(href)) {
      try {
        const u = new URL(href);
        if (u.searchParams.get('u')) href = decodeURIComponent(u.searchParams.get('u'));
      } catch (_) {}
    }
    if (/facebook\\.com/i.test(href) && !/\\.pdf(\\?|$)/i.test(href)) continue;
    if (!/^https?:/i.test(href)) continue;
    push({
      kind: 'link',
      name: clean(a.innerText || a.getAttribute('aria-label') || '').slice(0, 80),
      source_url: href,
      viewer_url: '',
      page_url: location.href,
    });
  }

  return { items, href: location.href, title: document.title };
})()`;

/**
 * Resolve full-size / download URL by opening a viewer page when needed.
 */
export async function resolveViaViewer(page, item) {
  if (!item?.viewer_url || !/messenger_media|photo\/\?fbid=/i.test(item.viewer_url)) {
    return item;
  }
  try {
    await page.goto(item.viewer_url, { settleMs: 2500 });
    await page.wait(1.0);
    const resolved = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      let download = '';
      for (const a of document.querySelectorAll('a[href]')) {
        const aria = clean(a.getAttribute('aria-label') || '');
        const text = clean(a.innerText || '');
        if (/download media attachment|download file|^download$/i.test(aria + ' ' + text)) {
          download = a.href || '';
          if (download) break;
        }
      }
      let bestImg = '';
      let bestArea = 0;
      for (const img of document.querySelectorAll('img')) {
        const src = img.currentSrc || img.src || '';
        if (!src || src.startsWith('data:') || /rsrc\\.php|emoji/i.test(src)) continue;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const area = w * h;
        if (area > bestArea) { bestArea = area; bestImg = src; }
      }
      let video = '';
      const v = document.querySelector('video');
      if (v) video = v.currentSrc || v.src || '';
      let fileHref = '';
      for (const a of document.querySelectorAll('a[href]')) {
        if (/\\.pdf(\\?|$)/i.test(a.href || '')) { fileHref = a.href; break; }
      }
      return { download, bestImg, bestArea, video, fileHref };
    })()`);

    const next = { ...item };
    if (resolved?.download) {
      next.source_url = resolved.download;
      if (/\.pdf/i.test(resolved.download)) next.kind = 'pdf';
      else if (/video|mp4/i.test(resolved.download)) next.kind = 'video';
      else next.kind = next.kind === 'attachment' ? 'photo' : next.kind;
    } else if (resolved?.fileHref) {
      next.source_url = resolved.fileHref;
      next.kind = 'pdf';
    } else if (resolved?.video) {
      next.source_url = resolved.video;
      next.kind = 'video';
    } else if (resolved?.bestImg && resolved.bestArea >= 200 * 200) {
      next.source_url = resolved.bestImg;
      if (next.kind === 'attachment' || next.kind === 'file') next.kind = 'photo';
    }
    return next;
  } catch {
    return item;
  }
}

export async function pullCatalog(page, items, { outDir, limit = 30, referer = 'https://www.facebook.com/' } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  const list = (items || []).slice(0, limit);
  let idx = 0;
  for (let raw of list) {
    idx += 1;
    // links: record only, optional no download
    if (raw.kind === 'link') {
      rows.push({
        index: idx,
        kind: 'link',
        name: raw.name || '',
        path: '',
        bytes: 0,
        source_url: raw.source_url || '',
        viewer_url: raw.viewer_url || '',
        tmpdir: outDir,
      });
      continue;
    }

    let item = raw;
    if (item.viewer_url) {
      item = await resolveViaViewer(page, item);
    }
    const url = item.source_url || '';
    if (!url || !/^https?:/i.test(url)) {
      rows.push({
        index: idx,
        kind: item.kind || 'attachment',
        name: item.name || '',
        path: '',
        bytes: 0,
        source_url: url,
        viewer_url: item.viewer_url || '',
        tmpdir: outDir,
      });
      continue;
    }

    try {
      const { buf, contentType, filename } = await downloadBytes(url, item.viewer_url || referer);
      if (!buf || buf.length < 32) throw new Error('empty body');
      const saved = saveBuffer(outDir, buf, {
        url,
        contentType,
        name: filename || item.name || `att-${idx}`,
        index: idx,
        kind: item.kind,
      });
      rows.push({
        index: idx,
        kind: saved.kind,
        name: filename || item.name || path.basename(saved.path),
        path: saved.path,
        bytes: saved.bytes,
        source_url: url,
        viewer_url: item.viewer_url || '',
        tmpdir: outDir,
      });
    } catch {
      rows.push({
        index: idx,
        kind: item.kind || 'attachment',
        name: item.name || '',
        path: '',
        bytes: 0,
        source_url: url,
        viewer_url: item.viewer_url || '',
        tmpdir: outDir,
      });
    }
  }

  const manifest = {
    created_at: new Date().toISOString(),
    disposable: outDir.includes(`${path.sep}tmp${path.sep}`),
    files: rows,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return rows;
}
