/**
 * INEC's polling unit register, and resolving what a reporter said into one.
 *
 * ── Why LGA is not enough ───────────────────────────────────────────────────
 *
 * `state-geography.ts` resolves the State's eleven Local Government Areas, and
 * for a service case that is the right grain: a pothole is in Akko and an
 * officer in Akko goes to look at it.
 *
 * An election incident is not like that. It happens at a POLLING UNIT, and the
 * polling unit is the unit of everything that follows:
 *
 *   - DEDUPLICATION. Twenty observers reporting one snatched ballot box are one
 *     incident. Without a unit code there is nothing to cluster on, and
 *     clustering on "Akko" would merge unrelated events across hundreds of
 *     units in one LGA.
 *   - COUNTING. "Three incidents in Akko" is meaningless without knowing it was
 *     three units out of how many reporting.
 *   - CORRELATION. INEC publishes results per polling unit. A claim of
 *     over-voting is checkable only against the unit's own figures.
 *   - THE PETITION. A tribunal asks which unit. "Akko LGA" is not an answer.
 *
 * ── Why this file holds no data ─────────────────────────────────────────────
 *
 * The eleven LGAs are in code because there are eleven of them and they are
 * stable. A State has thousands of polling units, with codes INEC assigns and
 * revises, so they are reference DATA in the `PollingUnit` table, loaded from
 * INEC's published register by `npm run units:load`.
 *
 * **The table starts EMPTY, and that is deliberate.** Nobody on this project
 * has INEC's Gombe register to hand, and a plausible-looking invented unit code
 * is worse than none: it would pass every validation, cluster real reports
 * against a unit that does not exist, and put a fabricated location in a
 * petition. So `resolvePollingUnit` returns a MISS with a reason while the
 * table is empty, the agent says it cannot confirm the unit and records what
 * the reporter actually said, and nothing is guessed.
 *
 * Get the register from INEC — the polling unit register published per State,
 * or the National Register of Voters distribution tables — and load it. The
 * loader refuses rows whose LGA is not one of the State's own.
 */

import { GOMBE_LGAS, resolveLga } from './state-geography';

