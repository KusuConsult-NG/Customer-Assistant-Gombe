/**
 * The numbers a situation room briefs on, and the bundle a lawyer files.
 *
 * ── The number everyone forgets ─────────────────────────────────────────────
 *
 * A map of incidents tells you where reports CAME FROM. It does not tell you
 * what is happening, and the difference is the most common way election
 * observation misleads.
 *
 * Three incidents in Akko and three in Nafada look alike on a map. If Akko has
 * 468 polling units and 40 observers deployed, and Nafada has 131 units and
 * four observers, those are not comparable numbers — and if a whole
 * Registration Area has reported NOTHING, that is either a quiet ward or an
 * area nobody is covering, and a situation room cannot tell which from a map.
 *
 * So every count here is reported against its denominator, and SILENCE IS
 * REPORTED AS A FINDING rather than left as blank space.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@ace/database';
import { INCIDENT_TYPES, incidentType } from '@ace/database';

export interface SituationRoomQuery {
  /** Only incidents since this time. Defaults to the last 24 hours. */
  since?: Date;
  lga?: string | null;
}

@Injectable()
export class SituationRoomService {
  /**
   * The live picture, aggregated.
   *
   * One pass over the incidents in the window; the per-LGA denominators come
   * from the polling unit register.
   */
  async overview(organizationId: string, q: SituationRoomQuery = {}) {
    const since = q.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    const incidents = await prisma.ticket.findMany({
      where: {
        organizationId,
        incidentType: { not: null },
        createdAt: { gte: since },
        ...(q.lga ? { lga: q.lga } : {}),
      },
      select: {
        id: true, ticketNumber: true, incidentType: true, severity: true, verification: true,
        corroborations: true, accreditedCorroborations: true, reporterKind: true,
        lga: true, registrationArea: true, pollingUnitCode: true, pollingUnitName: true,
        latitude: true, longitude: true, createdAt: true, dueAt: true, caseStage: true,
        needsClassification: true, legalHold: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Denominators: how much of the State there is to hear from.
    const register = await prisma.pollingUnit.groupBy({
      by: ['lga'],
      _count: { _all: true },
      ...(q.lga ? { where: { lga: q.lga } } : {}),
    });
    const unitsPerLga = new Map(register.map((r) => [r.lga, r._count._all]));
    const registerLoaded = register.reduce((n, r) => n + r._count._all, 0);

    const reportingUnits = new Set(incidents.map((i) => i.pollingUnitCode).filter(Boolean) as string[]);

    const byLga = new Map<string, {
      lga: string; incidents: number; units: number; unitsReporting: number;
      critical: number; verified: number; corroborated: number; unverified: number;
      accreditedReports: number; publicReports: number;
    }>();
    for (const [lga, units] of unitsPerLga) {
      byLga.set(lga, {
        lga, incidents: 0, units, unitsReporting: 0,
        critical: 0, verified: 0, corroborated: 0, unverified: 0,
        accreditedReports: 0, publicReports: 0,
      });
    }

    const unitsReportingPerLga = new Map<string, Set<string>>();
    const byType = new Map<string, number>();
    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;

    const now = Date.now();
    let overdue = 0;

    for (const i of incidents) {
      byType.set(i.incidentType!, (byType.get(i.incidentType!) ?? 0) + 1);
      if (i.severity) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      if (i.dueAt && i.dueAt.getTime() < now && !['RESOLVED', 'CLOSED'].includes(i.caseStage)) overdue++;

      const lga = i.lga ?? 'not stated';
      if (!byLga.has(lga)) {
        byLga.set(lga, {
          lga, incidents: 0, units: unitsPerLga.get(lga) ?? 0, unitsReporting: 0,
          critical: 0, verified: 0, corroborated: 0, unverified: 0,
          accreditedReports: 0, publicReports: 0,
        });
      }
      const row = byLga.get(lga)!;
      row.incidents++;
      if (i.severity === 'CRITICAL') row.critical++;
      if (i.verification === 'VERIFIED') row.verified++;
      else if (i.verification === 'CORROBORATED') row.corroborated++;
      else if (i.verification === 'UNVERIFIED') row.unverified++;
      row.accreditedReports += i.accreditedCorroborations;
      row.publicReports += Math.max(0, i.corroborations - i.accreditedCorroborations);

      if (i.pollingUnitCode) {
        if (!unitsReportingPerLga.has(lga)) unitsReportingPerLga.set(lga, new Set());
        unitsReportingPerLga.get(lga)!.add(i.pollingUnitCode);
      }
    }
    for (const [lga, units] of unitsReportingPerLga) {
      const row = byLga.get(lga);
      if (row) row.unitsReporting = units.size;
    }

    return {
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),

      incidents: {
        total: incidents.length,
        bySeverity,
        byType: INCIDENT_TYPES.filter((t) => byType.has(t.id)).map((t) => ({
          id: t.id, label: t.label, group: t.group, count: byType.get(t.id)!,
        })),
        unclassified: incidents.filter((i) => i.needsClassification).length,
        overdue,
      },

      /**
       * How much of the State has been heard from. The headline number a
       * situation room should lead with, and the one a map hides.
       */
      coverage: {
        registerLoaded,
        unitsInRegister: registerLoaded,
        unitsReporting: reportingUnits.size,
        unitsSilent: Math.max(0, registerLoaded - reportingUnits.size),
        note: registerLoaded === 0
          ? "INEC's polling unit register is not loaded, so there is no denominator: these counts cannot be read as coverage. Run `npm run units:load`."
          : 'A silent unit is not the same as a quiet one. Check it against the observer deployment plan before reading anything into it.',
      },

      /**
       * Verification, stated separately from everything else, because this is
       * the distinction a briefing is most likely to collapse.
       */
      confidence: {
        verified: incidents.filter((i) => i.verification === 'VERIFIED').length,
        corroborated: incidents.filter((i) => i.verification === 'CORROBORATED').length,
        unverified: incidents.filter((i) => i.verification === 'UNVERIFIED').length,
        disputed: incidents.filter((i) => i.verification === 'DISPUTED').length,
        false: incidents.filter((i) => i.verification === 'FALSE_REPORT').length,
        corroboratedByAccredited: incidents.filter((i) => i.accreditedCorroborations >= 2).length,
        note: 'CORROBORATED means independent reports agreed, NOT that anyone checked. Only VERIFIED means a person reviewed the evidence.',
      },

      byLga: [...byLga.values()].sort((a, b) => b.incidents - a.incidents),

      /** For the map. Only incidents that have somewhere to be drawn. */
      points: incidents
        .filter((i) => typeof i.latitude === 'number' && typeof i.longitude === 'number')
        .map((i) => ({
          ticketNumber: i.ticketNumber,
          incidentType: i.incidentType,
          label: incidentType(i.incidentType)?.label ?? i.incidentType,
          severity: i.severity,
          verification: i.verification,
          lga: i.lga,
          pollingUnitCode: i.pollingUnitCode,
          latitude: i.latitude,
          longitude: i.longitude,
          at: i.createdAt.toISOString(),
        })),

      /**
       * Everything needing a person, soonest first. A CRITICAL incident past
       * its five minutes is the top of this list.
       */
      needsAttention: incidents
        .filter((i) => i.severity === 'CRITICAL' || (i.dueAt && i.dueAt.getTime() < now) || i.needsClassification)
        .slice(0, 50)
        .map((i) => ({
          ticketNumber: i.ticketNumber,
          why: i.needsClassification ? 'not classified' : i.severity === 'CRITICAL' ? 'critical' : 'overdue',
          incidentType: i.incidentType,
          severity: i.severity,
          lga: i.lga,
          pollingUnitCode: i.pollingUnitCode,
          dueAt: i.dueAt?.toISOString() ?? null,
          corroborations: i.corroborations,
          accreditedCorroborations: i.accreditedCorroborations,
        })),
    };
  }

  /**
   * Which Registration Areas have reported nothing.
   *
   * Separate from `overview` because it answers a different question and the
   * answer is a list of places to telephone, not a statistic. An RA with
   * observers and no reports is the single most actionable thing a situation
   * room can look at an hour after polls open.
   */
  async silentAreas(organizationId: string, since?: Date) {
    const from = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    const areas = await prisma.pollingUnit.groupBy({
      by: ['lga', 'registrationArea'],
      _count: { _all: true },
    });
    if (areas.length === 0) {
      return {
        registerLoaded: false,
        note: "INEC's polling unit register is not loaded, so silence cannot be measured. Run `npm run units:load`.",
        areas: [],
      };
    }

    const heard = await prisma.ticket.findMany({
      where: { organizationId, incidentType: { not: null }, createdAt: { gte: from } },
      select: { lga: true, registrationArea: true, pollingUnitCode: true },
    });
    const heardAreas = new Set(heard.map((h) => `${h.lga}|${h.registrationArea}`));
    const heardUnits = new Set(heard.map((h) => h.pollingUnitCode).filter(Boolean) as string[]);

    const deployments = await prisma.accreditedReporter.findMany({
      where: { organizationId, active: true },
      select: { deployedLga: true, deployedRegistrationArea: true, deployedPollingUnitCode: true },
    });
    const deployedAreas = new Set(
      deployments.map((d) => `${d.deployedLga ?? ''}|${d.deployedRegistrationArea ?? ''}`),
    );

    return {
      registerLoaded: true,
      since: from.toISOString(),
      note:
        'An area with observers deployed and nothing reported is worth a telephone call. ' +
        'An area with nobody deployed is a coverage gap, not quiet.',
      areas: areas
        .filter((a) => !heardAreas.has(`${a.lga}|${a.registrationArea}`))
        .map((a) => ({
          lga: a.lga,
          registrationArea: a.registrationArea,
          unitsInArea: a._count._all,
          unitsHeardFrom: 0,
          observersDeployed: deployedAreas.has(`${a.lga}|${a.registrationArea}`),
        }))
        .sort((x, y) => Number(y.observersDeployed) - Number(x.observersDeployed) || y.unitsInArea - x.unitsInArea),
      unitsHeardFrom: heardUnits.size,
    };
  }
}
