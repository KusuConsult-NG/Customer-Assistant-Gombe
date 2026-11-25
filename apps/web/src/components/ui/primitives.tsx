/**
 * The shared vocabulary both election screens are built from.
 *
 * ── Why these exist ─────────────────────────────────────────────────────────
 *
 * The dashboard and the situation room were written independently and looked
 * it: four identical stat tiles that gave a vanity count the same weight as
 * the number of open cases, severity drawn with hardcoded `bg-red-100`, a
 * verification state drawn with the SAME chip as a severity, and surfaces
 * fixed to light while text followed the theme (which is how a critical row
 * came to render white-on-pink in dark mode).
 *
 * So the rules live here instead of being retyped per screen:
 *
 *   - Every surface uses the theme's custom properties. No `bg-white`.
 *   - Severity is a filled chip plus a spine. Verification is text and a
 *     mark. They are different devices ON PURPOSE: the data model keeps the
 *     two axes orthogonal, and a UI that draws them identically is how an
 *     unverified rumour comes to read as a confirmed emergency.
 *   - Colour never carries meaning alone. Every state is also written out.
 *   - Figures are tabular, so a column of numbers can be compared down.
 *
 * Contrast for every token here is asserted in
 * apps/api/test/semantic-token-contrast.spec.ts, in BOTH themes.
 */
import React from 'react';

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export function Card({ children, className = '', as: Tag = 'div' }: {
  children: React.ReactNode; className?: string; as?: any;
}) {
  return (
    <Tag className={`rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * A titled region. `tone="alert"` is reserved for things a person must act
 * on now — it is not for emphasis, because a screen where several regions
 * shout has no way left to shout.
 */
export function Panel({ title, count, tone = 'plain', action, children, icon }: {
  title: string; count?: number; tone?: 'plain' | 'alert';
  action?: React.ReactNode; children: React.ReactNode; icon?: React.ReactNode;
}) {
  const alert = tone === 'alert';
  return (
    <section
      className={`rounded-xl border ${alert
        ? 'border-[var(--panel-alert-edge)] bg-[var(--panel-alert-bg)]'
        : 'border-[var(--border-main)] bg-[var(--bg-card)]'}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        {icon}
        <h2 className={`text-[13px] font-semibold uppercase tracking-wider ${alert ? 'text-[var(--panel-alert-fg)]' : 'text-[var(--text-muted)]'}`}>
          {title}
        </h2>
        {typeof count === 'number' && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${alert
            ? 'bg-[var(--sev-critical-bg)] text-[var(--sev-critical-fg)]'
            : 'bg-[var(--bg-subtle)] text-[var(--text-main)]'}`}>
            {count}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/* ── Figures ──────────────────────────────────────────────────────────────── */

/**
 * `null` is NOT KNOWN and renders "—". It is never 0: a dashboard that prints
 * "0 open cases" when the request failed has told the officer the agency is
 * quiet, which is the one thing it must never say by accident.
 */
export function Figure({ value, label, caption, emphasis = 'normal', tone }: {
  value: number | string | null;
  label: string;
  caption?: string;
  emphasis?: 'lead' | 'normal' | 'quiet';
  tone?: 'critical' | 'warn' | 'good';
}) {
  const size = emphasis === 'lead' ? 'text-4xl sm:text-5xl' : emphasis === 'quiet' ? 'text-xl' : 'text-2xl sm:text-3xl';
  // Text-grade accents, not the `edge` rule colours: see --figure-* in
  // globals.css and the test that measures them as text.
  const colour = tone === 'critical'
    ? 'text-[var(--figure-critical)]'
    : tone === 'warn'
      ? 'text-[var(--figure-warn)]'
      : tone === 'good'
        ? 'text-[var(--figure-good)]'
        : 'text-[var(--text-main)]';
  return (
    <div>
      <div className={`font-semibold tabular-nums leading-none ${size} ${value === null ? 'text-[var(--text-muted)]' : colour}`}>
        {value === null ? '—' : value}
      </div>
      <div className="mt-1.5 text-sm text-[var(--text-main)]">{label}</div>
      {caption && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{caption}</div>}
    </div>
  );
}

/* ── Severity: how bad ────────────────────────────────────────────────────── */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
const SEV = (s?: string | null): Severity =>
  (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(s)) ? s : 'LOW') as Severity;
const sevVar = (s: Severity, part: 'bg' | 'fg' | 'edge') => `var(--sev-${s.toLowerCase()}-${part})`;

export function SeverityTag({ severity }: { severity?: string | null }) {
  const s = SEV(severity);
  return (
    <span
      className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
      style={{ background: sevVar(s, 'bg'), color: sevVar(s, 'fg') }}
    >
      {s}
    </span>
  );
}

/** The spine down the left of a row. Redundant with the tag, on purpose. */
export const severitySpine = (severity?: string | null): React.CSSProperties => ({
  borderLeft: `3px solid ${sevVar(SEV(severity), 'edge')}`,
});

/* ── Verification: whether anyone checked ─────────────────────────────────── */

const VERIFY: Record<string, { label: string; v: string; hint: string }> = {
  VERIFIED: { label: 'Verified', v: 'var(--verify-verified)', hint: 'A person reviewed the evidence.' },
  CORROBORATED: { label: 'Corroborated', v: 'var(--verify-corroborated)', hint: 'Independent reports agreed. Nobody has checked.' },
  UNVERIFIED: { label: 'Unverified', v: 'var(--verify-unverified)', hint: 'One report. Nobody has checked.' },
  DISPUTED: { label: 'Disputed', v: 'var(--verify-disputed)', hint: 'Accounts conflict.' },
  FALSE_REPORT: { label: 'Shown false', v: 'var(--verify-false)', hint: 'Checked and found untrue.' },
};

/**
 * Text and a mark, never a fill — see the note at the top of this file on why
 * this must not look like a severity.
 */
export function VerificationTag({ state }: { state?: string | null }) {
  const v = VERIFY[String(state)] ?? VERIFY.UNVERIFIED;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium" style={{ color: v.v }} title={v.hint}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: v.v }} />
      {v.label}
    </span>
  );
}

/* ── Time ─────────────────────────────────────────────────────────────────── */

/**
 * "14 min ago", not "11/24/2026, 10:47:22 PM".
 *
 * The rows on this screen are worked against a response target measured in
 * minutes, and a reader cannot subtract a wall-clock timestamp at a glance.
 * The absolute time stays in the tooltip for the record. The locale is
 * en-GB because this is deployed in Nigeria, where 11/12 means 11 December.
 */
export function Since({ at, className = '' }: { at?: string | null; className?: string }) {
  if (!at) return <span className={`text-[var(--text-muted)] ${className}`}>—</span>;
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return <span className={`text-[var(--text-muted)] ${className}`}>—</span>;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  const text = mins < 1 ? 'just now'
    : mins < 60 ? `${mins} min ago`
    : mins < 60 * 24 ? `${Math.floor(mins / 60)}h ${mins % 60}m ago`
    : `${Math.floor(mins / 1440)}d ago`;
  return (
    <time dateTime={at} title={new Date(at).toLocaleString('en-GB')} className={`tabular-nums text-[var(--text-muted)] ${className}`}>
      {text}
    </time>
  );
}

/* ── Notice ───────────────────────────────────────────────────────────────── */

/** The caveats. Styled to be read, not to be skipped. */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border-l-4 border-[var(--notice-edge)] bg-[var(--notice-bg)] px-3 py-2 text-[13px] leading-relaxed text-[var(--notice-fg)]">
      {children}
    </p>
  );
}
