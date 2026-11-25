#!/usr/bin/env node
/**
 * Render the app and measure what a person actually sees.
 *
 * ── Why this is a script and not a code lint ────────────────────────────────
 *
 * Every finding below was invisible to source review, and two of them were
 * invisible to a naive rendered check as well:
 *
 *   1. The situation room drew incident rows on fixed light surfaces while
 *      text followed the theme. In dark mode the ticket reference and the
 *      incident type measured 1.00:1 — white on pink, the same colour. The
 *      severity chip still read CRITICAL, so the screen looked populated.
 *
 *   2. A first pass at measuring this read `getComputedStyle().backgroundColor`
 *      literally and so compared text against `rgba(16,185,129,0.1)` — a
 *      colour nobody sees. Alpha has to be flattened through every ancestor
 *      or the numbers are fiction in both directions.
 *
 *   3. It also counted a wide data table inside `overflow-x-auto` as "clipped".
 *      An element you can reach by scrolling its own container is not clipped,
 *      and a check that cries wolf gets ignored.
 *
 * Usage (both servers running, a seeded login):
 *
 *   node scripts/ui-contrast-audit.js
 *   node scripts/ui-contrast-audit.js --paths / /situation-room /cases
 *   AUDIT_EMAIL=… AUDIT_PASSWORD=… node scripts/ui-contrast-audit.js
 *
 * Exits non-zero if anything fails, so it can gate a release.
 */
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const WEB = arg('web', process.env.AUDIT_WEB_URL || 'http://127.0.0.1:3000');
const API = arg('api', process.env.AUDIT_API_URL || 'http://127.0.0.1:4000');
const EMAIL = process.env.AUDIT_EMAIL || 'officer@gombe.test';
const PASSWORD = process.env.AUDIT_PASSWORD || 'SituationRoom1!';
const pathsIdx = process.argv.indexOf('--paths');
const PATHS = pathsIdx > -1 ? process.argv.slice(pathsIdx + 1).filter((a) => !a.startsWith('--')) : ['/', '/situation-room'];
const WIDTHS = { phone: 375, tablet: 768, desktop: 1440 };

const srgb = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** Runs in the page: flatten alpha through ancestors, skip what is scrollable. */
function collect() {
  const parse = (s) => { const n = (s.match(/[\d.]+/g) || []).map(Number); return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 }; };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  /**
   * The colour actually behind an element, or null when it cannot be known.
   *
   * A gradient is a background-IMAGE: `backgroundColor` reports transparent,
   * so a naive walker reads straight through it to the page behind and
   * reports white-on-white. The account avatar is a green gradient with white
   * initials — perfectly legible — and was reported at 1.01:1 on every page.
   *
   * Rather than guess, say "unknown" and count it separately. A checker that
   * reports things that are fine teaches people to ignore the things that
   * are not.
   */
  const painted = (el) => {
    const stack = []; let n = el;
    while (n) {
      const st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage !== 'none') return null;
      const c = parse(st.backgroundColor);
      if (c.a > 0) stack.push(c);
      n = n.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const inScroller = (el) => {
    let n = el.parentElement;
    while (n) {
      const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
      n = n.parentElement;
    }
    return false;
  };

  const text = [], clipped = [], unknown = [];
  for (const el of document.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const label = (el.textContent || '').trim();

    if (!inScroller(el) && box.right > window.innerWidth + 1 && label && label.length < 60) {
      clipped.push({ px: Math.round(box.right - window.innerWidth), label: label.slice(0, 40) });
    }
    if (el.children.length || !label || label.length > 60) continue;

    const st = getComputedStyle(el);
    const fg = parse(st.color);
    if (fg.a === 0 || st.visibility === 'hidden') continue; // deliberately invisible
    const size = parseFloat(st.fontSize);
    const big = size >= 24 || (size >= 18.66 && parseInt(st.fontWeight, 10) >= 700);
    const bg = painted(el);
    if (!bg) { unknown.push(label.slice(0, 40)); continue; }
    text.push({ label: label.slice(0, 40), fg: [fg.r, fg.g, fg.b], bg: [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)], floor: big ? 3 : 4.5 });
  }
  return { text, clipped, unknown };
}

(async () => {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch((e) => { console.error(`Could not reach the API at ${API}: ${e.message}`); process.exit(2); });
  const auth = await res.json();
  if (!auth.accessToken) { console.error('Login failed. Set AUDIT_EMAIL / AUDIT_PASSWORD.'); process.exit(2); }

  // This repo pins its own @playwright/test, whose expected browser build is
  // not the one installed in the image. Launch normally where that works, and
  // fall back to the image's Chromium rather than downloading a second copy.
  const launch = async () => {
    try {
      return await chromium.launch({ args: ['--no-sandbox'] });
    } catch (err) {
      if (!/Executable doesn't exist/.test(String(err && err.message))) throw err;
      return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    }
  };
  const browser = await launch();
  let failures = 0;

  for (const theme of ['light', 'dark']) {
    for (const [device, width] of Object.entries(WIDTHS)) {
      for (const path of PATHS) {
        const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
        await ctx.addInitScript(([t, rt, u, th]) => {
          localStorage.setItem('ace_token', t);
          localStorage.setItem('ace_refresh_token', rt || '');
          localStorage.setItem('ace_user', u);
          localStorage.setItem('ace_theme', th);
        }, [auth.accessToken, auth.refreshToken, JSON.stringify(auth.user ?? {}), theme]);
        const page = await ctx.newPage();
        await page.goto(WEB + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // These screens poll, so `networkidle` never settles.
        await page.waitForTimeout(5000);

        const { text, clipped, unknown } = await page.evaluate(collect);
        const seen = new Set(); const bad = [];
        for (const t of text) {
          const key = t.label + t.fg + t.bg;
          if (seen.has(key)) continue;
          seen.add(key);
          const r = ratio(t.fg, t.bg);
          if (r < t.floor) bad.push(`    ${r.toFixed(2)}:1 (needs ${t.floor})  "${t.label}"`);
        }
        const clips = [...new Map(clipped.map((c) => [c.label, c])).values()]
          .map((c) => `    ${c.px}px past the right edge: "${c.label}"`);

        const n = bad.length + clips.length;
        failures += n;
        const skipped = new Set(unknown).size;
        console.log(`${theme.padEnd(5)} ${device.padEnd(7)} ${path.padEnd(18)} ${n === 0 ? 'ok' : `${n} problem(s)`}${skipped ? `  (${skipped} over a gradient, not measurable — check by eye)` : ''}`);
        [...bad, ...clips].slice(0, 10).forEach((l) => console.log(l));
        await ctx.close();
      }
    }
  }

  await browser.close();
  console.log(failures === 0 ? '\nNothing below its contrast floor, nothing clipped.' : `\n${failures} problem(s).`);
  process.exit(failures === 0 ? 0 : 1);
})();
