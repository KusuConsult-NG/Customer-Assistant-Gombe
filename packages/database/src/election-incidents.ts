/**
 * The election incident taxonomy, and the rules that act on it.
 *
 * ── Why this is not the service taxonomy ────────────────────────────────────
 *
 * `Ticket.category` is the service-delivery taxonomy — roads, water, waste,
 * health, education. It is the right list for a citizen-care platform and the
 * wrong list for an election. "Vote buying at my polling unit" is not a
 * category of public service, and the agent must not file it as `other`,
 * because `other` is where things go to be sorted out later and an election has
 * no later: the polls close.
 *
 * So an election report carries `incidentType` from this list, and `category`
 * stays null. One ticket model, two taxonomies, neither distorting the other.
 *
 * ── What is in the list, and why each one ───────────────────────────────────
 *
 * Every type here is something an accredited observer in Nigeria is trained to
 * look for and a situation room is asked about by name. They fall into four
 * groups, which is also roughly the severity ordering:
 *
 *   PROCESS   the vote happened but was run wrongly
 *   TECHNOLOGY the accreditation or upload machinery failed
 *   INTEGRITY  the result was interfered with
 *   SAFETY     somebody was hurt, threatened or kept from voting
 *
 * SAFETY and INTEGRITY are what escalate in minutes. PROCESS and TECHNOLOGY are
 * what the collation-day analysis is built from.
 */

export type IncidentGroup = 'PROCESS' | 'TECHNOLOGY' | 'INTEGRITY' | 'SAFETY';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IncidentType {
  /** Stored on the ticket. Stable: reports are counted on this across years. */
  readonly id: string;
  /** What an officer sees on screen. */
  readonly label: string;
  readonly group: IncidentGroup;
  /**
   * Severity when nothing worse is known. `severityFor` raises it when the
   * report says the incident is ongoing or that somebody was hurt — it never
   * lowers it, because a reporter who says "they are still shooting" has told
   * us more than the type alone does.
   */
  readonly baseSeverity: Severity;
  /** Words a reporter actually uses, for the keyword matcher. */
  readonly says: readonly string[];
  /**
   * Words that describe WHO was there rather than WHAT happened.
   *
   * "Thugs came and snatched the ballot box" is a report of ballot snatching.
   * Matching it on "thugs" filed it as generic violence and lost the one fact
   * that tells a situation room what to do — that the box is gone. Actor words
   * therefore only classify when nothing stronger matched anywhere, so they
   * still catch "there are thugs at my polling unit", which is a real report
   * with no act in it yet.
   *
   * It costs no urgency: `ballot_snatching` is CRITICAL in its own right.
   */
  readonly weakSays?: readonly string[];
}

