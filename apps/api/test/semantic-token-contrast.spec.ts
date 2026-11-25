/**
 * The semantic design tokens are legible in BOTH themes.
 *
 * ── The bug this exists to catch ────────────────────────────────────────────
 *
 * The situation room drew its critical-incident rows with `bg-red-50` and
 * `bg-white` — fixed light surfaces — while the text colour came from the
 * theme. Rendered in dark mode, the ticket reference and the incident type on
 * every CRITICAL row measured 1.00:1: white (#f1f5f9) on pink (#fef2f2). Not
 * "low contrast" — the same colour. The severity chip still read CRITICAL, so
 * the screen looked populated while the two fields that say WHICH case and
 * WHAT HAPPENED were blank.
 *
 * An operations room runs with the lights down. Dark mode is the condition
 * this screen is used in, not a preference, so it is tested as a first-class
 * theme rather than assumed to follow.
 *
 * ── Why the existing palette test did not catch it ──────────────────────────
 *
 * `palette-contrast.spec.ts` asserts the BRAND ramp's roles. These tokens are
 * a different vocabulary — severity, verification, notice — introduced for the
 * election screens, and they carry the meaning that matters most here.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = join(__dirname, '..', '..', 'web', 'src', 'app', 'globals.css');

const srgb = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Read one theme's custom properties out of the stylesheet. */
function vars(theme: 'light' | 'dark'): Record<string, string> {
  const css = readFileSync(CSS, 'utf8');
  // `:root { … }` is light; `.dark { … }` is dark.
  const start = css.indexOf(theme === 'light' ? ':root {' : '.dark {');
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf('\n  }', start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const AA = 4.5;       // body text
const AA_LARGE = 3.0; // large text and graphical boundaries

describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
  const v = vars(theme);

  it('defines every semantic token', () => {
    const required = [
      'sev-critical', 'sev-high', 'sev-medium', 'sev-low',
    ].flatMap((s) => [`--${s}-bg`, `--${s}-fg`, `--${s}-edge`])
      .concat(['--verify-verified', '--verify-corroborated', '--verify-unverified', '--verify-disputed', '--verify-false'])
      .concat(['--notice-bg', '--notice-fg', '--notice-edge', '--panel-alert-bg', '--panel-alert-edge', '--panel-alert-fg', '--panel-alert-muted'])
      .concat(['--figure-critical', '--figure-warn', '--figure-good']);
    expect(required.filter((k) => !v[k])).toEqual([]);
  });

  it.each(['critical', 'high', 'medium', 'low'])('severity %s reads on its own fill', (sev) => {
    expect(ratio(v[`--sev-${sev}-fg`], v[`--sev-${sev}-bg`])).toBeGreaterThanOrEqual(AA);
  });

  it.each(['critical', 'high', 'medium', 'low'])('severity %s edge is visible against the page', (sev) => {
    // The spine down a row is a graphical object: 3:1, not 4.5:1.
    expect(ratio(v[`--sev-${sev}-edge`], v['--bg-card'])).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(['verified', 'corroborated', 'unverified', 'disputed', 'false'])(
    'verification "%s" reads on the card surface', (state) => {
      expect(ratio(v[`--verify-${state}`], v['--bg-card'])).toBeGreaterThanOrEqual(AA);
    });

  it('verification also reads inside an alert panel', () => {
    // Incident rows sit on --panel-alert-bg, not on the plain card. This is
    // the exact pairing that measured 1.00:1 before.
    for (const state of ['verified', 'corroborated', 'unverified', 'disputed', 'false']) {
      const r = ratio(v[`--verify-${state}`], v['--panel-alert-bg']);
      expect({ state, ratio: Number(r.toFixed(2)) }).toEqual({ state, ratio: expect.any(Number) });
      expect(r).toBeGreaterThanOrEqual(AA);
    }
  });

  it('body and muted text read on every surface a row can sit on', () => {
    for (const surface of ['--bg-card', '--bg-main', '--bg-subtle', '--panel-alert-bg', '--notice-bg']) {
      expect(ratio(v['--text-main'], v[surface])).toBeGreaterThanOrEqual(AA);
    }
    // Muted text is still text: it carries counts and timestamps.
    for (const surface of ['--bg-card', '--bg-main']) {
      expect(ratio(v['--text-muted'], v[surface])).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(['critical', 'warn', 'good'])('the %s figure colour reads AS TEXT, not as a rule', (role) => {
    // An `edge` token clears 3:1 because it is a 3px line. The first draft of
    // these screens used the edge hex for the headline figure itself, and the
    // coverage percentage — the number that says how much of the State this
    // screen can speak for — rendered at 3.19:1. A colour that is legible as
    // a border is not automatically legible as a numeral.
    for (const surface of ['--bg-card', '--bg-main']) {
      expect(ratio(v[`--figure-${role}`], v[surface])).toBeGreaterThanOrEqual(AA);
    }
  });

  it('muted text inside the alert panel is still readable', () => {
    // The incident rows put the polling unit, the clock and the corroboration
    // count in the muted role, ON the alert surface. The page-level muted
    // colour measures 4.35:1 there — under the line, on the one panel whose
    // rows are worked against a five-minute target.
    expect(ratio(v['--panel-alert-muted'], v['--panel-alert-bg'])).toBeGreaterThanOrEqual(AA);
  });

  it('the notice keeps its caveats legible', () => {
    expect(ratio(v['--notice-fg'], v['--notice-bg'])).toBeGreaterThanOrEqual(AA);
  });

  it('the alert panel heading reads on the alert panel', () => {
    expect(ratio(v['--panel-alert-fg'], v['--panel-alert-bg'])).toBeGreaterThanOrEqual(AA);
  });
});
