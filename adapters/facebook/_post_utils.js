/** Shared helpers for facebook search-posts + post adapters (Node side). */

export function cleanText(s) {
  return String(s || '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Facebook injects spaced random tracking glyphs into accessibility text. */
export function stripNoise(s) {
  return cleanText(s)
    .replace(/(?:[a-z0-9]\s){5,}[a-z0-9]?/gi, ' ')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isUiChrome(t) {
  const s = cleanText(t);
  if (!s) return true;
  if (
    /^(Like|Comment|Share|Follow|Join|See more|See less|Voir plus|Voir moins|All|People|Posts|Reels|Pages|Groups|Events|Marketplace|Filters|Search results|Most relevant|Newest|Recent|Comments|Write a comment|Log in|Sign up|Gaming|Home|Watch|Live|Friends|Notifications|Menu)$/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/^(Facebook\s*)+$/i.test(s)) return true;
  if (/^React with\b/i.test(s)) return true;
  if (/^Comment on\b/i.test(s)) return true;
  if (/^See who reacted/i.test(s)) return true;
  if (/^\d+\s*(comments?|shares?|likes?)$/i.test(s)) return true;
  return false;
}

export function postKind(url) {
  const u = String(url || '');
  if (/\/reel\//i.test(u) || /\/reel\/?\?/i.test(u)) return 'reel';
  if (/photo\/\?fbid=/i.test(u) || /fbid=\d+/i.test(u)) return 'photo';
  if (/\/videos\//i.test(u) || /\/watch\//i.test(u)) return 'video';
  if (/\/posts\//i.test(u) || /permalink\.php/i.test(u) || /story\.php/i.test(u)) return 'post';
  return 'link';
}

/** Canonical public post/photo URL without tracking junk. */
export function cleanPostUrl(href) {
  if (!href) return '';
  try {
    const u = new URL(href, 'https://www.facebook.com');
    if (!/facebook\.com$/i.test(u.hostname) && !/\.facebook\.com$/i.test(u.hostname)) {
      return '';
    }
    // reject search shell links
    if (/\/search\//i.test(u.pathname)) return '';
    if (u.pathname === '/' || u.pathname === '') return '';

    const tracking = [
      '__cft__[0]',
      '__tn__',
      'refid',
      'ref',
      '_ft_',
      'fbclid',
      'paipv',
      'eav',
      'mibextid',
    ];
    for (const k of tracking) u.searchParams.delete(k);
    // drop empty cft-style leftovers
    [...u.searchParams.keys()].forEach((k) => {
      if (/^__/i.test(k) || /cft/i.test(k)) u.searchParams.delete(k);
    });

    // photo: keep fbid (+ set if present)
    if (/photo/i.test(u.pathname) || u.searchParams.get('fbid')) {
      const fbid = u.searchParams.get('fbid');
      if (fbid) {
        const set = u.searchParams.get('set');
        return set
          ? `https://www.facebook.com/photo/?fbid=${fbid}&set=${encodeURIComponent(set)}`
          : `https://www.facebook.com/photo/?fbid=${fbid}`;
      }
    }

    // /page/posts/id
    if (/\/posts\//i.test(u.pathname)) {
      return `https://www.facebook.com${u.pathname.replace(/\/$/, '')}`;
    }

    // permalink.php?story_fbid=&id=
    if (/permalink\.php/i.test(u.pathname)) {
      const story = u.searchParams.get('story_fbid');
      const id = u.searchParams.get('id');
      if (story && id) {
        return `https://www.facebook.com/permalink.php?story_fbid=${story}&id=${id}`;
      }
    }

    // story.php
    if (/story\.php/i.test(u.pathname)) {
      const story = u.searchParams.get('story_fbid');
      const id = u.searchParams.get('id');
      if (story && id) {
        return `https://www.facebook.com/story.php?story_fbid=${story}&id=${id}`;
      }
    }

    // reel
    if (/\/reel\//i.test(u.pathname)) {
      return `https://www.facebook.com${u.pathname.replace(/\/$/, '')}`;
    }

    // videos
    if (/\/videos\//i.test(u.pathname)) {
      return `https://www.facebook.com${u.pathname.replace(/\/$/, '')}`;
    }

    // generic facebook path without query noise
    if (u.pathname.length > 1) {
      return `https://www.facebook.com${u.pathname.replace(/\/$/, '')}`;
    }
    return '';
  } catch {
    return String(href).split('&__cft__')[0].split('&fbclid=')[0].split('#')[0];
  }
}

export function unwrapExternal(href) {
  try {
    const u = new URL(href);
    if (u.hostname.includes('l.facebook.com') || u.hostname.includes('lm.facebook.com')) {
      const target = u.searchParams.get('u');
      if (target) {
        const out = new URL(decodeURIComponent(target));
        out.searchParams.delete('fbclid');
        return out.toString();
      }
    }
    u.searchParams.delete('fbclid');
    return u.toString();
  } catch {
    return href;
  }
}

export function isGoodSummary(s) {
  const t = stripNoise(s);
  if (!t || t.length < 24) return false;
  if (isUiChrome(t)) return false;
  if (/^(Facebook\s*)+$/i.test(t)) return false;
  // mostly tracking leftovers
  if ((t.match(/[a-z]/gi) || []).length < 10) return false;
  return true;
}

export function isGoodAuthor(s) {
  const t = stripNoise(s);
  if (!t || t.length < 2 || t.length > 80) return false;
  if (isUiChrome(t)) return false;
  if (/^https?:/i.test(t)) return false;
  if (/facebook/i.test(t) && t.split(/\s+/).length <= 2) return false;
  // FB anti-scrape garbage like "ZgKGj3.com" / "EOVu5V.com"
  if (/^[A-Za-z0-9]{3,14}\.(com|net|org|io|co)$/i.test(t)) return false;
  // captions mistaken for author (long ALL CAPS / sentence)
  if (t.length > 40 && (/[.!?]/.test(t) || (t === t.toUpperCase() && /[A-ZÀ-Ÿ]{8,}/.test(t)))) {
    return false;
  }
  // "RECHERCHE DE CLIENT …" style truncated captions
  if (/[…⋯\.…]{1,3}\s*$/.test(t) && t.length > 18) return false;
  if (/\.\.\.\s*$/.test(t) && t.length > 18) return false;
  // mostly uppercase marketing line used as fake author
  const letters = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const upper = (t.match(/[A-ZÀ-Ÿ]/g) || []).length;
  if (letters >= 12 && upper / letters > 0.7 && t.split(/\s+/).length >= 3) return false;
  return true;
}

export function rankPostUrl(url) {
  const k = postKind(url);
  if (k === 'post') return 0;
  if (k === 'photo') return 1;
  if (k === 'video') return 2;
  if (k === 'reel') return 3;
  return 9;
}
