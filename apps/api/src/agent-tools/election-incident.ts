/**
 * Filing an election incident, as distinct from filing a service complaint.
 *
 * ── Why this is separate from `createTicket`'s own triage ───────────────────
 *
 * `createTicket` already triages well for a citizen-care platform: it tells an
 * emergency from a complaint, reads the report back before registering it, and
 * refuses to file without a number to reach somebody on. All of that is right
 * and none of it is touched here.
 *
 * What it cannot do is the four things an election situation room needs, each
 * of which would be wrong to bolt onto the service path:
 *
 *   1. CLUSTER. Twenty observers at one polling unit watching one ballot box
 *      carried off is one incident with twenty corroborations. The service path
 *      has no reason to deduplicate — two people reporting the same pothole
 *      really are two complaints, and each deserves its own answer.
 *   2. SEPARATE "DONE" FROM "TRUE". A service case is finished when the work is
 *      done. An election claim is published, so it needs a verification state
 *      that a resolution cannot imply.
 *   3. ESCALATE IN MINUTES. The service charter measures in days.
 *   4. FILE ANYWAY. If classification fails under load, a pothole can wait for
 *      a human to categorise it. A report of violence cannot.
 */
import { prisma } from '@ace/database';
import {
  classifyIncident,
  clusterKeyFor,
  normaliseUnitCode,
  resolveLga,
  resolvePollingUnit,
  type PollingUnitResolution,
  dueAtFor,
  incidentType as lookupIncidentType,
  severityFor,
  verificationFromCorroboration,
  type IncidentVerification,
  type Severity,
} from '@ace/database';
import { AceLogger } from '../config/logger';

const log = new AceLogger('ElectionIncident');

export interface ElectionIncidentInput {
  /** What the reporter said, for keyword classification. */
  text: string;
  /** An explicit type from the agent, which wins over classification. */
  incidentType?: string | null;
  isOngoing?: boolean | null;
  victimsOrInjuries?: string | null;
  occurredAt?: Date | null;
  pollingUnitCode?: string | null;
}

export interface ElectionIncidentFields {
  incidentType: string;
  severity: Severity;
  dueAt: Date;
  clusterKey: string | null;
  /** True when nothing could be classified and a human must look. */
  needsClassification: boolean;
}

/**
 * Work out the election fields for a report, never failing.
 *
 * On no match the type is `other_election_incident` and
 * `needsClassification` is set — the report is filed, with an honest marker
 * that nobody has decided what it is yet. That is the capture-first rule: on
 * election day the cost of a misfiled report is a human sorting it out later,
 * and the cost of a lost one is unbounded.
 */
export function electionIncidentFields(input: ElectionIncidentInput): ElectionIncidentFields {
  const stated = lookupIncidentType(input.incidentType);
  const guessed = stated ? null : classifyIncident(input.text);
  const resolved = stated ?? guessed;

  const typeId = resolved?.id ?? 'other_election_incident';
  const severity = severityFor(typeId, {
    isOngoing: input.isOngoing ?? null,
    victimsOrInjuries: input.victimsOrInjuries ?? null,
  });

  return {
    incidentType: typeId,
    severity,
    dueAt: dueAtFor(severity, new Date()),
    clusterKey: clusterKeyFor(input.pollingUnitCode, typeId, input.occurredAt ?? new Date()),
    needsClassification: !resolved,
  };
}

export interface CorroborationOutcome {
  /** The report this one corroborates, when it is not the first. */
  ticketId: string;
  ticketNumber: string;
  corroborations: number;
  verification: IncidentVerification;
}

/**
 * Attach this report to an existing incident at the same unit, or return null
 * if it is the first.
 *
 * Deliberately does NOT merge the reporters' words: each caller's own account
 * is recorded as a `CaseEvent` on the incident, because an incident with
 * twenty corroborations and one narrative has thrown away nineteen witness
 * statements. What is merged is the COUNT, and the count is what raises the
 * claim from UNVERIFIED to CORROBORATED.
 *
 * A second report from the SAME contact does not corroborate anything — one
 * person reporting twice is one witness, and counting it twice is the easiest
 * way to manufacture a false consensus.
 */
