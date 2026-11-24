/**
 * Matching an incoming report to an accredited reporter.
 *
 * ── What this is for, and what it is NOT ────────────────────────────────────
 *
 * A situation room needs to tell a trained observer standing at their assigned
 * polling unit from an anonymous caller repeating something they heard. Both
 * reports are worth having. They are not the same evidence, and a briefing that
 * treats them identically is one rumour away from being wrong in public.
 *
 * **This is not authentication.** A phone number is not a credential — handsets
 * are shared, lent, and stolen, and an observer whose phone dies will call from
 * a colleague's. So matching RAISES CONFIDENCE and RECORDS A DEPLOYMENT. It
 * never grants a privilege, never refuses a report, and nothing downstream may
 * treat `ACCREDITED` as proof of who was speaking.
 *
 * The consequences of a match are deliberately small:
 *   - the report is marked ACCREDITED rather than PUBLIC;
 *   - accredited corroborations are counted separately, because two accredited
 *     observers is a finding and two anonymous tips is a lead;
 *   - a report from outside the reporter's deployment is NOTED, not refused,
 *     because observers get moved and the ones who move are often the ones
 *     following the trouble.
 */
import { prisma } from '@ace/database';
import { resolveLga } from '@ace/database';
import { AceLogger } from '../config/logger';

const log = new AceLogger('AccreditedReporter');

export type ReporterKind = 'ACCREDITED' | 'PUBLIC' | 'UNKNOWN';

export interface ReporterMatch {
  kind: ReporterKind;
  reporterId: string | null;
  /** For the case note; never spoken to the caller. */
  label: string | null;
  /** True when they reported from outside where they were deployed. */
  awayFromDeployment: boolean;
  deployment: { lga: string | null; registrationArea: string | null; pollingUnitCode: string | null } | null;
}

const UNMATCHED: ReporterMatch = {
  kind: 'UNKNOWN',
  reporterId: null,
  label: null,
  awayFromDeployment: false,
  deployment: null,
};

/** Last 9 digits, which is what survives +234 / 0 / 234 being written three ways. */
function tail(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/**
 * Match a caller to the roster, by phone and then by the code they read out.
 *
 * Returns UNKNOWN rather than PUBLIC when there is no roster at all: "this is
 * a member of the public" is a claim, and before anyone has been accredited it
 * is not one we can make. Once a roster exists, an unmatched caller is PUBLIC.
 *
 * Never throws: a roster lookup that fails must not stop a report being filed.
 */
export async function matchReporter(
  organizationId: string,
  said: { phoneNumber?: string | null; reporterCode?: string | null; lga?: string | null; pollingUnitCode?: string | null },
): Promise<ReporterMatch> {
  try {
    const rosterSize = await prisma.accreditedReporter.count({
      where: { organizationId, active: true },
    });
    if (rosterSize === 0) return UNMATCHED;

    const code = (said.reporterCode ?? '').trim().toUpperCase();
    let row = code
      ? await prisma.accreditedReporter.findFirst({
          where: { organizationId, active: true, code: { equals: code, mode: 'insensitive' } },
        })
      : null;

    if (!row) {
      const last9 = tail(said.phoneNumber);
      if (last9) {
        // `endsWith` on the stored number: a roster loaded as 0803… and a call
        // arriving as +234803… are the same person, and requiring one format
        // would silently mark half the roster as members of the public.
        row = await prisma.accreditedReporter.findFirst({
          where: { organizationId, active: true, phoneNumber: { endsWith: last9 } },
        });
      }
    }

    if (!row) return { ...UNMATCHED, kind: 'PUBLIC' };

    const deployment = {
      lga: row.deployedLga ?? null,
      registrationArea: row.deployedRegistrationArea ?? null,
      pollingUnitCode: row.deployedPollingUnitCode ?? null,
    };

    // Reported from somewhere other than where they were sent. Noted only.
    const saidLga = said.lga ? resolveLga(said.lga) : null;
    const deployedLga = deployment.lga ? resolveLga(deployment.lga) : null;
    const awayFromDeployment = Boolean(
      (deployment.pollingUnitCode && said.pollingUnitCode && deployment.pollingUnitCode !== said.pollingUnitCode) ||
        (!deployment.pollingUnitCode && deployedLga && saidLga && deployedLga !== saidLga),
    );

    return {
      kind: 'ACCREDITED',
      reporterId: row.id,
      label: `${row.fullName} (${row.code}, ${row.role.toLowerCase()})`,
      awayFromDeployment,
      deployment,
    };
  } catch (err: any) {
    log.warn('reporter_match_failed', { organizationId, error: String(err?.message ?? err) });
    return UNMATCHED;
  }
}

/**
 * A line for the case file when a reporter is accredited.
 *
 * Goes in the record, never in what the assistant says: reading an observer's
 * name and code back to them confirms, out loud and possibly within earshot,
 * that the person calling is an accredited observer. In a contested election
 * that is information worth having for the wrong people.
 */
export function deploymentNote(match: ReporterMatch): string | null {
  if (match.kind !== 'ACCREDITED') return null;
  const where = match.deployment?.pollingUnitCode
    ? `unit ${match.deployment.pollingUnitCode}`
    : match.deployment?.lga
      ? `${match.deployment.lga} LGA`
      : 'no recorded deployment';
  return (
    `Accredited reporter: ${match.label}. Deployed to ${where}.` +
    (match.awayFromDeployment
      ? ' REPORTED FROM OUTSIDE THEIR DEPLOYMENT — not a problem in itself (observers move, and the ones who move are often following the trouble), but worth a glance.'
      : '')
  );
}
