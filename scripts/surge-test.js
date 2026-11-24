/**
 * Election-day surge test for the incident intake path.
 *
 *   npm run surge                          # the default shape, against localhost
 *   npm run surge -- --scenario cluster    # one polling unit, many reporters
 *   npm run surge -- --reports 5000 --concurrency 200
 *   npm run surge -- --base https://api.example.gov.ng
 *
 * ── Why this exists as a script and not a test ──────────────────────────────
 *
 * A jest suite proves the intake path is CORRECT. It cannot tell you whether it
 * survives an election, because the thing that breaks on election day is not
 * logic — it is twenty thousand reports arriving in eleven hours, clustered
 * into spikes when the polls open, when materials fail to arrive, and when
 * collation starts. Those spikes are concurrency, and concurrency breaks things
 * that every sequential test passes:
 *
 *   - READ-THEN-WRITE. The clustering check reads for an existing incident at a
 *     polling unit and creates one if it finds none. Twenty reporters arriving
 *     in the same instant all read "none" and all create one, which is the
 *     exact failure clustering exists to prevent — and it appears only under
 *     load. `--scenario cluster` is built to find it.
 *   - CONNECTION POOL. Prisma holds `connection_limit` connections per process.
 *     Past it, requests queue and then time out, and a timed-out report is a
 *     lost report.
 *   - LOST REPORTS. The number that matters is not latency. It is whether every
 *     report that was accepted can be found afterwards.
 *
 * So this measures throughput and latency, and then CHECKS THE DATA: one
 * incident per cluster, corroborations adding up, and nothing accepted that
 * cannot be found.
 *
 * It creates a throwaway organization, runs, reports, and deletes it.
 */