/** A polling unit as INEC publishes it. */
export interface PollingUnitRecord {
  /** INEC code, e.g. "15-04-07-012". */
  code: string;
  name: string;
  lga: string;
  /** INEC Registration Area — what everyone calls the ward. */
  registrationArea: string;
  registeredVoters?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type PollingUnitResolution =
  | { ok: true; unit: PollingUnitRecord }
  | {
      ok: false;
      /**
       * `register_empty`  — INEC's register has not been loaded.
       * `no_match`        — loaded, but nothing matches what was said.
       * `ambiguous`       — several units match; the reporter must narrow it.
       * `nothing_said`    — no unit was named at all.
       */
      reason: 'register_empty' | 'no_match' | 'ambiguous' | 'nothing_said';
      /** Units to offer the reporter, when the miss was ambiguity. */
      candidates?: PollingUnitRecord[];
      /** What the reporter said, kept verbatim so the report is still usable. */
      said?: string;
    };

/**
 * An INEC polling unit code: four dash-separated numeric parts, State / LGA /
 * RA / unit. Accepts the spacing and separators people actually type.
 */
const CODE = /^(\d{1,3})[-\s/.](\d{1,3})[-\s/.](\d{1,3})[-\s/.](\d{1,4})$/;

export function normaliseUnitCode(input: string | null | undefined): string | null {
  const m = CODE.exec((input ?? '').trim());
  if (!m) return null;
  const [, state, lga, ra, unit] = m;
  return [state.padStart(2, '0'), lga.padStart(2, '0'), ra.padStart(2, '0'), unit.padStart(3, '0')].join('-');
}

export function looksLikeUnitCode(input: string | null | undefined): boolean {
  return normaliseUnitCode(input) !== null;
}

/** Collapse to comparable words: case, punctuation and filler removed. */
function key(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(polling unit|polling|unit|pu|ward|registration area|ra|primary school|pry school|school|open space|square|village|town hall|hall)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve what a reporter said into one polling unit.
 *
 * `units` is the loaded register, narrowed by the caller to the LGA when it
 * knows it — resolving a unit name across a whole State invites collisions,
 * because "Central Primary School" exists in most LGAs.
 *
 * Never guesses. An ambiguous name comes back as `ambiguous` with the
 * candidates so the agent can ask which one, which is what a human officer
 * would do.
 */
export function resolvePollingUnit(
  units: readonly PollingUnitRecord[],
  said: string | null | undefined,
  within?: { lga?: string | null; registrationArea?: string | null }
): PollingUnitResolution {
  const raw = (said ?? '').trim();
  if (!raw) return { ok: false, reason: 'nothing_said' };
  if (units.length === 0) return { ok: false, reason: 'register_empty', said: raw };

  // A code is unambiguous when it is one: prefer it over any name match.
  const code = normaliseUnitCode(raw);
  if (code) {
    const exact = units.find((u) => normaliseUnitCode(u.code) === code);
    return exact ? { ok: true, unit: exact } : { ok: false, reason: 'no_match', said: raw };
  }

  const lga = within?.lga ? resolveLga(within.lga) : null;
  const ra = within?.registrationArea ? key(within.registrationArea) : null;
  let pool = units;
  if (lga) pool = pool.filter((u) => resolveLga(u.lga) === lga);
  if (ra) {
    const narrowed = pool.filter((u) => key(u.registrationArea) === ra);
    if (narrowed.length > 0) pool = narrowed;
  }

  const asked = key(raw);
  if (!asked) return { ok: false, reason: 'no_match', said: raw };

  const exact = pool.filter((u) => key(u.name) === asked);
  if (exact.length === 1) return { ok: true, unit: exact[0] };
  if (exact.length > 1) return { ok: false, reason: 'ambiguous', candidates: exact.slice(0, 5), said: raw };

  const contained = pool.filter((u) => {
    const name = key(u.name);
    return name.length >= 3 && (name.includes(asked) || asked.includes(name));
  });
  if (contained.length === 1) return { ok: true, unit: contained[0] };
  if (contained.length > 1) return { ok: false, reason: 'ambiguous', candidates: contained.slice(0, 5), said: raw };

  return { ok: false, reason: 'no_match', said: raw };
}

/**
 * What the agent should SAY when a unit could not be resolved.
 *
 * Every branch keeps the report moving. A reporter standing at a polling unit
 * watching something happen must never be blocked because our reference data is
 * incomplete — the report is recorded with their own words either way, and the
 * unit is attached later.
 */
export function unitMissReply(resolution: Extract<PollingUnitResolution, { ok: false }>): string {
  switch (resolution.reason) {
    case 'nothing_said':
      return 'Which polling unit are you reporting from? The name, or the code if you have it.';
    case 'ambiguous': {
      const names = (resolution.candidates ?? []).map((u) => `${u.name} (${u.registrationArea})`);
      return `There is more than one unit by that name — is it ${names.join(', or ')}?`;
    }
    case 'register_empty':
    case 'no_match':
    default:
      return "I could not match that to a polling unit in our records, so I have written down exactly what you said and I am recording the report now. Someone will confirm the unit with you.";
  }
}

/** Rows the loader will refuse, with the reason. Exported so the loader and its test agree. */
export function rejectReason(row: Partial<PollingUnitRecord>): string | null {
  if (!row.code || !normaliseUnitCode(row.code)) return 'code is not an INEC polling unit code';
  if (!row.name || !row.name.trim()) return 'no unit name';
  if (!row.lga || !resolveLga(row.lga)) return `"${row.lga ?? ''}" is not one of the State's ${GOMBE_LGAS.length} LGAs`;
  if (!row.registrationArea || !row.registrationArea.trim()) return 'no registration area';
  return null;
}
