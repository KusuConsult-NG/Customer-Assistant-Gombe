/**
 * Every browser call to the API names the API's origin.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * The situation room shipped calling `apiFetch('/api/situation-room/overview')`
 * — a RELATIVE path. `apiFetch` passes its input straight to `fetch`, so a
 * relative path resolves against the page's own origin and the request goes to
 * the Next.js server, which serves no API routes. The browser got 404 on all
 * four of that screen's endpoints while `curl` to the API got 200, so the
 * screen rendered its headings, its captions and its caveats with every figure
 * empty, on the one screen whose entire job is to show what is happening.
 *
 * This only fails where web and API are on different origins, which is every
 * real deployment and no unit test.
 *
 * ── Why the route-accounting test did not catch it ──────────────────────────
 *
 * That test asks whether SOME file under `apps/web/src` builds a path matching
 * the route. `apiFetch('/api/situation-room/overview')` does build it, so the
 * route counted as reachable and the suite stayed green. "A screen mentions
 * this path" and "a browser can reach this endpoint" are different claims, and
 * only the first was being checked.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const WEB_SRC = join(__dirname, '..', '..', 'web', 'src');

const walk = (dir: string, keep: (n: string) => boolean): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(entry.name)) out.push(full);
  }
  return out;
};

/**
 * A call is a finding when its first argument starts with `/api/` — a path
 * relative to the page. Absolute forms are fine however they are spelled:
 * `${API_URL}/api/…`, a `url` variable built earlier, an http(s) literal.
 */
const RELATIVE_CALL = /\b(?:apiFetch|fetch)\(\s*(['"`])\/api\//g;

describe('browser calls to the API', () => {
  const files = walk(WEB_SRC, (n) => /\.(ts|tsx)$/.test(n));

  it('never use a path relative to the web origin', () => {
    const offences: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        RELATIVE_CALL.lastIndex = 0;
        if (RELATIVE_CALL.test(line)) {
          offences.push(`${file.replace(WEB_SRC, 'apps/web/src')}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offences.join('\n') || 'none').toBe('none');
  });

  it('finds the calls it is meant to be checking', () => {
    // Guards the guard. A regex that matches nothing passes the test above
    // forever and silently stops protecting anything — so assert that the
    // corpus really does contain API calls for it to have inspected.
    const withApiUrl = files.filter((f) => /apiFetch\(\s*`\$\{API_URL\}/.test(readFileSync(f, 'utf8')));
    expect(withApiUrl.length).toBeGreaterThan(3);
  });
});
