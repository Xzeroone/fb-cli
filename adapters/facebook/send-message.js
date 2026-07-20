import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
} from '@jackwener/opencli/errors';

function resolveThreadUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new ArgumentError('facebook send-message requires --to (thread id, username id, or messages URL)');
  }
  if (/^https?:\/\//i.test(value)) {
    return value.split('?')[0];
  }
  if (/^\d+$/.test(value) || /^[a-zA-Z0-9._-]+$/.test(value)) {
    return `https://www.facebook.com/messages/t/${value}/`;
  }
  throw new ArgumentError(`Unrecognized --to target: ${value}`);
}

cli({
  site: 'facebook',
  name: 'send-message',
  access: 'write',
  description: 'Send a text message in a Messenger thread',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'to',
      type: 'str',
      required: true,
      help: 'Thread id, user id, or messages URL',
    },
    {
      name: 'message',
      type: 'str',
      required: true,
      help: 'Message text to send',
    },
  ],
  columns: ['sent', 'to', 'thread_url', 'message'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for facebook send-message');
    const message = String(args.message ?? '').trim();
    if (!message) throw new ArgumentError('--message must not be empty');
    if (message.length > 2000) {
      throw new ArgumentError('--message is too long (max 2000 characters)');
    }
    const url = resolveThreadUrl(args.to);

    try {
      await page.goto(url, { settleMs: 4000 });
    } catch (err) {
      throw new CommandExecutionError(
        `Failed to open thread: ${err instanceof Error ? err.message : err}`,
      );
    }
    await page.wait(2);

    const pre = await page.evaluate(`(() => {
      const path = location.pathname || '';
      if (/\\/(login|checkpoint)/i.test(path)) return { authRequired: true };
      return { authRequired: false, href: location.href };
    })()`);
    if (pre?.authRequired) {
      throw new AuthRequiredError('www.facebook.com', 'Log in to Facebook in Chrome first.');
    }

    // Find composer: contenteditable or textarea with message placeholder
    const composer = await page.evaluate(`(() => {
      const candidates = [
        ...Array.from(document.querySelectorAll('[aria-label][contenteditable="true"]')),
        ...Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"]')),
        ...Array.from(document.querySelectorAll('div[role="textbox"]')),
        ...Array.from(document.querySelectorAll('textarea')),
      ];
      const scored = candidates.map((el, i) => {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const ph = (el.getAttribute('placeholder') || '').toLowerCase();
        let score = 0;
        if (/message|aa|écrire|ecrire|écrire un message|type a message|write/i.test(aria + ' ' + ph)) score += 5;
        if (el.getAttribute('contenteditable') === 'true') score += 2;
        if (el.offsetParent !== null) score += 1;
        return { i, score, aria };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      return scored[0] || null;
    })()`);

    if (!composer) {
      throw new CommandExecutionError(
        'Could not find Messenger message composer',
        'Open the thread in Chrome, ensure chat is not blocked, and retry with --window foreground.',
      );
    }

    // Focus and type via opencli-style interaction: click then fill/type
    // Prefer evaluate to set text + dispatch input events for contenteditable
    const typed = await page.evaluate(`((msg) => {
      const candidates = [
        ...Array.from(document.querySelectorAll('[aria-label][contenteditable="true"]')),
        ...Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"]')),
        ...Array.from(document.querySelectorAll('div[role="textbox"]')),
        ...Array.from(document.querySelectorAll('textarea')),
      ];
      function score(el) {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const ph = (el.getAttribute('placeholder') || '').toLowerCase();
        let s = 0;
        if (/message|aa|écrire|ecrire|type a message|write/i.test(aria + ' ' + ph)) s += 5;
        if (el.getAttribute('contenteditable') === 'true') s += 2;
        if (el.offsetParent !== null) s += 1;
        return s;
      }
      candidates.sort((a, b) => score(b) - score(a));
      const el = candidates[0];
      if (!el) return { ok: false, reason: 'no composer' };
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.value = msg;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // contenteditable
        el.textContent = '';
        el.focus();
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, msg);
        } catch (_) {
          el.textContent = msg;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg, inputType: 'insertText' }));
        }
      }
      return { ok: true, aria: el.getAttribute('aria-label') || '' };
    })(${JSON.stringify(message)})`);

    if (!typed?.ok) {
      throw new CommandExecutionError(`Failed to type message: ${typed?.reason || 'unknown'}`);
    }

    await page.wait(0.4);

    // Press Enter to send (Messenger default)
    try {
      await page.evaluate(`(() => {
        const el = document.activeElement;
        if (!el) return;
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keypress', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
      })()`);
    } catch {
      // fallback: try Send button
      await page.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('[aria-label], [role="button"]'));
        const send = btns.find((b) => /^(Send|Envoyer)$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
        if (send) send.click();
      })()`);
    }

    await page.wait(1.2);

    return [
      {
        sent: true,
        to: String(args.to),
        thread_url: url,
        message,
      },
    ];
  },
});