const { randomBytes, createHash } = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { prisma } = require(path.join(ROOT, 'packages', 'database', 'dist', 'index.js'));
// Read from the built app rather than retyping it: a surge test that mints a
// key the guard rejects measures nothing but 401s.
const { AGENT_KEY_PREFIX } = require(path.join(ROOT, 'apps', 'api', 'dist', 'agent-tools', 'agent-key.guard.js'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = arg('base', process.env.SURGE_BASE_URL || 'http://127.0.0.1:4000');
const SCENARIO = arg('scenario', 'mixed');
const REPORTS = Number(arg('reports', 1000));
const CONCURRENCY = Number(arg('concurrency', 64));
const KEEP = flag('keep');

// ── The shape of an election day ────────────────────────────────────────────
//
// Not uniform. Nigerian polling units open around 08:30, and the reports that
// arrive first are the ones about things that did not: materials, BVAS, late
// officials. Vote buying and intimidation run through the day. The second spike
// is collation, when result sheets and figures are disputed.
const TYPES_BY_PHASE = {
  opening: ['late_or_no_materials', 'bvas_failure', 'polling_unit_relocation', 'disenfranchisement'],
  voting: ['vote_buying', 'voter_intimidation', 'underage_voting', 'secrecy_of_ballot', 'party_agent_misconduct', 'violence', 'ballot_snatching'],
  collation: ['result_sheet_irregularity', 'collation_dispute', 'irev_upload_failure', 'over_voting'],
};

const LGAS = ['Akko', 'Balanga', 'Billiri', 'Dukku', 'Funakaye', 'Gombe', 'Kaltungo', 'Kwami', 'Nafada', 'Shongom', 'Yamaltu/Deba'];

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const pad = (n, w) => String(n).padStart(w, '0');

/** A synthetic polling unit code. Local to this test; never written anywhere real. */
function unitCode(n) {
  return `15-${pad((n % 11) + 1, 2)}-${pad((Math.floor(n / 11) % 12) + 1, 2)}-${pad((n % 400) + 1, 3)}`;
}

function report(i, orgUnits) {
  const phase = SCENARIO === 'cluster' ? 'voting' : i < REPORTS * 0.25 ? 'opening' : i < REPORTS * 0.8 ? 'voting' : 'collation';
  // `cluster` puts EVERY report on one unit with one type, which is the
  // worst case for the read-then-write and the only way to see it.
  const unit = SCENARIO === 'cluster' ? orgUnits[0] : pick(orgUnits);
  const incidentType = SCENARIO === 'cluster' ? 'ballot_snatching' : pick(TYPES_BY_PHASE[phase]);
  return {
    phoneNumber: `+234${pad(8000000000 + i, 10)}`.slice(0, 14),
    fullName: `Observer ${i}`,
    subject: `${incidentType} report ${i}`,
    description: `Surge test report ${i}: ${incidentType} observed at the polling unit.`,
    incidentType,
    electionIncident: true,
    lga: pick(LGAS),
    pollingUnitCode: unit,
    pollingUnit: `Unit ${unit}`,
    registrationArea: `RA ${unit.split('-')[2]}`,
    summary: `${incidentType} at unit ${unit}.`,
    summaryConfirmed: true,
  };
}

async function fire(key, body) {
  const started = process.hrtime.bigint();
  try {
    const res = await fetch(`${BASE}/api/agent-tools/create-ticket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    let payload = null;
    try { payload = await res.json(); } catch { /* a non-JSON body is itself the finding */ }
    return { ok: res.ok, status: res.status, ms, payload };
  } catch (err) {
    return { ok: false, status: 0, ms: Number(process.hrtime.bigint() - started) / 1e6, error: String(err?.message ?? err) };
  }
}

/** Run `total` tasks with at most `limit` in flight. */
async function pool(total, limit, task) {
  const results = new Array(total);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, total) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      results[i] = await task(i);
    }
  });
  await Promise.all(workers);
  return results;
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function main() {
  console.log(`\nSurge test — ${SCENARIO}`);
  console.log(`  ${REPORTS} reports, ${CONCURRENCY} in flight, against ${BASE}\n`);

  // Reachable before we create anything.
  try {
    const probe = await fetch(`${BASE}/api/health`, { method: 'GET' });
    if (!probe.ok && probe.status !== 404) throw new Error(`health probe returned ${probe.status}`);
  } catch (err) {
    console.error(`Cannot reach ${BASE}: ${String(err?.message ?? err)}`);
    console.error('Start the API first, e.g.  node apps/api/dist/main.js\n');
    process.exit(1);
  }

  const key = `${AGENT_KEY_PREFIX}${randomBytes(16).toString('hex')}`;
  const org = await prisma.organization.create({
    data: { name: `Surge test ${new Date().toISOString()}`, slug: `surge-${randomBytes(5).toString('hex')}`, industry: 'OTHER' },
    select: { id: true },
  });
  await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      keyName: 'surge test',
      keyHash: createHash('sha256').update(key).digest('hex'),
      keyPrefix: key.slice(0, 20),
    },
  });

  const unitCount = SCENARIO === 'cluster' ? 1 : Math.max(1, Math.floor(REPORTS / 6));
  const units = Array.from({ length: unitCount }, (_, i) => unitCode(i));

  const wall = Date.now();
  const results = await pool(REPORTS, CONCURRENCY, (i) => fire(key, report(i, units)));
  const seconds = (Date.now() - wall) / 1000;

  // ── What happened on the wire ─────────────────────────────────────────────
  // `ok` means the REPORT WAS FILED, not that HTTP was 2xx. The tools return
  // 201 with `ok: false` when they refuse or fail, and counting those as
  // accepted hid nine lost reports in twenty on the first run of this harness.
  const ok = results.filter((r) => r.ok && r.payload?.ok !== false);
  const failed = results.filter((r) => !r.ok || r.payload?.ok === false);
  const byStatus = new Map();
  for (const r of failed) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);

  console.log('── Throughput ──────────────────────────────────────────');
  console.log(`  accepted            ${ok.length} / ${REPORTS}`);
  console.log(`  rejected            ${failed.length}`);
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`     HTTP ${status || 'network'}         ${n}`);
  }
  console.log(`  wall clock          ${seconds.toFixed(1)}s`);
  console.log(`  throughput          ${(REPORTS / seconds).toFixed(1)} reports/sec`);
  console.log('\n── Latency (ms) ────────────────────────────────────────');
  console.log(`  p50 ${percentile(latencies, 50).toFixed(0)}   p95 ${percentile(latencies, 95).toFixed(0)}   p99 ${percentile(latencies, 99).toFixed(0)}   max ${latencies[latencies.length - 1]?.toFixed(0)}`);

  // ── What is actually in the database ──────────────────────────────────────
  //
  // The part that matters. Latency is a comfort question; these are
  // correctness questions, and they are the ones that decide whether a
  // situation room can brief from this data.
  const tickets = await prisma.ticket.findMany({
    where: { organizationId: org.id },
    select: { id: true, clusterKey: true, corroborations: true, verification: true, incidentType: true },
  });
  const events = await prisma.caseEvent.count({
    where: { organizationId: org.id, type: 'CORROBORATION' },
  });

  const perCluster = new Map();
  for (const t of tickets) {
    if (!t.clusterKey) continue;
    perCluster.set(t.clusterKey, (perCluster.get(t.clusterKey) ?? 0) + 1);
  }
  const split = [...perCluster.entries()].filter(([, n]) => n > 1);
  const corroborated = tickets.reduce((sum, t) => sum + t.corroborations, 0);

  // ── What the API said it did ──────────────────────────────────────────────
  //
  // Counted from the responses, not the database, so a report that was
  // ACCEPTED but did nothing is visible as a shape rather than as a hole.
  const shape = (r) => {
    const d = r.payload?.data ?? {};
    if (!r.payload?.ok) return `not-ok:${d.instruction ? 'gate' : 'unknown'}`;
    if (d.racedToCorroboration) return 'corroborated (lost the create race)';
    if (d.corroborated) return 'corroborated';
    if (d.ticketNumber) return 'new incident';
    return 'ok but nothing filed';
  };
  const shapes = new Map();
  for (const r of results) shapes.set(shape(r), (shapes.get(shape(r)) ?? 0) + 1);
  console.log('\n── What the API reported ───────────────────────────────');
  for (const [k, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  const exemplar = results.find((r) => r.payload && r.payload.ok === false);
  if (exemplar) {
    console.log('\n  An example of a report the API did NOT file (HTTP was fine):');
    console.log(`    speak: ${JSON.stringify(exemplar.payload.speak ?? '').slice(0, 220)}`);
    console.log(`    data:  ${JSON.stringify(exemplar.payload.data ?? {}).slice(0, 400)}`);
  }

  console.log('\n── Correctness ─────────────────────────────────────────');
  console.log(`  incidents created   ${tickets.length}`);
  console.log(`  distinct clusters   ${perCluster.size}`);
  console.log(`  corroboration events ${events}`);
  console.log(`  reports accounted for ${corroborated} (accepted: ${ok.length})`);

  let verdict = 0;

  if (ok.length < REPORTS) {
    console.log(`\n  ✗ ${REPORTS - ok.length} report(s) were REJECTED. On election day each one is a citizen's report that does not exist.`);
    verdict = 1;
  }
  if (corroborated !== ok.length) {
    console.log(`\n  ✗ ${ok.length} reports accepted but ${corroborated} accounted for — ${Math.abs(ok.length - corroborated)} unaccounted.`);
    verdict = 1;
  }
  if (split.length) {
    console.log(`\n  ✗ ${split.length} cluster(s) were SPLIT into more than one incident.`);
    console.log('    This is the read-then-write race: simultaneous reporters at one polling unit');
    console.log('    each found no existing incident and each created one. Worst split:');
    for (const [clusterKey, n] of split.sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`      ${n} incidents for ${clusterKey}`);
    }
    console.log('    A situation room briefing this would report N incidents where there was one.');
    verdict = 1;
  } else if (perCluster.size) {
    console.log('\n  ✓ every cluster is exactly one incident');
  }

  if (verdict === 0) console.log('\n  ✓ no lost reports, no split clusters\n');
  else console.log('');

  if (KEEP) {
    console.log(`  Organization kept for inspection: ${org.id}\n`);
  } else {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  }
  await prisma.$disconnect();
  process.exit(verdict);
}

main().catch(async (err) => {
  console.error(`\nSurge test failed to run: ${err?.stack ?? err}\n`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
