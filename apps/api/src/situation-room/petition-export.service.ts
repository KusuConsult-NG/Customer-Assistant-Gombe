/**
 * The bundle a lawyer files.
 *
 * ── Why this is not "export to CSV" ────────────────────────────────────────
 *
 * An election petition is argued polling unit by polling unit, inside a
 * statutory window that starts when a result is declared. What a tribunal asks
 * for is not a spreadsheet of incidents; it is, for one unit: what was alleged,
 * who alleged it, when they said it happened, and the evidence — with something
 * that shows the file produced in court is the file that arrived.
 *
 * So a bundle is per unit, it carries the SHA-256 of every file, and it states
 * plainly what each claim's verification status is. That last part is the one a
 * careless export gets wrong: handing a lawyer forty UNVERIFIED reports in the
 * same shape as four VERIFIED ones invites them to file all forty, and the four
 * good ones are then argued alongside thirty-six they cannot stand up.
 *
 * Exporting also places a LEGAL HOLD, because the retention job deletes on an
 * age rule that knows nothing about a filing window.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@ace/database';
import { incidentType } from '@ace/database';
import { placeLegalHold } from '../common/evidence';
import { AceLogger } from '../config/logger';

const log = new AceLogger('PetitionExport');

@Injectable()
export class PetitionExportService {
  /**
   * Everything held about one polling unit, with hashes.
   *
   * `hold` defaults to true: the normal reason to export is that somebody is
   * considering a petition, and that is exactly when deletion must stop.
   */
  async bundleForUnit(
    organizationId: string,
    pollingUnitCode: string,
    opts: { hold?: boolean; reason?: string; actorLabel?: string } = {},
  ) {
    const unit = await prisma.pollingUnit.findUnique({ where: { code: pollingUnitCode } });

    const incidents = await prisma.ticket.findMany({
      where: { organizationId, pollingUnitCode },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, ticketNumber: true, subject: true, description: true, summary: true,
        incidentType: true, severity: true, verification: true, verificationNote: true,
        corroborations: true, accreditedCorroborations: true, reporterKind: true,
        lga: true, registrationArea: true, pollingUnitName: true,
        latitude: true, longitude: true, createdAt: true, caseStage: true,
        isAnonymous: true, legalHold: true,
        accreditedReporter: { select: { code: true, fullName: true, role: true, deployedPollingUnitCode: true } },
        events: {
          where: { type: 'CORROBORATION' },
          orderBy: { createdAt: 'asc' },
          select: { body: true, createdAt: true },
        },
        evidence: {
          select: {
            id: true, kind: true, mimeType: true, byteSize: true, sha256: true,
            storagePath: true, capturedAt: true, receivedAt: true,
            latitude: true, longitude: true, derivedText: true, channel: true,
          },
        },
      },
    });

    if (incidents.length === 0) {
      throw new NotFoundException(`No incidents recorded for polling unit ${pollingUnitCode}.`);
    }

    if (opts.hold !== false) {
      await placeLegalHold(organizationId, {
        ticketIds: incidents.map((i) => i.id),
        reason: opts.reason?.trim() || `Exported for a petition bundle on ${new Date().toISOString().slice(0, 10)}`,
      });
    }

    const evidenceCount = incidents.reduce((n, i) => n + i.evidence.length, 0);

    log.info('petition_bundle_exported', {
      organizationId, pollingUnitCode,
      incidents: incidents.length, evidence: evidenceCount,
      heldFromDeletion: opts.hold !== false,
      by: opts.actorLabel ?? 'unknown',
    });

    return {
      pollingUnit: unit
        ? { code: unit.code, name: unit.name, lga: unit.lga, registrationArea: unit.registrationArea }
        : {
            code: pollingUnitCode,
            name: incidents[0].pollingUnitName,
            lga: incidents[0].lga,
            registrationArea: incidents[0].registrationArea,
            note: "This code is not in the loaded polling unit register. It may be a new or relocated unit, or the register may be stale — confirm with INEC before filing.",
          },

      exportedAt: new Date().toISOString(),
      heldFromDeletion: opts.hold !== false,

      /**
       * Read this before filing anything below.
       */
      readThisFirst: [
        'VERIFICATION IS NOT UNIFORM. Each incident states its own status. UNVERIFIED means one report and nobody checked. CORROBORATED means independent reports agreed, which is not the same as anyone having checked. Only VERIFIED means a person reviewed the evidence and stood behind it.',
        'A SHA-256 is given for every file. It is what shows the copy produced is the copy that arrived; the files themselves are fetched from the evidence store by the paths below and must not be re-encoded, resized or stripped of metadata in transit.',
        'CORROBORATION COUNTS ARE REPORTS, NOT WITNESSES CONFIRMED. A repeat report from the same person is not counted, but an accredited observer and an anonymous tip both count as one here; `accreditedCorroborations` is stated separately for that reason.',
        'TIMES ARE WHEN WE WERE TOLD, not necessarily when it happened. `occurredAt` as described by the reporter is inside the report text; `createdAt` is when the report reached us.',
        'ANONYMOUS REPORTERS are marked. Their contact details are deliberately withheld from this bundle and must be requested separately, through whoever administers the platform.',
      ],

      summary: {
        incidents: incidents.length,
        evidenceFiles: evidenceCount,
        byVerification: {
          verified: incidents.filter((i) => i.verification === 'VERIFIED').length,
          corroborated: incidents.filter((i) => i.verification === 'CORROBORATED').length,
          unverified: incidents.filter((i) => i.verification === 'UNVERIFIED').length,
          disputed: incidents.filter((i) => i.verification === 'DISPUTED').length,
          false: incidents.filter((i) => i.verification === 'FALSE_REPORT').length,
        },
      },

      incidents: incidents.map((i) => ({
        reference: i.ticketNumber,
        incidentType: i.incidentType,
        incidentLabel: incidentType(i.incidentType)?.label ?? i.incidentType,
        severity: i.severity,

        verification: i.verification,
        verificationNote: i.verificationNote,
        corroborations: i.corroborations,
        accreditedCorroborations: i.accreditedCorroborations,

        reportedBy: i.isAnonymous
          ? { kind: 'ANONYMOUS', note: 'Reporter asked not to be identified. Contact details withheld from this bundle.' }
          : i.accreditedReporter
            ? {
                kind: 'ACCREDITED',
                code: i.accreditedReporter.code,
                name: i.accreditedReporter.fullName,
                role: i.accreditedReporter.role,
                deployedTo: i.accreditedReporter.deployedPollingUnitCode,
                note: 'Matched to the accreditation roster by telephone number or code. That is not proof of identity: handsets are shared and lent.',
              }
            : { kind: i.reporterKind },

        reportedAt: i.createdAt.toISOString(),
        /** The reporter's own words, unedited. */
        account: i.description,
        /** The read-back the reporter confirmed, where there was one. */
        confirmedSummary: i.summary,
        caseStage: i.caseStage,
        location: {
          lga: i.lga,
          registrationArea: i.registrationArea,
          pollingUnitName: i.pollingUnitName,
          latitude: i.latitude,
          longitude: i.longitude,
        },

        /** Each further reporter's own account, kept whole. */
        furtherAccounts: i.events.map((e) => ({
          at: e.createdAt.toISOString(),
          // The `contact:<id>` marker is internal; strip it from a filing.
          account: (e.body ?? '').replace(/^contact:[0-9a-f-]+\n?/i, ''),
        })),

        evidence: i.evidence.map((e) => ({
          id: e.id,
          kind: e.kind,
          mimeType: e.mimeType,
          byteSize: e.byteSize,
          sha256: e.sha256,
          storagePath: e.storagePath,
          channel: e.channel,
          capturedAt: e.capturedAt?.toISOString() ?? null,
          receivedAt: e.receivedAt.toISOString(),
          latitude: e.latitude,
          longitude: e.longitude,
          modelDescription: e.derivedText,
          descriptionCaveat: e.derivedText
            ? 'This is a machine description of the file, produced to make it searchable. It is not a finding and must not be filed as one. The file is the evidence.'
            : null,
        })),
      })),
    };
  }

  /** Which units have anything to file, so somebody can decide where to start. */
  async unitsWithIncidents(organizationId: string) {
    const rows = await prisma.ticket.groupBy({
      by: ['pollingUnitCode', 'lga', 'registrationArea'],
      where: { organizationId, incidentType: { not: null }, pollingUnitCode: { not: null } },
      _count: { _all: true },
      _max: { severity: true },
    });
    return rows
      .map((r) => ({
        pollingUnitCode: r.pollingUnitCode,
        lga: r.lga,
        registrationArea: r.registrationArea,
        incidents: r._count._all,
      }))
      .sort((a, b) => b.incidents - a.incidents);
  }
}
