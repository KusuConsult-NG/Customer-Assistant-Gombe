/**
 * No screen sets a text colour that only works in one theme.
 *
 * ── The bug this exists to catch ────────────────────────────────────────────
 *
 * `text-slate-500` with no `dark:` counterpart renders #64748b in both
 * themes. On the light page that is 4.76:1 and fine; on the dark card it is
 * 3.75:1 and fails. Rendering every page in both themes found 209 failures
 * across the app, and 207 of them were this one mistake — in `/cases` and
 * `/budget`, on case references, filter labels, column headings and the
 * timestamps under every row.
 *
 * It is invisible when you write it, because you are almost certainly looking
 * at the theme where it works.
 *
 * ── Why a source rule as well as the rendered audit ─────────────────────────
 *
 * `scripts/ui-contrast-audit.js` is the real measurement: it composites alpha
 * and reports what a person actually sees. But it needs the app and the API
 * running and a seeded login, so it cannot gate every commit — and it only
 * sees what a page happens to RENDER. Eleven of the occurrences this test
 * finds were on branches the audit never reached: empty states, error
 * states, a panel that needs a row selected.
 *
 * So: this catches the pattern everywhere cheaply, the audit catches what
 * actually paints. Neither replaces the other.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const WEB_SRC = join(__dirname, '..', '..', 'web', 'src');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
};

/**
 * Greys that are legible on a light surface and fail on a dark one. Lighter
 * steps (slate-400 and up) are the dark-mode side of a pair and are fine.
 */
const ONE_THEME_ONLY = /\btext-slate-(500|600|700|800|900)\b/;

/** Every quoted string or template literal — i.e. every candidate className. */
const STRINGS = /(["'`])((?:[^"'`\\\n]|\\.)*?)\1/g;

/**
 * Some screens theme in JavaScript rather than with Tailwind's `dark:`
 * variant — `theme === 'dark' ? 'text-white' : 'text-slate-900'`. The light
 * branch of such a ternary is correct, and flagging it would be a false
 * positive; this app has eleven of them in the shell and the analytics page,
 * and the rendered audit confirms those pages pass in both themes.
 *
 * The ternary's head can sit a line or two above the branch it guards, so a
 * small window is searched rather than the line alone.
 */
const THEME_SWITCH = /\btheme\s*===|\btheme\s*\?|\bisDark\b|resolvedTheme/;
const WINDOW = 3;

describe('theme coverage in the web app', () => {
  const files = walk(WEB_SRC);

  it('finds the files it is meant to be checking', () => {
    // A guard whose corpus is empty passes forever while protecting nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('never sets a light-only text colour without a dark counterpart', () => {
    const offences: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        STRINGS.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = STRINGS.exec(line))) {
          const body = m[2];
          if (!ONE_THEME_ONLY.test(body)) continue;
          // A dark text colour in the same class string is the pair; fine.
          if (body.includes('dark:text-')) continue;
          // The light branch of a theme ternary is also fine.
          const near = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n');
          if (THEME_SWITCH.test(near)) continue;
          offences.push(
            `${file.replace(WEB_SRC, 'apps/web/src')}:${i + 1}  ${body.trim().slice(0, 80)}`,
          );
        }
      });
    }
    expect(offences.join('\n') || 'none').toBe('none');
  });
});
