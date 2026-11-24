/**
 * Load INEC's polling unit register into the `PollingUnit` table.
 *
 *   npm run units:load -- <file.csv|file.json>          report what would change
 *   npm run units:load -- <file.csv|file.json> --apply  write it
 *
 * ── Why this is a loader and not a data file ────────────────────────────────
 *
 * The State's eleven LGAs live in `state-geography.ts` because there are eleven
 * of them and they change roughly never. A State has thousands of polling
 * units, with codes INEC assigns and revises between elections, so they are
 * reference data loaded from INEC's own published register.
 *
 * **Nothing in this repository invents a polling unit.** The table is empty
 * until this runs. An invented unit code would pass every validation we have,
 * cluster real reports against a unit that does not exist, and end up in a
 * petition as the location of an incident — which is why the resolver reports
 * `register_empty` honestly instead of guessing, and why this loader refuses
 * any row it cannot check.
 *
 * ── Where to get the register ───────────────────────────────────────────────
 *
 * INEC publishes the polling unit register per State, and the distribution
 * tables in the National Register of Voters carry the same codes. Ask the INEC
 * State office for the machine-readable file; the situation room's own
 * deployment plan is usually built from it, so whoever assigns observers to
 * units already has it.
 *
 * ── What it refuses ─────────────────────────────────────────────────────────
 *
 * A row is rejected, not corrected, when its code is not an INEC code, when it
 * has no name or registration area, or when its LGA is not one of the State's
 * own. That last one is the important check: it is what stops a neighbouring
 * State's register being loaded by mistake, which matters here more than most
 * places because Gombe was carved out of Bauchi in 1996 and the two registers
 * are frequently distributed together.
 *
 * Expected columns (CSV header names are matched case- and space-insensitively):
 *   code | name | lga | registrationArea | registeredVoters? | latitude? | longitude?
 * Aliases accepted: pu_code/unit_code for code, pu_name/polling_unit for name,
 * ward/ra for registrationArea, voters/registered for registeredVoters.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { prisma, GOMBE_LGAS, resolveLga, normaliseUnitCode, rejectReason } = require(
  path.join(ROOT, 'packages', 'database', 'dist', 'index.js'),
);

const ALIASES = {
  code: ['code', 'pucode', 'unitcode', 'pollingunitcode'],
  name: ['name', 'puname', 'pollingunit', 'pollingunitname'],
  lga: ['lga', 'localgovernment', 'localgovernmentarea'],
  registrationArea: ['registrationarea', 'ward', 'ra'],
  registeredVoters: ['registeredvoters', 'voters', 'registered'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
};

const flatten = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function columnMap(header) {
  const map = {};
  header.forEach((raw, i) => {
    const flat = flatten(raw);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (names.includes(flat)) map[field] = i;
    }
  });
  return map;
}

/** Minimal RFC4180-ish split: quoted fields, embedded commas, doubled quotes. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function readRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.pollingUnits ?? parsed.units ?? [];
    return list.map((r) => ({
      code: r.code ?? r.pu_code ?? r.unitCode,
      name: r.name ?? r.pu_name ?? r.pollingUnit,
      lga: r.lga ?? r.localGovernment,
      registrationArea: r.registrationArea ?? r.ward ?? r.ra,
      registeredVoters: r.registeredVoters ?? r.voters ?? null,
      latitude: r.latitude ?? r.lat ?? null,
      longitude: r.longitude ?? r.lng ?? null,
    }));
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const map = columnMap(splitCsvLine(lines[0]));
  const missing = ['code', 'name', 'lga', 'registrationArea'].filter((f) => map[f] === undefined);
  if (missing.length) {
    throw new Error(
      `The file is missing required column(s): ${missing.join(', ')}. ` +
        `Found: ${splitCsvLine(lines[0]).join(', ')}`,
    );
  }
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const at = (f) => (map[f] === undefined ? null : cells[map[f]] ?? null);
    const num = (f) => {
      const v = at(f);
      if (v === null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      code: at('code'),
      name: at('name'),
      lga: at('lga'),
      registrationArea: at('registrationArea'),
      registeredVoters: num('registeredVoters'),
      latitude: num('latitude'),
      longitude: num('longitude'),
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => !a.startsWith('--'));

  if (!file) {
    console.error('Usage: npm run units:load -- <file.csv|file.json> [--apply]');
    console.error('');
    console.error("The polling unit table is EMPTY until INEC's register is loaded, and that is");
    console.error('deliberate: an invented unit code would pass every validation, cluster real');
    console.error('reports against a unit that does not exist, and put a fabricated location in a');
    console.error('petition. Get the register from the INEC State office.');
    process.exit(1);
  }

  const rows = readRows(path.resolve(file));
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const row of rows) {
    const why = rejectReason(row);
    if (why) { rejected.push({ row, why }); continue; }
    const code = normaliseUnitCode(row.code);
    if (seen.has(code)) { rejected.push({ row, why: 'duplicate code in this file' }); continue; }
    seen.add(code);
    accepted.push({
      code,
      name: String(row.name).trim(),
      lga: resolveLga(row.lga),
      registrationArea: String(row.registrationArea).trim(),
      registeredVoters: row.registeredVoters ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
    });
  }

  const byLga = new Map();
  for (const u of accepted) byLga.set(u.lga, (byLga.get(u.lga) ?? 0) + 1);
  const ras = new Set(accepted.map((u) => `${u.lga}|${u.registrationArea}`));

  console.log(`\nRead ${rows.length} row(s) from ${path.basename(file)}.`);
  console.log(`  ${accepted.length} accepted — ${ras.size} registration area(s) across ${byLga.size} LGA(s)`);
  console.log(`  ${rejected.length} rejected`);

  const uncovered = GOMBE_LGAS.filter((l) => !byLga.has(l));
  if (uncovered.length) {
    console.log(`\n  No units for ${uncovered.length} of the State's ${GOMBE_LGAS.length} LGAs: ${uncovered.join(', ')}`);
    console.log('  A partial register is worse than none if anyone assumes it is complete.');
  }

  if (rejected.length) {
    console.log('\nRejected rows (first 20):');
    for (const { row, why } of rejected.slice(0, 20)) {
      console.log(`  ${row.code ?? '(no code)'} ${row.name ?? ''} — ${why}`);
    }
    if (rejected.length > 20) console.log(`  …and ${rejected.length - 20} more`);
  }

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to write.\n');
    await prisma.$disconnect();
    return;
  }
  if (accepted.length === 0) {
    console.log('\nNothing to write.\n');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const u of accepted) {
    await prisma.pollingUnit.upsert({ where: { code: u.code }, update: u, create: u });
    written++;
  }
  const total = await prisma.pollingUnit.count();
  console.log(`\nWritten. ${written} unit(s) upserted; the register now holds ${total}.\n`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(`\nFailed: ${err.message}\n`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
