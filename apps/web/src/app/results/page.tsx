'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckSquare, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Plus } from 'lucide-react';
import { apiFetch, API_URL } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { RoleNotice } from '@/components/RoleNotice';

type Aggregate = {
  unitsReported: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  partyTotals: Record<string, number>;
};

type Summary = {
  totalPollingUnits: number;
  reportedPollingUnits: number;
  disputedSubmissions: number;
  flaggedSubmissions: number;
  verified: Aggregate;
  provisional: Aggregate;
  byLga: Array<{ lga: string; totalUnits: number; verified: Aggregate; provisional: Aggregate }>;
  note: string;
};

type ResultRow = {
  id: string;
  pollingUnitCode: string;
  lga: string;
  registrationArea: string;
  pollingUnitName: string;
  channel: string;
  accreditedVoters: number;
  votesByParty: Record<string, number>;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  status: 'PENDING_REVIEW' | 'VERIFIED' | 'DISPUTED' | 'SUPERSEDED';
  flags: string[];
  notes: string | null;
  createdAt: string;
};

export default function ResultsCollationPage() {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Submission form
  const [puCode, setPuCode] = useState('');
  const [accredited, setAccredited] = useState('');
  const [apc, setApc] = useState('');
  const [pdp, setPdp] = useState('');
  const [nnpp, setNnpp] = useState('');
  const [other, setOther] = useState('0');
  const [rejected, setRejected] = useState('0');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        apiFetch(`${API_URL}/api/situation-room/results/summary`),
        apiFetch(`${API_URL}/api/situation-room/results`),
      ]);
      if (sRes.ok) setSummary(await sRes.json());
      if (lRes.ok) setRows(await lRes.json());
    } catch (err: any) {
      toast.error(`Could not load EC8A collation data: ${err?.message || 'Error'}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submitEc8a = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pollingUnitCode: puCode,
          accreditedVoters: Number(accredited) || 0,
          votesByParty: {
            APC: Number(apc) || 0,
            PDP: Number(pdp) || 0,
            NNPP: Number(nnpp) || 0,
            OTHER: Number(other) || 0,
          },
          rejectedVotes: Number(rejected) || 0,
          channel: 'WEB',
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || 'Submission failed');
      toast.success(
        `Form EC8A submitted — PU ${body.pollingUnitCode} · Total ${body.totalVotesCast}${body.flags?.length ? ` · Flags: ${body.flags.join(', ')}` : ''}`,
      );
      setPuCode('');
      setAccredited('');
      setApc('');
      setPdp('');
      setNnpp('');
      setOther('0');
      setRejected('0');
      setNotes('');
      await load();
    } catch (err: any) {
      toast.error(`Submission error: ${err?.message || 'Error'}`);
    } finally {
      setSaving(false);
    }
  };

  const review = async (id: string, decision: 'VERIFIED' | 'DISPUTED') => {
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/results/${encodeURIComponent(id)}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || 'Review failed');
      toast.success(`Result marked ${decision} — PU ${body.pollingUnitCode}`);
      await load();
    } catch (err: any) {
      toast.error(`Review error: ${err?.message || 'Error'}`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-emerald-600" />
            Live Form EC8A Collation (Parallel Vote Tabulation)
          </h1>
          <p className="text-sm text-slate-500">
            Polling-unit vote aggregation with automatic over-voting &amp; arithmetic integrity checks. Verified and provisional totals are strictly separated.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <RoleNotice path="/results" />

      {summary && (
        <>
          <p className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
            {summary.note}
          </p>

          <section className="grid gap-4 md:grid-cols-2">
            {/* Verified totals */}
            <div className="rounded-lg border border-emerald-300 bg-white dark:bg-slate-900 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Verified EC8A Totals</span>
                <span className="text-xs text-slate-500">
                  {summary.verified.unitsReported.toLocaleString()} / {summary.totalPollingUnits.toLocaleString()} PUs
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <div className="text-xs text-slate-500">APC</div>
                  <div className="text-2xl font-bold text-emerald-700">{(summary.verified.partyTotals.APC ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">PDP</div>
                  <div className="text-2xl font-bold">{(summary.verified.partyTotals.PDP ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">NNPP / Other</div>
                  <div className="text-2xl font-bold">
                    {((summary.verified.partyTotals.NNPP ?? 0) + (summary.verified.partyTotals.OTHER ?? 0)).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* Provisional totals */}
            <div className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Provisional (Unverified Field Reports)</span>
                <span className="text-xs text-slate-500">
                  {summary.provisional.unitsReported.toLocaleString()} PUs · {summary.flaggedSubmissions} flagged
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <div className="text-xs text-slate-500">APC</div>
                  <div className="text-2xl font-bold text-amber-700">{(summary.provisional.partyTotals.APC ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">PDP</div>
                  <div className="text-2xl font-bold">{(summary.provisional.partyTotals.PDP ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">NNPP / Other</div>
                  <div className="text-2xl font-bold">
                    {((summary.provisional.partyTotals.NNPP ?? 0) + (summary.provisional.partyTotals.OTHER ?? 0)).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* EC8A Entry form */}
      <form onSubmit={submitEc8a} className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <Plus className="h-4 w-4" /> Enter Polling Unit Form EC8A
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input required value={puCode} onChange={(e) => setPuCode(e.target.value)} placeholder="PU Code (e.g. 15/01/01/001)" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input required type="number" min={0} value={accredited} onChange={(e) => setAccredited(e.target.value)} placeholder="Accredited Voters (BVAS)" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input required type="number" min={0} value={apc} onChange={(e) => setApc(e.target.value)} placeholder="APC Votes" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input required type="number" min={0} value={pdp} onChange={(e) => setPdp(e.target.value)} placeholder="PDP Votes" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input type="number" min={0} value={nnpp} onChange={(e) => setNnpp(e.target.value)} placeholder="NNPP Votes" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input type="number" min={0} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other Parties" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input type="number" min={0} value={rejected} onChange={(e) => setRejected(e.target.value)} placeholder="Rejected Ballots" className="rounded border px-3 py-2 text-sm bg-transparent" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Officer notes (optional)" className="rounded border px-3 py-2 text-sm bg-transparent" />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {saving ? 'Submitting…' : 'Submit EC8A for Verification'}
        </button>
      </form>

      {/* Verification Queue */}
      <section className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Verification Queue &amp; Recent Submissions ({rows.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left uppercase text-slate-500">
                <th className="py-2 pr-3">PU / LGA</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3 text-right">Accredited</th>
                <th className="py-2 pr-3 text-right">APC</th>
                <th className="py-2 pr-3 text-right">PDP</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3">Flags &amp; Status</th>
                <th className="py-2 text-right">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">
                    <div className="font-mono font-semibold">{r.pollingUnitCode}</div>
                    <div className="text-slate-500">{r.lga} · {r.registrationArea}</div>
                  </td>
                  <td className="py-2 pr-3">{r.channel}</td>
                  <td className="py-2 pr-3 text-right">{r.accreditedVoters}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-700">{r.votesByParty?.APC ?? 0}</td>
                  <td className="py-2 pr-3 text-right">{r.votesByParty?.PDP ?? 0}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{r.totalVotesCast}</td>
                  <td className="py-2 pr-3 space-y-1">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${
                      r.status === 'VERIFIED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : r.status === 'DISPUTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {r.status}
                    </span>
                    {r.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.flags.map((f) => (
                          <span key={f} className="inline-flex items-center gap-0.5 rounded bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 text-[10px]">
                            <AlertTriangle className="h-3 w-3" /> {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right space-x-1 whitespace-nowrap">
                    {r.status !== 'VERIFIED' && (
                      <button
                        onClick={() => review(r.id, 'VERIFIED')}
                        className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Verify
                      </button>
                    )}
                    {r.status !== 'DISPUTED' && (
                      <button
                        onClick={() => review(r.id, 'DISPUTED')}
                        className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Dispute
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No Form EC8A submissions yet. Enter one above or receive via 2G SMS (`RES &lt;PU&gt; ACC … APC …`).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 11-LGA breakdown */}
      {summary && (
        <section className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            11-LGA Collation Breakdown
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">LGA</th>
                  <th className="py-2 pr-3 text-right">Verified PUs</th>
                  <th className="py-2 pr-3 text-right">Verified APC</th>
                  <th className="py-2 pr-3 text-right">Verified PDP</th>
                  <th className="py-2 pr-3 text-right">Provisional PUs</th>
                  <th className="py-2 text-right">Provisional APC</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.byLga.map((g) => (
                  <tr key={g.lga}>
                    <td className="py-2 pr-3 font-medium">{g.lga}</td>
                    <td className="py-2 pr-3 text-right">{g.verified.unitsReported} / {g.totalUnits}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-emerald-700">{(g.verified.partyTotals.APC ?? 0).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{(g.verified.partyTotals.PDP ?? 0).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right text-amber-700">{g.provisional.unitsReported}</td>
                    <td className="py-2 text-right text-amber-700">{(g.provisional.partyTotals.APC ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
