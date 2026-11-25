'use client';

/**
 * The situation room's screen on election day.
 *
 * ── The number this screen exists to put first ──────────────────────────────
 *
 * A map of incidents shows where reports CAME FROM. It does not show what is
 * happening, and conflating the two is the commonest way election observation
 * misleads. Three incidents in Akko and three in Nafada look identical as dots;
 * Akko has 468 polling units and Nafada 131, so they are not comparable
 * numbers. Worse, an area that has reported NOTHING is invisible on a map —
 * and whether that means a quiet ward or a ward nobody is covering is the most
 * important thing in the room.
 *
 * So coverage comes first, confidence second, and the dots last.
 *
 * ── And the distinction it refuses to blur ──────────────────────────────────
 *
 * CORROBORATED is not VERIFIED. Independent reports agreeing is not the same as
 * somebody having checked, and a briefing that reads one as the other is one
 * coordinated campaign away from being wrong in public. The two are never
 * shown in the same colour or added into one total.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, RefreshCw, MapPin, EyeOff, ShieldCheck, ShieldAlert,
  Clock, Download, Radio, Users,
} from 'lucide-react';
import { apiFetch, API_URL } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import EmptyState from '@/components/ui/EmptyState';
import { RoleNotice } from '@/components/RoleNotice';
import {
  Card, Panel, Figure, SeverityTag, VerificationTag, Since, Notice, severitySpine,
} from '@/components/ui/primitives';

type Overview = {
  since: string;
  generatedAt: string;
  incidents: {
    total: number;
    bySeverity: Record<string, number>;
    byType: Array<{ id: string; label: string; group: string; count: number }>;
    unclassified: number;
    overdue: number;
  };
  coverage: {
    unitsInRegister: number;
    unitsReporting: number;
    unitsSilent: number;
    note: string;
  };
  confidence: {
    verified: number; corroborated: number; unverified: number;
    disputed: number; false: number; corroboratedByAccredited: number;
    note: string;
  };
  byLga: Array<{
    lga: string; incidents: number; units: number; unitsReporting: number;
    critical: number; verified: number; corroborated: number; unverified: number;
    accreditedReports: number; publicReports: number;
  }>;
  points: Array<{
    ticketNumber: string; label: string; severity: string; verification: string;
    lga: string | null; pollingUnitCode: string | null;
    latitude: number; longitude: number; at: string;
  }>;
  needsAttention: Array<{
    ticketNumber: string; why: string; incidentType: string | null; severity: string | null;
    incidentLabel: string;
    lga: string | null; pollingUnitCode: string | null; dueAt: string | null;
    reportedAt: string; overdueByMinutes: number | null;
    corroborations: number; accreditedCorroborations: number;
  }>;
};

type Coalition = {
  inCoalition: boolean;
  note: string;
  coalitions?: Array<{ id: string; name: string }>;
  sharingOrganisations?: string[];
  incidents: Array<{
    ticketNumber: string; incidentType: string | null; incidentLabel: string; severity: string | null;
    verification: string; lga: string | null; pollingUnitCode: string | null;
    mine: boolean; reportedByOrganisation: string; createdAt: string;
  }>;
};

type PetitionUnit = {
  pollingUnitCode: string | null;
  lga: string | null;
  registrationArea: string | null;
  incidents: number;
};

type Silent = {
  registerLoaded: boolean;
  note: string;
  unitsHeardFrom?: number;
  areas: Array<{
    lga: string; registrationArea: string; unitsInArea: number;
    observersDeployed: boolean;
  }>;
};

export default function SituationRoomPage() {
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [silent, setSilent] = useState<Silent | null>(null);
  const [petitionUnits, setPetitionUnits] = useState<PetitionUnit[] | null>(null);
  const [coalition, setCoalition] = useState<Coalition | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s, u, c] = await Promise.all([
        apiFetch(`${API_URL}/api/situation-room/overview`),
        apiFetch(`${API_URL}/api/situation-room/silent`),
        // Every unit with something that could be filed, not just the ones
        // overdue: a lawyer deciding where to petition wants all of them.
        // 403 for a non-admin is expected and left silent.
        apiFetch(`${API_URL}/api/situation-room/petition/units`),
        apiFetch(`${API_URL}/api/situation-room/coalition`),
      ]);
      if (o.ok) setOverview(await o.json());
      else toast.error(`Could not load the overview — the server answered ${o.status}.`);
      if (s.ok) setSilent(await s.json());
      setPetitionUnits(u.ok ? await u.json() : null);
      setCoalition(c.ok ? await c.json() : null);
    } catch (err: any) {
      toast.error(`Could not reach the server — ${String(err?.message ?? err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    // Election day moves in minutes. Thirty seconds is often enough to see a
    // spike start; it is deliberately not one second, because a screen that
    // redraws constantly is a screen nobody can read a number off.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const exportBundle = async (code: string) => {
    setExporting(code);
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/petition/unit/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: `Exported from the situation room screen on ${new Date().toISOString()}` }),
      });
      if (!res.ok) {
        toast.error(`Export refused — the server answered ${res.status}.`);
        return;
      }
      const bundle = await res.json();
      // Downloaded rather than shown: it is a filing document, and it carries
      // the evidence hashes somebody has to keep.
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `petition-bundle-${code.replace(/\//g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Bundle exported — ${bundle.summary.incidents} incident(s), ${bundle.summary.evidenceFiles} evidence file(s). ` +
          'Deletion is now held for this unit.',
      );
    } finally {
      setExporting(null);
    }
  };

  if (loading && !overview) {
    return <div className="p-8 text-[var(--text-muted)]">Loading the situation room…</div>;
  }
  if (!overview) {
    return <EmptyState icon={Radio} title="Nothing to show yet" description="No incidents have been reported in this window." />;
  }

  const o = overview;
  const coveragePct = o.coverage.unitsInRegister
    ? Math.round((o.coverage.unitsReporting / o.coverage.unitsInRegister) * 100)
    : null;

  return (
    <div className="p-6 space-y-6">
      <RoleNotice path="/situation-room" />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-[var(--text-main)]">
            <Radio aria-hidden className="h-5 w-5 shrink-0 text-[var(--sev-critical-edge)]" />
            Situation room
          </h1>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Window opened <Since at={o.since} />, refreshed <Since at={o.generatedAt} />
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text-main)] hover:bg-[var(--bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sev-critical-edge)]"
        >
          <RefreshCw aria-hidden className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* ── Coverage, first, because a map without it misleads ── */}
      <Panel title="Coverage" icon={<EyeOff aria-hidden className="h-4 w-4 text-[var(--text-muted)]" />}>
        <div className="px-4 pb-4">
          {o.coverage.unitsInRegister === 0 ? (
            <Notice>{o.coverage.note}</Notice>
          ) : (
            <>
              {/* The percentage leads. It is the number that says how much of
                  the State this screen can speak for, and it used to be
                  rendered last and smallest, in the same weight as the rest. */}
              <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
                <Figure
                  value={`${coveragePct}%`}
                  label="of polling units heard from"
                  caption={`${o.coverage.unitsReporting.toLocaleString()} of ${o.coverage.unitsInRegister.toLocaleString()} in the register`}
                  emphasis="lead"
                  tone={coveragePct !== null && coveragePct < 25 ? 'warn' : undefined}
                />
                <Figure value={o.coverage.unitsSilent.toLocaleString()} label="units silent" emphasis="quiet" tone="warn" />
              </div>
              <div className="mt-4"><Notice>{o.coverage.note}</Notice></div>
            </>
          )}
        </div>
      </Panel>

      {/* ── Confidence, stated separately and never summed ── */}
      <Panel title="Confidence" icon={<ShieldCheck aria-hidden className="h-4 w-4 text-[var(--text-muted)]" />}>
        <div className="px-4 pb-4">
          {/* Each state keeps its own verification colour, so the word and the
              colour agree here and on every incident row. They are never
              summed: the sum would read as a single level of certainty. */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
            {([
              ['VERIFIED', 'Verified', o.confidence.verified],
              ['CORROBORATED', 'Corroborated', o.confidence.corroborated],
              ['UNVERIFIED', 'Unverified', o.confidence.unverified],
              ['DISPUTED', 'Disputed', o.confidence.disputed],
              ['FALSE_REPORT', 'Shown false', o.confidence.false],
            ] as const).map(([state, label, n]) => (
              <div key={state}>
                <dd className="text-2xl font-semibold tabular-nums leading-none" style={{ color: `var(--verify-${state === 'FALSE_REPORT' ? 'false' : state.toLowerCase()})` }}>
                  {n}
                </dd>
                <dt className="mt-1.5"><VerificationTag state={state} /></dt>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <Notice>
              <strong>{o.confidence.note}</strong>{' '}
              {o.confidence.corroboratedByAccredited === 1
                ? '1 incident has'
                : `${o.confidence.corroboratedByAccredited} incidents have`}{' '}
              two or more accredited reporters, which is a stronger signal than the same number of anonymous tips.
            </Notice>
          </div>
        </div>
      </Panel>

      {/* ── What needs somebody now ── */}
      {o.needsAttention.length > 0 && (
        <Panel
          title="Needs attention now"
          count={o.needsAttention.length}
          tone="alert"
          icon={<AlertTriangle aria-hidden className="h-4 w-4 text-[var(--panel-alert-fg)]" />}
        >
          {/* Worst first — the order comes from the server, which sorts by
              severity, then by how long it has been overdue. */}
          <ul className="divide-y divide-[var(--panel-alert-edge)]">
            {o.needsAttention.map((n) => (
              <li
                key={n.ticketNumber}
                style={severitySpine(n.severity)}
                className="flex flex-col gap-1.5 py-2.5 pl-3 pr-4 sm:flex-row sm:items-baseline sm:gap-3"
              >
                {/* Line one: what happened, and how bad. Everything an officer
                    needs to decide whether to read line two. */}
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <SeverityTag severity={n.severity} />
                  <span className="font-medium text-[var(--text-main)]">{n.incidentLabel}</span>
                  <span className="text-sm text-[var(--panel-alert-muted)]">
                    {n.pollingUnitCode ?? 'unit not given'} · {n.lga ?? 'LGA not given'}
                  </span>
                </div>

                {/* Line two: the clock, which is what makes this list urgent,
                    and the reference, which is the least useful field for
                    triage and so goes last rather than second. */}
                <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                  {n.overdueByMinutes !== null ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--sev-critical-edge)]">
                      <Clock aria-hidden className="h-3 w-3" />
                      {n.overdueByMinutes < 60
                        ? `${n.overdueByMinutes} min overdue`
                        : `${Math.floor(n.overdueByMinutes / 60)}h ${n.overdueByMinutes % 60}m overdue`}
                    </span>
                  ) : n.why !== 'critical' ? (
                    // `why` is "critical" | "overdue" | "not classified".
                    // "critical" restates the chip two inches to the left, so
                    // the row said CRITICAL … critical. Only the reason that
                    // ADDS something is worth the width.
                    <span className="text-[var(--panel-alert-muted)]">{n.why}</span>
                  ) : null}
                  <Since at={n.reportedAt} className="!text-[var(--panel-alert-muted)]" />
                  <span className="text-[var(--panel-alert-muted)]">
                    {/* "reports" meant corroborations and read as though the
                        incident itself had not been reported. */}
                    {n.corroborations === 0
                      ? 'no corroboration yet'
                      : `${n.corroborations} corroborating ${n.corroborations === 1 ? 'report' : 'reports'}`}
                    {n.accreditedCorroborations > 0 && `, ${n.accreditedCorroborations} accredited`}
                  </span>
                  <span className="font-mono text-[var(--panel-alert-muted)]">{n.ticketNumber}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ── Per LGA, with denominators ── */}
      <section className="overflow-x-auto rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">By Local Government Area</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-[var(--text-muted)]">
            <tr>
              <th className="py-2">LGA</th>
              <th>Incidents</th>
              <th>Critical</th>
              <th>Units heard / total</th>
              <th>Verified</th>
              <th>Corroborated</th>
              <th>Accredited reports</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {o.byLga.map((r) => (
              <tr key={r.lga}>
                <td className="py-2 font-medium">{r.lga}</td>
                <td>{r.incidents}</td>
                <td className={r.critical ? 'font-semibold text-[var(--figure-critical)]' : ''}>{r.critical}</td>
                <td className="text-[var(--text-muted)]">
                  {r.unitsReporting} / {r.units || '—'}
                </td>
                <td>{r.verified}</td>
                <td>{r.corroborated}</td>
                <td className="text-[var(--text-muted)]">{r.accreditedReports}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Silence, as a list of places to telephone ── */}
      <section className="rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Registration Areas with nothing reported
        </h2>
        {!silent?.registerLoaded ? (
          <div className="mt-2"><Notice>{silent?.note}</Notice></div>
        ) : silent.areas.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Every Registration Area has reported something.</p>
        ) : (
          <>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{silent.note}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {silent.areas.slice(0, 60).map((a) => (
                <li
                  key={`${a.lga}|${a.registrationArea}`}
                  className={`rounded-lg border p-2 text-sm ${a.observersDeployed ? 'border-[var(--notice-edge)] bg-[var(--notice-bg)] text-[var(--notice-fg)]' : 'border-[var(--border-main)] text-[var(--text-main)]'}`}
                >
                  <div className="font-medium">{a.registrationArea}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {a.lga} · {a.unitsInArea} unit(s)
                  </div>
                  {a.observersDeployed && (
                    <div className="mt-1 text-xs font-medium">
                      Observers deployed — worth a call
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {silent.areas.length > 60 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">…and {silent.areas.length - 60} more.</p>
            )}
          </>
        )}
      </section>

      {/* ── The dots, last ── */}
      <section className="rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Located incidents ({o.points.length})
        </h2>
        {o.points.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            No incident carries coordinates yet. Coordinates arrive when a reporter shares their location on
            WhatsApp; the polling unit register deliberately carries none, because a guessed coordinate is
            worse than none when its job is to check whether a reporter was where they said they were.
          </p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {o.points.slice(0, 40).map((p) => (
              <li key={p.ticketNumber} className="flex flex-wrap items-center gap-3 py-2">
                <SeverityTag severity={p.severity} />
                <span className="font-medium">{p.label}</span>
                <span className="text-[var(--text-muted)]">{p.pollingUnitCode ?? 'no unit'} · {p.lga}</span>
                <a
                  className="text-xs text-[var(--verify-corroborated)] underline"
                  href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=16/${p.latitude}/${p.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                </a>
                <VerificationTag state={p.verification} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The coalition pool ── */}
      {coalition?.inCoalition && (
        <section className="rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-2">
            <Users className="h-4 w-4" /> Coalition pool
          </h2>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Sharing with {coalition.sharingOrganisations?.join(', ') || 'no other organisation yet'}.{' '}
            {coalition.note}
          </p>
          <ul className="mt-3 divide-y text-sm">
            {coalition.incidents.slice(0, 40).map((i) => (
              <li key={`${i.reportedByOrganisation}-${i.ticketNumber}`} className="flex flex-wrap items-center gap-3 py-2">
                <SeverityTag severity={i.severity} />
                <span className="font-medium text-[var(--text-main)]">{i.incidentLabel}</span>
                <span className="text-[var(--text-muted)]">{i.pollingUnitCode ?? 'no unit'} · {i.lga}</span>
                <VerificationTag state={i.verification} />
                <span className={`text-xs ${i.mine ? 'text-[var(--text-muted)]' : 'font-medium text-[var(--verify-corroborated)]'}`}>
                  {i.mine ? 'ours' : i.reportedByOrganisation}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Petition bundles ── */}
      <section className="rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-2">
          <Download className="h-4 w-4" /> Petition bundles
        </h2>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          A bundle is per polling unit, carries the SHA-256 of every evidence file, states each claim's
          verification status, and <strong>stops the retention job deleting that unit's evidence</strong>.
          OWNER and ADMIN only.
        </p>
        {petitionUnits === null ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Only OWNER and ADMIN can list or export bundles.
          </p>
        ) : petitionUnits.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">No polling unit has an incident on record yet.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {petitionUnits.map((u) => (
              <li key={u.pollingUnitCode} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono text-xs">{u.pollingUnitCode}</span>{' '}
                  <span className="text-[var(--text-muted)]">
                    {u.registrationArea ? `${u.registrationArea}, ` : ''}{u.lga}
                  </span>{' '}
                  <span className="text-xs text-[var(--text-muted)]">· {u.incidents} incident(s)</span>
                </span>
                <button
                  onClick={() => void exportBundle(u.pollingUnitCode!)}
                  disabled={exporting === u.pollingUnitCode}
                  className="rounded border px-3 py-1 text-xs hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                >
                  {exporting === u.pollingUnitCode ? 'Exporting…' : 'Export bundle'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