export const INCIDENT_TYPES: readonly IncidentType[] = [
  // ── SAFETY ───────────────────────────────────────────────────────────────
  {
    id: 'violence',
    label: 'Violence or attack',
    group: 'SAFETY',
    baseSeverity: 'CRITICAL',
    says: ['violence', 'attack', 'attacked', 'shooting', 'gunshot', 'machete', 'stabbed', 'beaten', 'killed', 'dead', 'injured', 'fighting', 'riot', 'bomb', 'explosion'],
    weakSays: ['thugs', 'thuggery', 'gunmen', 'hoodlums', 'miscreants'],
  },
  {
    id: 'voter_intimidation',
    label: 'Voter intimidation',
    group: 'SAFETY',
    baseSeverity: 'HIGH',
    says: ['intimidation', 'intimidated', 'threatened', 'threatening', 'harassed', 'harassment', 'chased away', 'scared voters', 'forced to vote'],
  },
  {
    id: 'security_misconduct',
    label: 'Security agency misconduct',
    group: 'SAFETY',
    baseSeverity: 'HIGH',
    says: ['police', 'soldier', 'army', 'military', 'security agent', 'civil defence', 'nscdc', 'officer took', 'uniformed'],
  },
  {
    id: 'disenfranchisement',
    label: 'Voters prevented from voting',
    group: 'SAFETY',
    baseSeverity: 'HIGH',
    says: ['not allowed to vote', 'prevented', 'turned away', 'denied', 'disenfranchised', 'no access', 'wheelchair', 'disabled', 'pwd', 'elderly', 'nursing mother', 'pregnant'],
  },

  // ── INTEGRITY ────────────────────────────────────────────────────────────
  {
    id: 'ballot_snatching',
    label: 'Ballot box or material snatching',
    group: 'INTEGRITY',
    baseSeverity: 'CRITICAL',
    says: ['snatched', 'snatching', 'carried the box', 'took the ballot', 'stole the box', 'hijacked', 'carted away'],
  },
  {
    id: 'vote_buying',
    label: 'Vote buying or inducement',
    group: 'INTEGRITY',
    baseSeverity: 'HIGH',
    says: ['vote buying', 'buying votes', 'paying voters', 'giving money', 'sharing money', 'inducement', 'bribe', 'bribing', 'stomach infrastructure', 'food for vote', 'they paid'],
  },
  {
    id: 'over_voting',
    label: 'Over-voting',
    group: 'INTEGRITY',
    baseSeverity: 'HIGH',
    says: ['over voting', 'overvoting', 'more votes than', 'votes exceed', 'more than accredited'],
  },
  {
    id: 'underage_voting',
    label: 'Underage voting',
    group: 'INTEGRITY',
    baseSeverity: 'MEDIUM',
    says: ['underage', 'under age', 'children voting', 'minors', 'small boys voting', 'too young'],
  },
  {
    id: 'result_sheet_irregularity',
    label: 'Result sheet irregularity (EC8A)',
    group: 'INTEGRITY',
    baseSeverity: 'HIGH',
    says: ['result sheet', 'ec8a', 'ec8', 'figures altered', 'altered result', 'wrong figures', 'not signed', 'refused to sign', 'no result sheet'],
  },
  {
    id: 'collation_dispute',
    label: 'Collation dispute',
    group: 'INTEGRITY',
    baseSeverity: 'HIGH',
    says: ['collation', 'collating', 'declared wrongly', 'different result', 'result changed', 'announced different'],
  },
  {
    id: 'party_agent_misconduct',
    label: 'Party agent misconduct',
    group: 'INTEGRITY',
    baseSeverity: 'MEDIUM',
    says: ['party agent', 'agent of', 'apc agent', 'pdp agent', 'agent interfering', 'agent campaigning'],
  },

  // ── TECHNOLOGY ───────────────────────────────────────────────────────────
  {
    id: 'bvas_failure',
    label: 'BVAS failure',
    group: 'TECHNOLOGY',
    baseSeverity: 'HIGH',
    says: ['bvas', 'b vas', 'machine not working', 'machine failed', 'fingerprint not reading', 'accreditation machine', 'cannot accredit', 'not capturing'],
  },
  {
    id: 'irev_upload_failure',
    label: 'IReV upload failure',
    group: 'TECHNOLOGY',
    baseSeverity: 'MEDIUM',
    says: ['irev', 'i rev', 'not uploaded', 'upload failed', 'cannot upload', 'no network to upload', 'portal'],
  },

  // ── PROCESS ──────────────────────────────────────────────────────────────
  {
    id: 'late_or_no_materials',
    label: 'Late or missing election materials',
    group: 'PROCESS',
    baseSeverity: 'HIGH',
    says: ['materials', 'no ballot paper', 'did not arrive', 'late arrival', 'yet to arrive', 'no inec', 'officials not here', 'no ad hoc staff', 'late start', 'not started'],
  },
  {
    id: 'polling_unit_relocation',
    label: 'Polling unit moved without notice',
    group: 'PROCESS',
    baseSeverity: 'MEDIUM',
    says: ['relocated', 'moved the polling unit', 'changed location', 'not at the usual place', 'cannot find my polling unit'],
  },
  {
    id: 'secrecy_of_ballot',
    label: 'Secrecy of the ballot breached',
    group: 'PROCESS',
    baseSeverity: 'MEDIUM',
    says: ['open voting', 'showing their ballot', 'no secrecy', 'voting in the open', 'watching how people vote'],
  },
  {
    id: 'other_election_incident',
    label: 'Other election incident',
    group: 'PROCESS',
    baseSeverity: 'MEDIUM',
    says: [],
  },
];

const BY_ID = new Map(INCIDENT_TYPES.map((t) => [t.id, t]));

export function incidentType(id: string | null | undefined): IncidentType | null {
  return BY_ID.get((id ?? '').trim().toLowerCase()) ?? null;
}

export function isElectionIncident(id: string | null | undefined): boolean {
  return incidentType(id) !== null;
}

/**
 * Classify what a reporter said, by keyword, or null.
 *
 * Returns null rather than `other_election_incident` on no match: the caller
 * decides whether an unclassified report becomes "other" or goes to a human,
 * and on election day it goes to a human. Matching is longest-phrase-first so
 * "vote buying" is not beaten by "vote", and SAFETY wins ties because a report
 * that mentions both a fight and a result sheet is a fight first.
 */
