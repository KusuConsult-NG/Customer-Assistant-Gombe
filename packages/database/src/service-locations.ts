/**
 * Service locations a citizen may be directed to, by Local Government Area.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 *
 * This is REFERENCE DATA FOR ONE AGENCY — the State health scheme's accredited
 * facilities. It is not a platform-wide directory, and nothing here describes
 * where a lands registry or a revenue board does business.
 *
 * It lives in code for now because that is where it already was. The honest
 * shape is a per-agency table of service locations, so each ministry lists its
 * own offices; that is recorded as outstanding in PROVENANCE.md. Until then,
 * treat this as that agency's seed data that other agencies simply do not use.
 *
 * The agent reads from this list rather than accepting a free-text location,
 * so a caller cannot be registered against a facility that does not exist.
 *
 * ── Why this table holds four LGAs and not eleven ──────────────────────────
 *
 * The Plateau version named six facilities in Jos North alone and covered 17
 * LGAs. Those were real Plateau hospitals; none of them is in Gombe State, and
 * the state this deployment was briefly pointed at (Bauchi) is not Gombe
 * either — Gombe was carved OUT of Bauchi in 1996, so the two share history,
 * press coverage and some institutional names without sharing a single
 * hospital.
 *
 * Only facilities confirmed BY NAME in a published source are here. Gombe's
 * plan is one general hospital per senatorial district, and those are named;
 * the primary health centres are not, anywhere. The rest is a gap the agency
 * fills, not a gap the platform guesses at: `lgasWithoutFacilities()` reports
 * it, `facilitiesForLGAAsText()` falls back to "your nearest General Hospital
 * or Primary Health Centre", and nobody is sent to a hospital that may not
 * exist. Load the real directory with `npm run catalogue:seed` once GOHEALTH
 * supplies it.
 *
 * Sources, read 2026-11-21:
 *   - en.wikipedia.org/wiki/Gombe_State_Specialist_Hospital
 *   - naijadirectory.org / leadership.ng — Federal Teaching Hospital, Gombe
 *   - nairametrics.com, allafrica.com — Kumo General Hospital converted to a
 *     Federal Medical Centre by the Federal Government in March 2025
 *   - guardian.ng — one general hospital per senatorial district: Kumo
 *     (Central), Kaltungo (South), Bajoga in Funakaye (North)
 */

import { GOMBE_LGAS } from './state-geography';

export interface AccreditedFacility {
  name: string;
  type: string;
  address: string;
}

export const ACCREDITED_FACILITIES: Record<string, AccreditedFacility[]> = {
  Gombe: [
    {
      name: 'Gombe State Specialist Hospital',
      type: 'Specialist Hospital',
      address: 'Gombe, Gombe LGA',
    },
    {
      name: 'Federal Teaching Hospital, Gombe',
      type: 'Teaching Hospital',
      address: 'Gombe, Gombe LGA',
    },
  ],
  Akko: [
    {
      name: 'Federal Medical Centre, Kumo',
      type: 'Federal Medical Centre',
      address: 'Kumo, Akko LGA',
    },
  ],
  Kaltungo: [
    {
      name: 'General Hospital, Kaltungo',
      type: 'General Hospital',
      address: 'Kaltungo, Kaltungo LGA',
    },
  ],
  Funakaye: [
    {
      name: 'General Hospital, Bajoga',
      type: 'General Hospital',
      address: 'Bajoga, Funakaye LGA',
    },
  ],
};


/**
 * LGAs this directory actually covers. NOT the State's list of LGAs — that is
 * `GOMBE_LGAS` in state-geography.ts, and an LGA with no accredited facility
 * is still a real place somebody lives.
 */
export const FACILITY_COVERED_LGAS = Object.keys(ACCREDITED_FACILITIES).sort();

/** LGAs of the State where this agency has no accredited facility at all. */
export function lgasWithoutFacilities(): string[] {
  return GOMBE_LGAS.filter((l) => !ACCREDITED_FACILITIES[l]?.length);
}

/**
 * Find facilities for an LGA.
 *
 * The LGA name is resolved by `resolveLga`, which owns every spoken and
 * mis-transcribed form of every LGA name ("Billiri" → "Billiri", "Bajoga" →
 * "Shongom"). This function used to keep a second alias map of its own,
 * which meant a new spelling had to be added in two places or the geography
 * and the facility lookup would disagree about where a caller lives.
 */
export function getFacilitiesForLGA(lga: string): AccreditedFacility[] {
  // Imported lazily to avoid a cycle: state-geography has no dependencies.
  const { resolveLga } = require('./state-geography') as typeof import('./state-geography');
  const resolved = resolveLga(lga);
  if (!resolved) return [];
  return ACCREDITED_FACILITIES[resolved] ?? [];
}

export function isAccreditedFacility(lga: string, hospitalName: string): boolean {
  const facilities = getFacilitiesForLGA(lga);
  const cleaned = hospitalName.trim().toLowerCase();
  return facilities.some((f) => f.name.toLowerCase() === cleaned);
}

export function facilitiesForLGAAsText(lga: string): string {
  const facilities = getFacilitiesForLGA(lga);
  if (facilities.length === 0) return 'your nearest General Hospital or Primary Health Centre';
  if (facilities.length === 1) return facilities[0].name;
  const names = facilities.map((f) => f.name);
  const last = names.pop();
  return names.join(', ') + ', or ' + last;
}
