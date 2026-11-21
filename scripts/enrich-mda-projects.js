const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'gombe-mdas-knowledge-base.json');
const mdas = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));

/**
 * Current projects and strategic initiatives, per MDA, for
 * data/gombe-mdas-knowledge-base.json.
 *
 * ── Why this map is empty ───────────────────────────────────────────────────
 *
 * It held 58 agencies' worth of projects — around 170 entries — and every one
 * of them was a PLATEAU State project of the Mutfwang administration, with
 * figures and places attached:
 *
 *   "over 200 truckloads (more than 120,000 bags) of subsidized fertilizer
 *    across all 17 LGAs"
 *   "Heipang Inland Dry Port and the AfDB-backed Special Agro-Industrial
 *    Processing Zone, for export of Irish potatoes"
 *   "restore Jos as North-Central Nigeria's trade capital"
 *   "the Agricultural Services and Training Centre (ASTC) Vom/Kassa"
 *   "Hill Station Hotel", "Highland Bottling Company", "BARC Farms"
 *
 * Heipang is in Barkin Ladi; Vom and Kassa are in Jos South and Barkin Ladi;
 * the Hill Station Hotel is in Jos. Gombe is in the NORTH-EAST, not
 * North-Central. Irish potato is a Plateau crop. The naira figures are
 * Plateau's budget lines.
 *
 * A rebrand can change "Plateau" to "Gombe" in that sentence. It cannot make
 * the fertilizer arrive, and this is the part of the knowledge base a citizen
 * is most likely to ask a direct question about and most likely to be able to
 * check: "what is the government doing about X in my LGA?" A confident,
 * specific, invented answer to that is worse than no answer, so the entries
 * were deleted rather than relabelled.
 *
 * ── Filling it ──────────────────────────────────────────────────────────────
 *
 * Add Gombe State's own projects, per MDA, from the State's budget documents,
 * the Ministry of Budget and Economic Planning's MTSS, and each agency's own
 * records. Keep the shape: one line per project, named, with the LGA it is in.
 * Until then each document simply has no projects section, and the assistant
 * says it does not know and offers to put the citizen through — which is true.
 */
const PROJECTS_MAP = {};


let enrichedCount = 0;
let totalProjects = 0;
const unmapped = [];
for (const m of mdas) {
  const key = m.abbreviation || m.name;
  if (PROJECTS_MAP[key]) {
    m.currentProjects = PROJECTS_MAP[key];
    enrichedCount++;
    totalProjects += m.currentProjects.length;
  } else {
    // Intentional while PROJECTS_MAP is empty: see the note above.
    unmapped.push(key);
  }
}

fs.writeFileSync(FILE_PATH, JSON.stringify(mdas, null, 2), 'utf8');
console.log(`✓ Enriched ${enrichedCount}/${mdas.length} MDAs with ${totalProjects} current projects in data/gombe-mdas-knowledge-base.json.`);
if (unmapped.length) {
  console.log(`  ${unmapped.length} MDAs have no projects listed yet: ${unmapped.join(', ')}`);
  console.log('  This is expected until Gombe State\'s own project records are added to PROJECTS_MAP.');
}