export async function corroborateExisting(
  organizationId: string,
  clusterKey: string | null,
  reporter: { contactId: string; account: string },
): Promise<CorroborationOutcome | null> {
  if (!clusterKey) return null;

  try {
    const existing = await prisma.ticket.findFirst({
      where: { organizationId, clusterKey },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, ticketNumber: true, corroborations: true, verification: true, contactId: true,
        events: { where: { type: 'CORROBORATION' }, select: { body: true } },
      },
    });
    if (!existing) return null;

    // Has this reporter already been counted on this incident?
    const alreadyCounted =
      existing.contactId === reporter.contactId ||
      existing.events.some((e) => (e.body ?? '').includes(`contact:${reporter.contactId}`));

    let corroborations = existing.corroborations;
    let verification = existing.verification as IncidentVerification;

    if (!alreadyCounted) {
      // `{ increment: 1 }`, not `corroborations + 1` computed here.
      //
      // The surge test fired 60 reports at one unit and logged 38
      // corroborations, of which only 5 were counted: every request read the
      // same number, added one, and wrote the same result, so 33 increments
      // were silently lost. A count that undercounts is worse than no count,
      // because it is the signal that raises a claim to CORROBORATED.
      //
      // Postgres does the addition, so simultaneous increments all land, and
      // the row that comes back carries the true total.
      const [updated] = await prisma.$transaction([
        prisma.ticket.update({
          where: { id: existing.id },
          data: { corroborations: { increment: 1 } },
          select: { corroborations: true, verification: true },
        }),
        prisma.caseEvent.create({
          data: {
            organizationId,
            ticketId: existing.id,
            type: 'CORROBORATION',
            actorLabel: 'system:assistant',
            // The reporter's own account, kept whole. `contact:<id>` is how a
            // repeat report from the same person is recognised.
            body: `contact:${reporter.contactId}\n${reporter.account}`,
          },
        }),
      ]);

      corroborations = updated.corroborations;
      verification = verificationFromCorroboration(
        updated.verification as IncidentVerification,
        corroborations,
      );

      // Written separately, from the count Postgres actually arrived at. Racing
      // writers converge here because the transition is monotonic — once a
      // claim is CORROBORATED, nothing in this function moves it back.
      if (verification !== updated.verification) {
        await prisma.ticket
          .update({ where: { id: existing.id }, data: { verification: verification as any } })
          .catch(() => {});
      }
    }

    log.info('incident_corroborated', {
      organizationId,
      ticketId: existing.id,
      clusterKey,
      corroborations,
      verification,
      alreadyCounted,
    });

    return {
      ticketId: existing.id,
      ticketNumber: existing.ticketNumber,
      corroborations,
      verification,
    };
  } catch (err: any) {
    // A failure to cluster must not stop the report being filed on its own.
    log.warn('corroboration_failed', { organizationId, clusterKey, error: String(err?.message ?? err) });
    return null;
  }
}

/**
 * What the agent says to a reporter whose report corroborated an existing one.
 *
 * Says plainly that others have reported it, because that is true and it is
 * what a reporter wants to know — and gives them the SAME reference as the
 * other reporters, so a situation room following up reaches one incident and
 * not twenty threads. It does not say the incident is confirmed: corroboration
 * is not verification.
 */
export function corroborationReply(outcome: CorroborationOutcome, spokenReference: string): string {
  return (
    `Thank you. Others have reported this from the same polling unit, so I have added your account to that ` +
    `report rather than opening a second one. The reference is ${spokenReference}. I repeat, ${spokenReference}. ` +
    `It now has ${outcome.corroborations} independent reports and the team is looking at it.`
  );
}

