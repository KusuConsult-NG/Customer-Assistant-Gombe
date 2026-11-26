'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch, API_URL } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { RoleNotice } from '@/components/RoleNotice';

type LgaRow = {
  lga: string;
  totalUnits: number;
  assignedAgents: number;
  checkedIn: number;
  materialsArrived: number;
  bvasFailed: number;
  votingStarted: number;
  countingCompleted: number;
  ec8aSubmitted: number;
  irevUploaded: number;
};

type UnitDetail = {
  code: string;
  name: string;
  lga: string;
  registrationArea: string;
  assignedAgent: { fullName: string; phoneNumber: string; code: string } | null;
  status: {
    agentCheckedInAt: string | null;
    materialsArrivedAt: string | null;
    bvasWorking: boolean | null;
    votingStartedAt: string | null;
    countingCompletedAt: string | null;
    ec8aSubmittedAt: string | null;
    irevUploadedAt: string | null;
    accreditedVotersCount: number | null;
  } | null;
};

type MatrixResponse = {
  totals: Omit<LgaRow, 'lga'>;
  byLga: LgaRow[];
  units: UnitDetail[];
};

const MILESTONES = [
  'AGENT_ARRIVED',
  'MATERIALS_ARRIVED',
  'VOTING_STARTED',
  'VOTING_CLOSED',
  'COUNTING_COMPLETED',
  'EC8A_SUBMITTED',
  'IREV_UPLOADED',
] as const;

