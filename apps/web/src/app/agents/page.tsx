'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Upload, Plus, Trash2, RefreshCw, Search } from 'lucide-react';
import { apiFetch, API_URL } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { RoleNotice } from '@/components/RoleNotice';

const GOMBE_LGAS = [
  'Akko', 'Balanga', 'Billiri', 'Dukku', 'Funakaye',
  'Gombe', 'Kaltungo', 'Kwami', 'Nafada', 'Shongom', 'Yamaltu/Deba',
];

type Reporter = {
  id: string;
  code: string;
  fullName: string;
  phoneNumber: string;
  role: 'OBSERVER' | 'COORDINATOR' | 'LAWYER' | 'MEDIA';
  deployedLga: string | null;
  deployedRegistrationArea: string | null;
  deployedPollingUnitCode: string | null;
  active: boolean;
  note: string | null;
};

type RosterResponse = {
  reporters: Reporter[];
  summary: {
    totalShown: number;
    totalPollingUnits: number;
    coveredPollingUnits: number;
    uncoveredPollingUnits: number;
  };
};

export default function PartyAgentsPage() {
  const toast = useToast();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lga, setLga] = useState('');
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');

  // Single add form
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [agentRole, setAgentRole] = useState<Reporter['role']>('OBSERVER');
  const [deployedLga, setDeployedLga] = useState('Gombe');
  const [puCode, setPuCode] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  // CSV bulk import
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (lga) qs.set('lga', lga);
      if (role) qs.set('role', role);
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiFetch(`${API_URL}/api/situation-room/reporters?${qs.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      toast.error(`Could not load party agent roster: ${e?.message || 'Error'}`);
    } finally {
      setLoading(false);
    }
  }, [lga, role, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const addAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/reporters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          phoneNumber,
          role: agentRole,
          deployedLga: puCode.trim() ? undefined : deployedLga,
          deployedPollingUnitCode: puCode.trim() || undefined,
          code: code.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || 'Failed to save agent');
      toast.success(`Party agent saved: ${body.fullName} (${body.code})`);
      setFullName('');
      setPhoneNumber('');
      setPuCode('');
      setCode('');
      await load();
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || 'Error'}`);
    } finally {
      setSaving(false);
    }
  };

  const runCsvImport = async (dryRun: boolean) => {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const rows = lines
      .filter((l, i) => !(i === 0 && /fullname|phone/i.test(l)))
      .map((line) => {
        const [name, phone, rRole, rPu, rLga, rCode] = line.split(',').map((c) => c.trim());
        return {
          fullName: name || '',
          phoneNumber: phone || '',
          role: (rRole?.toUpperCase() as Reporter['role']) || 'OBSERVER',
          deployedPollingUnitCode: rPu || undefined,
          deployedLga: rLga || undefined,
          code: rCode || undefined,
        };
      });

    setImporting(true);
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/reporters/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, dryRun }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || 'Import failed');
      setImportResult(body);
      if (!dryRun) {
        toast.success(`Import completed: ${body.created} created, ${body.updated} updated, ${body.rejectedCount} rejected`);
        await load();
      }
    } catch (err: any) {
      toast.error(`Import error: ${err?.message || 'Error'}`);
    } finally {
      setImporting(false);
    }
  };

  const revoke = async (id: string, name: string) => {
    try {
      const res = await apiFetch(`${API_URL}/api/situation-room/reporters/${encodeURIComponent(id)}?reason=Revoked+in+dashboard`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Accreditation revoked for ${name} (historical reports preserved)`);
      await load();
    } catch (err: any) {
      toast.error(`Revoke failed: ${err?.message || 'Error'}`);
    }
  };

  const s = data?.summary;
  const pct = s && s.totalPollingUnits > 0 ? Math.round((s.coveredPollingUnits / s.totalPollingUnits) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            Party Agents &amp; Coordinators Roster
          </h1>
          <p className="text-sm text-slate-500">
            Accredited polling unit agents, ward/LGA coordinators, legal officers, and media monitors matched automatically on calls and 2G SMS.
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

      <RoleNotice path="/agents" />

      {s && (
        <section className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-4">
            <div className="text-xs uppercase text-slate-500">Total Gombe PUs</div>
            <div className="mt-1 text-2xl font-bold">{s.totalPollingUnits.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-4">
            <div className="text-xs uppercase text-slate-500">PUs with Assigned Agent</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600">
              {s.coveredPollingUnits.toLocaleString()} <span className="text-sm font-normal text-slate-500">({pct}%)</span>
            </div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-4">
            <div className="text-xs uppercase text-slate-500">Uncovered Polling Units</div>
            <div className="mt-1 text-2xl font-bold text-amber-600">{s.uncoveredPollingUnits.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-white dark:bg-slate-900 p-4">
            <div className="text-xs uppercase text-slate-500">Active Agents Listed</div>
            <div className="mt-1 text-2xl font-bold">{s.totalShown.toLocaleString()}</div>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Add single agent */}
        <form onSubmit={addAgent} className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Accredit Agent / Coordinator
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              className="rounded border px-3 py-2 text-sm bg-transparent"
            />
            <input
              required
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Phone (e.g. 08031234567)"
              className="rounded border px-3 py-2 text-sm bg-transparent"
            />
            <select
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value as Reporter['role'])}
              className="rounded border px-3 py-2 text-sm bg-transparent"
            >
              <option value="OBSERVER">Polling Unit Agent / Observer</option>
              <option value="COORDINATOR">Ward / LGA Coordinator</option>
              <option value="LAWYER">Legal / Petition Officer</option>
              <option value="MEDIA">Media Monitor</option>
            </select>
            <select
              value={deployedLga}
              onChange={(e) => setDeployedLga(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-transparent"
            >
              {GOMBE_LGAS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <input
              value={puCode}
              onChange={(e) => setPuCode(e.target.value)}
              placeholder="Polling unit code (optional, e.g. 15/01/01/001)"
              className="rounded border px-3 py-2 text-sm bg-transparent"
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Agent code (optional, auto-generated)"
              className="rounded border px-3 py-2 text-sm bg-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Accredited Agent'}
          </button>
        </form>

        {/* Bulk CSV import */}
        <div className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
            <Upload className="h-4 w-4" /> Bulk CSV Import (up to 3,500 agents)
          </h2>
          <p className="text-xs text-slate-500">
            Columns: <code>fullName, phoneNumber, role, pollingUnitCode, lga, code</code>. Polling unit codes are checked against Gombe&apos;s 2,988-unit register.
          </p>
          <textarea
            rows={4}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={'Musa Ibrahim, 08031234567, OBSERVER, 15/01/01/001, Akko, GM-AK-001\nAmina Bello, 08029876543, COORDINATOR, , Gombe, GM-CO-01'}
            className="w-full rounded border p-2 text-xs font-mono bg-transparent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={importing || !csvText.trim()}
              onClick={() => runCsvImport(true)}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Validate (Dry Run)
            </button>
            <button
              type="button"
              disabled={importing || !csvText.trim()}
              onClick={() => runCsvImport(false)}
              className="rounded-lg bg-slate-900 dark:bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import Roster'}
            </button>
          </div>
          {importResult && (
            <div className="rounded bg-slate-100 dark:bg-slate-800 p-2.5 text-xs">
              {importResult.dryRun
                ? `Validation: ${importResult.acceptedCount} valid, ${importResult.rejectedCount} rejected.`
                : `Imported: ${importResult.created} created, ${importResult.updated} updated, ${importResult.rejectedCount} rejected.`}
              {importResult.rejected?.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-red-600 dark:text-red-400">
                  {importResult.rejected.slice(0, 5).map((r: any) => (
                    <li key={r.row}>Row {r.row}: {r.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filters + Roster table */}
      <section className="rounded-lg border bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, code, or PU…"
              className="w-full rounded border pl-9 pr-3 py-1.5 text-sm bg-transparent"
            />
          </div>
          <select value={lga} onChange={(e) => setLga(e.target.value)} className="rounded border px-3 py-1.5 text-sm bg-transparent">
            <option value="">All 11 LGAs</option>
            {GOMBE_LGAS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded border px-3 py-1.5 text-sm bg-transparent">
            <option value="">All roles</option>
            <option value="OBSERVER">PU Agent / Observer</option>
            <option value="COORDINATOR">Coordinator</option>
            <option value="LAWYER">Lawyer</option>
            <option value="MEDIA">Media</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">LGA / Ward</th>
                <th className="py-2 pr-3">Polling Unit</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.reporters ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 font-mono text-xs font-semibold">{r.code}</td>
                  <td className="py-2 pr-3 font-medium">{r.fullName}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.phoneNumber}</td>
                  <td className="py-2 pr-3 text-xs">{r.role}</td>
                  <td className="py-2 pr-3 text-xs text-slate-500">
                    {r.deployedLga || '—'}{r.deployedRegistrationArea ? ` · ${r.deployedRegistrationArea}` : ''}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.deployedPollingUnitCode || '—'}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => revoke(r.id, r.fullName)}
                      className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && (data?.reporters ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No party agents loaded yet. Add an agent above or paste your CSV deployment sheet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