/**
 * Whether to skip reading the report back to the reporter.
 *
 * The script reads a report back and waits for a yes before registering it,
 * which is right for a complaint and can be dangerous here. An election
 * reporter may be standing a few feet from the people they are reporting, and
 * an assistant reciting "you said armed men are snatching ballot boxes at
 * Unit 012" out loud can be overheard.
 *
 * So it is skipped in exactly two cases, both of which mean the reporter is
 * probably still at the scene:
 *
 *   - they asked for it to be skipped, or
 *   - the incident is still happening.
 *
 * And NOT merely because the incident is a serious one. "Gunmen attacked our
 * village last night" is a SAFETY report of the gravest kind, but the reporter
 * is not standing in it, nobody is about to overhear them, and the read-back is
 * the only thing standing between a half-heard detail and a case file an
 * officer acts on. Severity is not a proxy for danger-to-the-reporter-now;
 * being there is. An earlier version of this function skipped on the SAFETY
 * group and on CRITICAL severity, which silently removed the read-back from
 * every report of past violence.
 */
export function shouldSkipReadBack(
  fields: ElectionIncidentFields,
  opts: { reporterAsked?: boolean | null; isOngoing?: boolean | null } = {},
): boolean {
  void fields;
  return !!opts.reporterAsked || !!opts.isOngoing;
}

/** A confirmation that names no detail, for a reporter who may be overheard. */
export function discreetReply(spokenReference: string): string {
  return (
    `Thank you, that is recorded and flagged to the team now. Your reference is ${spokenReference}. ` +
    `I repeat, ${spokenReference}. I will not read the details back. If you are not safe, please move ` +
    `somewhere safe and call 1 1 2.`
  );
}


/**
 * Whether a failed create lost the race for a cluster.
 *
 * `@@unique([organizationId, clusterKey])` is what stops twenty simultaneous
 * reporters at one polling unit becoming twenty incidents. Exactly one insert
 * wins; the rest raise P2002 on that constraint, and each of those is not an
 * error — it is a report that should have been a corroboration all along, and
 * would have been if it had arrived a millisecond later.
 *
 * Checked narrowly: a P2002 on any other field (`ticketNumber`) is a different
 * problem with its own retry, and swallowing it here would hide it.
 */
export function isClusterConflict(err: any): boolean {
  if (err?.code !== 'P2002') return false;
  const target = err?.meta?.target;
  const fields: string[] = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return fields.some((f) => String(f).toLowerCase().includes('clusterkey'));
}


/**
 * Resolve what a reporter said into a polling unit from the loaded register.
 *
 * Reads the register narrowed to the LGA, because a unit NAME is not unique
 * across a State — "CENTRAL PRIMARY SCHOOL" exists in most LGAs, and picking
 * the first would file an incident in the wrong Local Government Area. A code
 * is unique and skips all of that.
 *
 * Never blocks a report. Every miss comes back with the reporter's own words
 * intact so the caller can file anyway and attach the unit later: the register
 * is a snapshot, units move between elections, and a reporter standing at one
 * watching something happen must not be turned away because our reference data
 * is behind.
 */
export async function resolveUnitFromRegister(
  said: { code?: string | null; name?: string | null; lga?: string | null; registrationArea?: string | null },
): Promise<PollingUnitResolution> {
  const code = normaliseUnitCode(said.code);

  // A code needs no narrowing and no name matching.
  if (code) {
    const unit = await prisma.pollingUnit.findUnique({ where: { code } });
    if (unit) return { ok: true, unit };
    // A code that is not in the register is worth saying: it may be a new unit,
    // or the register may be stale, and either way nobody should guess.
    return { ok: false, reason: 'no_match', said: said.code ?? undefined };
  }

  const name = (said.name ?? '').trim();
  if (!name) return { ok: false, reason: 'nothing_said' };

  const lga = said.lga ? resolveLga(said.lga) : null;
  const pool = await prisma.pollingUnit.findMany({
    where: lga ? { lga } : {},
    // Bounded: an unnarrowed query over a State's whole register, per report,
    // is the sort of thing that works until election day.
    take: lga ? 2_000 : 500,
  });
  return resolvePollingUnit(pool, name, { lga, registrationArea: said.registrationArea ?? null });
}