export function classifyIncident(text: string | null | undefined): IncidentType | null {
  const said = ` ${(text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  if (said.trim().length === 0) return null;

  const GROUP_RANK: Record<IncidentGroup, number> = { SAFETY: 0, INTEGRITY: 1, TECHNOLOGY: 2, PROCESS: 3 };

  const match = (pick: (t: IncidentType) => readonly string[]) => {
    let best: { type: IncidentType; phraseLength: number } | null = null;
    for (const type of INCIDENT_TYPES) {
      for (const phrase of pick(type)) {
        if (!said.includes(` ${phrase} `) && !said.includes(` ${phrase}`)) continue;
        const better =
          !best ||
          GROUP_RANK[type.group] < GROUP_RANK[best.type.group] ||
          (GROUP_RANK[type.group] === GROUP_RANK[best.type.group] && phrase.length > best.phraseLength);
        if (better) best = { type, phraseLength: phrase.length };
      }
    }
    return best?.type ?? null;
  };

  // What happened beats who was there. Only when no act was named at all does
  // an actor word ("thugs at my polling unit") classify on its own.
  return match((t) => t.says) ?? match((t) => t.weakSays ?? []);
}

/**
 * The severity to act on.
 *
 * The type's base, raised — never lowered — by what the reporter said about it.
 * An ongoing incident, or one with casualties, is CRITICAL whatever its type:
 * "they are still there" and "someone is bleeding" are the two facts that
 * decide whether this needs an officer in the next five minutes.
 */
export function severityFor(
  typeId: string | null | undefined,
  signals: { isOngoing?: boolean | null; victimsOrInjuries?: string | null } = {}
): Severity {
  const base = incidentType(typeId)?.baseSeverity ?? 'MEDIUM';
  const hurt = (signals.victimsOrInjuries ?? '').trim();
  const saysNobody = /^(no|none|nobody|no one|nil|n\/a)\b/i.test(hurt);
  if (hurt && !saysNobody) return 'CRITICAL';
  if (signals.isOngoing) return base === 'LOW' || base === 'MEDIUM' ? 'HIGH' : 'CRITICAL';
  return base;
}

/**
 * How long an incident of this severity may sit before it is overdue.
 *
 * In MINUTES, not days. The service platform's `dueAt` is a service-charter
 * deadline — a pothole in fourteen days — and reusing it for an election would
 * mean an ongoing attack was "on time" until after the result was declared.
 */
export const RESPONSE_MINUTES: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 30,
  MEDIUM: 120,
  LOW: 480,
};

export function dueAtFor(severity: Severity, now: Date = new Date()): Date {
  return new Date(now.getTime() + RESPONSE_MINUTES[severity] * 60_000);
}

/**
 * The key that makes many reports of one event into one event.
 *
 * Twenty accredited observers at one polling unit watching one ballot box being
 * carried off is ONE incident with twenty corroborations. Counted as twenty
 * incidents it both overstates the violation and buries it: a situation room
 * briefing "twenty incidents in Akko" when there was one is how a credible
 * dataset loses its credibility.
 *
 * The key is polling unit + incident type + a time bucket. The bucket is
 * deliberately coarse (default 60 minutes) because reporters do not report at
 * the same moment, and deliberately not unbounded because the same unit can be
 * attacked twice in a day and those are two incidents.
 *
 * Null when there is no polling unit: without one there is nothing to cluster
 * on, and clustering on LGA alone would merge unrelated events across hundreds
 * of units.
 */
export function clusterKeyFor(
  pollingUnitCode: string | null | undefined,
  typeId: string | null | undefined,
  occurredAt: Date | null | undefined,
  bucketMinutes = 60
): string | null {
  const unit = (pollingUnitCode ?? '').trim();
  const type = (typeId ?? '').trim().toLowerCase();
  if (!unit || !type) return null;
  const at = occurredAt ?? new Date();
  const bucket = Math.floor(at.getTime() / (bucketMinutes * 60_000));
  return `${unit}|${type}|${bucket}`;
}

/**
 * What corroboration alone is allowed to conclude.
 *
 * Independent reports raise a claim from UNVERIFIED to CORROBORATED and NO
 * FURTHER. VERIFIED means a person looked at the evidence and stands behind it,
 * and no number of phone calls substitutes for that — a coordinated campaign is
 * exactly a lot of independent-looking reports. This function therefore cannot
 * return VERIFIED, DISPUTED or FALSE_REPORT: those are human verdicts.
 */
/**
 * The same values as Prisma's `VerificationState` enum, as a plain union.
 *
 * Named differently on purpose: `@prisma/client` already exports
 * `VerificationState`, and re-exporting a second one from `@ace/database`
 * makes every import of it ambiguous. This module is pure — it must stay
 * usable without a generated client — so it keeps its own union and the two
 * are pinned to each other by a test.
 */
export type IncidentVerification = 'UNVERIFIED' | 'CORROBORATED' | 'VERIFIED' | 'DISPUTED' | 'FALSE_REPORT';

export const CORROBORATION_THRESHOLD = 2;

export function verificationFromCorroboration(
  current: IncidentVerification,
  corroborations: number
): IncidentVerification {
  // Never walk back a human verdict.
  if (current === 'VERIFIED' || current === 'DISPUTED' || current === 'FALSE_REPORT') return current;
  return corroborations >= CORROBORATION_THRESHOLD ? 'CORROBORATED' : 'UNVERIFIED';
}
