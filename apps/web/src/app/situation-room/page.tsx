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
    lga: string | null; pollingUnitCode: string | null; dueAt: string | null;
    corroborations: number; accreditedCorroborations: number;
  }>;
};

type Coalition = {
  inCoalition: boolean;
  note: string;
  coalitions?: Array<{ id: string; name: string }>;
  sharingOrganisations?: string[];
  incidents: Array<{
    ticketNumber: string; incidentType: string | null; severity: string | null;
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

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
  HIGH: 'bg-orange-100 text-orange-800 border-orange-200',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200',
  LOW: 'bg-slate-100 text-slate-700 border-slate-200',
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
    return <div className="p-8 text-slate-500">Loading the situation room…</div>;
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

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Radio className="h-6 w-6 text-red-600" /> Situation room
          </h1>
          <p className="text-sm text-slate-500">
            Since {new Date(o.since).toLocaleString()} · refreshed {new Date(o.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* ── Coverage, first, because a map without it misleads ── */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <EyeOff className="h-4 w-4" /> Coverage
        </h2>
        {o.coverage.unitsInRegister === 0 ? (
          <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-900">{o.coverage.note}</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Units in the register" value={o.coverage.unitsInRegister} />
              <Stat label="Units heard from" value={o.coverage.unitsReporting} />
              <Stat label="Units silent" value={o.coverage.unitsSilent} tone="warn" />
              <Stat label="Heard from" value={`${coveragePct}%`} />
            </div>
            <p className="mt-3 text-xs text-slate-500">{o.coverage.note}</p>
          </>
        )}
      </section>

      {/* ── Confidence, stated separately and never summed ── */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Confidence
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Verified" value={o.confidence.verified} tone="good" />
          <Stat label="Corroborated" value={o.confidence.corroborated} />
          <Stat label="Unverified" value={o.confidence.unverified} />
          <Stat label="Disputed" value={o.confidence.disputed} tone="warn" />
          <Stat label="Shown false" value={o.confidence.false} />
        </div>
        <p className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-600">
          <strong>{o.confidence.note}</strong>{' '}
          {o.confidence.corroboratedByAccredited} incident(s) have two or more accredited reporters, which is a
          stronger signal than the same number of anonymous tips.
        </p>
      </section>

      {/* ── What needs somebody now ── */}
      {o.needsAttention.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Needs attention now ({o.needsAttention.length})
          </h2>
          <ul className="mt-3 divide-y divide-red-100">
            {o.needsAttention.map((n) => (
              <li key={n.ticketNumber} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className={`rounded border px-2 py-0.5 text-xs ${SEVERITY_STYLE[n.severity ?? 'LOW']}`}>
                  {n.severity ?? '—'}
                </span>
                <span className="font-mono text-xs">{n.ticketNumber}</span>
                <span className="font-medium">{n.incidentType ?? 'unclassified'}</span>
                <span className="text-slate-600">
                  {n.pollingUnitCode ?? 'no unit'} · {n.lga ?? 'no LGA'}
                </span>
                <span className="text-xs text-red-700">{n.why}</span>
                {n.dueAt && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="h-3 w-3" /> due {new Date(n.dueAt).toLocaleTimeString()}
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {n.corroborations} report(s), {n.accreditedCorroborations} accredited
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Per LGA, with denominators ── */}
      <section className="rounded-lg border bg-white p-4 overflow-x-auto">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">By Local Government Area</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
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
                <td className={r.critical ? 'font-semibold text-red-700' : ''}>{r.critical}</td>
                <td className="text-slate-600">
                  {r.unitsReporting} / {r.units || '—'}
                </td>
                <td>{r.verified}</td>
                <td>{r.corroborated}</td>
                <td className="text-slate-600">{r.accreditedReports}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Silence, as a list of places to telephone ── */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Registration Areas with nothing reported
        </h2>
        {!silent?.registerLoaded ? (
          <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-900">{silent?.note}</p>
        ) : silent.areas.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Every Registration Area has reported something.</p>
        ) : (
          <>
            <p className="mt-2 text-xs text-slate-500">{silent.note}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {silent.areas.slice(0, 60).map((a) => (
                <li
                  key={`${a.lga}|${a.registrationArea}`}
                  className={`rounded border p-2 text-sm ${a.observersDeployed ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
                >
                  <div className="font-medium">{a.registrationArea}</div>
                  <div className="text-xs text-slate-600">
                    {a.lga} · {a.unitsInArea} unit(s)
                  </div>
                  {a.observersDeployed && (
                    <div className="mt-1 text-xs font-medium text-amber-800">
                      Observers deployed — worth a call
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {silent.areas.length > 60 && (
              <p className="mt-2 text-xs text-slate-500">…and {silent.areas.length - 60} more.</p>
            )}
          </>
        )}
      </section>

      {/* ── The dots, last ── */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Located incidents ({o.points.length})
        </h2>
        {o.points.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No incident carries coordinates yet. Coordinates arrive when a reporter shares their location on
            WhatsApp; the polling unit register deliberately carries none, because a guessed coordinate is
            worse than none when its job is to check whether a reporter was where they said they were.
          </p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {o.points.slice(0, 40).map((p) => (
              <li key={p.ticketNumber} className="flex flex-wrap items-center gap-3 py-2">
                <span className={`rounded border px-2 py-0.5 text-xs ${SEVERITY_STYLE[p.severity]}`}>{p.severity}</span>
                <span className="font-medium">{p.label}</span>
                <span className="text-slate-600">{p.pollingUnitCode ?? 'no unit'} · {p.lga}</span>
                <a
                  className="text-xs text-blue-700 underline"
                  href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=16/${p.latitude}/${p.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                </a>
                <span className="text-xs text-slate-500">{p.verification}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The coalition pool ── */}
      {coalition?.inCoalition && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
            <Users className="h-4 w-4" /> Coalition pool
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Sharing with {coalition.sharingOrganisations?.join(', ') || 'no other organisation yet'}.{' '}
            {coalition.note}
          </p>
          <ul className="mt-3 divide-y text-sm">
            {coalition.incidents.slice(0, 40).map((i) => (
              <li key={`${i.reportedByOrganisation}-${i.ticketNumber}`} className="flex flex-wrap items-center gap-3 py-2">
                <span className={`rounded border px-2 py-0.5 text-xs ${SEVERITY_STYLE[i.severity ?? 'LOW']}`}>
                  {i.severity ?? '—'}
                </span>
                <span className="font-medium">{i.incidentType}</span>
                <span className="text-slate-600">{i.pollingUnitCode ?? 'no unit'} · {i.lga}</span>
                <span className="text-xs text-slate-500">{i.verification}</span>
                <span className={`text-xs ${i.mine ? 'text-slate-500' : 'font-medium text-indigo-700'}`}>
                  {i.mine ? 'ours' : i.reportedByOrganisation}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Petition bundles ── */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <Download className="h-4 w-4" /> Petition bundles
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          A bundle is per polling unit, carries the SHA-256 of every evidence file, states each claim's
          verification status, and <strong>stops the retention job deleting that unit's evidence</strong>.
          OWNER and ADMIN only.
        </p>
        {petitionUnits === null ? (
          <p className="mt-3 text-sm text-slate-500">
            Only OWNER and ADMIN can list or export bundles.
          </p>
        ) : petitionUnits.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No polling unit has an incident on record yet.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {petitionUnits.map((u) => (
              <li key={u.pollingUnitCode} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono text-xs">{u.pollingUnitCode}</span>{' '}
                  <span className="text-slate-600">
                    {u.registrationArea ? `${u.registrationArea}, ` : ''}{u.lga}
                  </span>{' '}
                  <span className="text-xs text-slate-500">· {u.incidents} incident(s)</span>
                </span>
                <button
                  onClick={() => void exportBundle(u.pollingUnitCode!)}
                  disabled={exporting === u.pollingUnitCode}
                  className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
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

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'good' | 'warn' }) {
  const colour = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div>
      <div className={`text-2xl font-semibold ${colour}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