export default function PollingUnitsPage() {
  const toast = useToast();
  const [selectedLga, setSelectedLga] = useState<string>('');
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Quick check-in form
  const [puCode, setPuCode] = useState('');
  const [milestone, setMilestone] = useState<(typeof MILESTONES)[number]>('AGENT_ARRIVED');
  const [bvasWorking, setBvasWorking] = useState<'yes' | 'no' | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = selectedLga ? `?lga=${encodeURIComponent(selectedLga)}` : '';
      const res = await apiFetch(`${API_URL}/api/situation-room/coverage-matrix${qs}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (err: any) {
      toast.error(`Could not load polling unit coverage: ${err?.message || 'Error'}`);
    } finally {
      setLoading(false);
    }
  }, [selectedLga, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const recordCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pollingUnitCode: puCode,
          milestone,
          bvasWorking: bvasWorking === '' ? undefined : bvasWorking === 'yes',
          channel: 'WEB',
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || 'Check-in failed');
      toast.success(`Milestone recorded: PU ${body.pollingUnitCode} → ${milestone}`);
      setPuCode('');
      setNotes('');
      await load();
    } catch (err: any) {
      toast.error(`Check-in error: ${err?.message || 'Error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const t = data?.totals;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="h-6 w-6 text-emerald-600" />
            Polling Units &amp; Election-Day Milestones (2,988 PUs)
          </h1>
          <p className="text-sm text-slate-500">
            Track agent arrival, INEC materials, BVAS status, voting start, counting, and Form EC8A submission across all 11 LGAs and 114 wards.
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

      <RoleNotice path="/polling-units" />

      {t && (
        <section className="grid gap-3 sm:grid-cols-5">
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs uppercase text-slate-500">Polling Units</div>
            <div className="mt-1 text-2xl font-bold">{t.totalUnits.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs uppercase text-slate-500">Checked In</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600">{t.checkedIn.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs uppercase text-slate-500">Materials Arrived</div>
            <div className="mt-1 text-2xl font-bold text-blue-600">{t.materialsArrived.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs uppercase text-slate-500">BVAS Issues</div>
            <div className="mt-1 text-2xl font-bold text-red-600">{t.bvasFailed.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs uppercase text-slate-500">EC8A Submitted</div>
            <div className="mt-1 text-2xl font-bold text-indigo-600">{t.ec8aSubmitted.toLocaleString()}</div>
          </div>
        </section>
      )}

      {/* Quick check-in form */}
      <form onSubmit={recordCheckIn} className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Log Polling Unit Milestone
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            required
            value={puCode}
            onChange={(e) => setPuCode(e.target.value)}
            placeholder="PU Code (e.g. 15/01/01/001)"
            className="rounded border px-3 py-2 text-sm bg-transparent"
          />
          <select
            value={milestone}
            onChange={(e) => setMilestone(e.target.value as any)}
            className="rounded border px-3 py-2 text-sm bg-transparent"
          >
            {MILESTONES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
          <select
            value={bvasWorking}
            onChange={(e) => setBvasWorking(e.target.value as any)}
            className="rounded border px-3 py-2 text-sm bg-transparent"
          >
            <option value="">BVAS status (optional)</option>
            <option value="yes">BVAS Working</option>
            <option value="no">BVAS Failed / Issue</option>
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {submitting ? 'Recording…' : 'Record Check-In'}
        </button>
      </form>

      {/* 11-LGA matrix */}
      <section className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            LGA Milestone Matrix (click an LGA to inspect polling units)
          </h2>
          {selectedLga && (
            <button onClick={() => setSelectedLga('')} className="text-xs text-blue-600 underline">
              Show all 11 LGAs
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">LGA</th>
                <th className="py-2 pr-3 text-right">PUs</th>
                <th className="py-2 pr-3 text-right">Assigned</th>
                <th className="py-2 pr-3 text-right">Checked In</th>
                <th className="py-2 pr-3 text-right">Materials</th>
                <th className="py-2 pr-3 text-right">BVAS Issue</th>
                <th className="py-2 pr-3 text-right">Voting</th>
                <th className="py-2 pr-3 text-right">EC8A</th>
                <th className="py-2 text-right">IReV</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.byLga ?? []).map((r) => (
                <tr
                  key={r.lga}
                  onClick={() => setSelectedLga(r.lga)}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <td className="py-2 pr-3 font-semibold text-emerald-700 dark:text-emerald-400">{r.lga}</td>
                  <td className="py-2 pr-3 text-right">{r.totalUnits}</td>
                  <td className="py-2 pr-3 text-right">{r.assignedAgents}</td>
                  <td className="py-2 pr-3 text-right font-medium text-emerald-600">{r.checkedIn}</td>
                  <td className="py-2 pr-3 text-right">{r.materialsArrived}</td>
                  <td className="py-2 pr-3 text-right text-red-600 font-medium">{r.bvasFailed || '—'}</td>
                  <td className="py-2 pr-3 text-right">{r.votingStarted}</td>
                  <td className="py-2 pr-3 text-right font-medium text-indigo-600">{r.ec8aSubmitted}</td>
                  <td className="py-2 text-right">{r.irevUploaded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unit drilldown when an LGA is selected */}
      {selectedLga && (data?.units ?? []).length > 0 && (
        <section className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {selectedLga} Polling Units ({data?.units.length})
          </h2>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left uppercase text-slate-500">
                  <th className="py-2 pr-3">PU Code</th>
                  <th className="py-2 pr-3">Ward / Name</th>
                  <th className="py-2 pr-3">Assigned Agent</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.units.map((u) => (
                  <tr key={u.code}>
                    <td className="py-2 pr-3 font-mono font-semibold">{u.code}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-slate-500">{u.registrationArea}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {u.assignedAgent ? (
                        <div>
                          <div>{u.assignedAgent.fullName}</div>
                          <div className="font-mono text-slate-500">{u.assignedAgent.phoneNumber}</div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3.5 w-3.5" /> Unassigned
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {u.status?.ec8aSubmittedAt
                        ? 'EC8A Submitted'
                        : u.status?.votingStartedAt
                        ? 'Voting Started'
                        : u.status?.materialsArrivedAt
                        ? 'Materials Arrived'
                        : u.status?.agentCheckedInAt
                        ? 'Agent Checked In'
                        : 'Silent'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setPuCode(u.code)}
                        className="rounded border px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Select
                      </button>
                    </td>
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
