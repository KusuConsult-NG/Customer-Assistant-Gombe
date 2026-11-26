import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccreditedRole,
  GOMBE_LGAS,
  ResultStatus,
  evaluateResultIntegrity,
  normaliseUnitCode,
  normalizePhoneNumber,
  normalizeVotesByParty,
  prisma,
  resolveLga,
} from '@ace/database';

const VALID_ROLES = new Set<AccreditedRole>(['OBSERVER', 'COORDINATOR', 'LAWYER', 'MEDIA']);

function cleanPhone(raw: string): string {
  const e164 = normalizePhoneNumber(raw);
  if (e164) return e164;
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return `+${digits}`;
  return String(raw || '').trim();
}

export interface UpsertReporterInput {
  code?: string;
  fullName: string;
  phoneNumber: string;
  role?: AccreditedRole;
  deployedLga?: string | null;
  deployedRegistrationArea?: string | null;
  deployedPollingUnitCode?: string | null;
  note?: string | null;
}

export interface CheckInInput {
  pollingUnitCode: string;
  reporterId?: string | null;
  reporterCode?: string | null;
  milestone:
    | 'AGENT_ARRIVED'
    | 'MATERIALS_ARRIVED'
    | 'VOTING_STARTED'
    | 'VOTING_CLOSED'
    | 'COUNTING_COMPLETED'
    | 'EC8A_SUBMITTED'
    | 'IREV_UPLOADED';
  bvasWorking?: boolean;
  accreditedVotersCount?: number;
  channel?: string;
  notes?: string;
}

export interface SubmitResultInput {
  pollingUnitCode: string;
  accreditedVoters: number;
  votesByParty: Record<string, number>;
  validVotes?: number;
  rejectedVotes?: number;
  totalVotesCast?: number;
  ec8aEvidenceId?: string | null;
  submittedByReporterId?: string | null;
  submittedByUserId?: string | null;
  channel?: string;
  notes?: string | null;
}

@Injectable()
export class CampaignOpsService {
  // ── 1. Accredited Party Agent & Coordinator Roster ────────────────────────

  async listReporters(
    organizationId: string,
    opts?: { lga?: string | null; role?: string | null; activeOnly?: boolean; search?: string | null },
  ) {
    const where: any = { organizationId };
    if (opts?.activeOnly !== false) where.active = true;
    if (opts?.lga) {
      const canonical = resolveLga(opts.lga);
      where.deployedLga = canonical || opts.lga;
    }
    if (opts?.role && VALID_ROLES.has(opts.role as AccreditedRole)) {
      where.role = opts.role;
    }
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { phoneNumber: { contains: q } },
        { deployedPollingUnitCode: { contains: q, mode: 'insensitive' } },
        { deployedRegistrationArea: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [reporters, totalUnits, assignedUnits] = await Promise.all([
      prisma.accreditedReporter.findMany({
        where,
        orderBy: [{ deployedLga: 'asc' }, { deployedRegistrationArea: 'asc' }, { code: 'asc' }],
        take: 1000,
      }),
      prisma.pollingUnit.count(),
      prisma.accreditedReporter.findMany({
        where: { organizationId, active: true, deployedPollingUnitCode: { not: null } },
        select: { deployedPollingUnitCode: true },
        distinct: ['deployedPollingUnitCode'],
      }),
    ]);

    return {
      reporters,
      summary: {
        totalShown: reporters.length,
        totalPollingUnits: totalUnits,
        coveredPollingUnits: assignedUnits.length,
        uncoveredPollingUnits: Math.max(0, totalUnits - assignedUnits.length),
      },
    };
  }

  async upsertReporter(organizationId: string, input: UpsertReporterInput) {
    const fullName = String(input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new BadRequestException('Reporter fullName must be at least 2 characters.');
    }
    const phoneNumber = cleanPhone(input.phoneNumber);
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      throw new BadRequestException('A valid phone number is required.');
    }

    const role: AccreditedRole =
      input.role && VALID_ROLES.has(input.role) ? input.role : 'OBSERVER';

    let deployedLga = input.deployedLga ? resolveLga(input.deployedLga) ?? input.deployedLga.trim() : null;
    let deployedRegistrationArea = input.deployedRegistrationArea?.trim() || null;
    let deployedPollingUnitCode: string | null = null;

    if (input.deployedPollingUnitCode?.trim()) {
      const norm = normaliseUnitCode(input.deployedPollingUnitCode);
      const unit = norm ? await prisma.pollingUnit.findUnique({ where: { code: norm } }) : null;
      if (!unit) {
        throw new BadRequestException(
          `Polling unit "${input.deployedPollingUnitCode}" was not found in Gombe's 2,988-unit register.`,
        );
      }
      deployedPollingUnitCode = unit.code;
      deployedLga = unit.lga;
      deployedRegistrationArea = unit.registrationArea;
    } else if (deployedLga && !GOMBE_LGAS.includes(deployedLga as any)) {
      throw new BadRequestException(
        `LGA "${input.deployedLga}" is not one of Gombe State's 11 LGAs.`,
      );
    }

    const code =
      input.code?.trim().toUpperCase() ||
      `GM-${phoneNumber.replace(/\D/g, '').slice(-6)}`;

    const existing = await prisma.accreditedReporter.findFirst({
      where: { organizationId, OR: [{ phoneNumber }, { code }] },
    });

    if (existing) {
      return prisma.accreditedReporter.update({
        where: { id: existing.id },
        data: {
          code,
          fullName,
          phoneNumber,
          role,
          deployedLga,
          deployedRegistrationArea,
          deployedPollingUnitCode,
          active: true,
          withdrawnAt: null,
          withdrawnReason: null,
          note: input.note?.trim() || existing.note,
        },
      });
    }

    return prisma.accreditedReporter.create({
      data: {
        organizationId,
        code,
        fullName,
        phoneNumber,
        role,
        deployedLga,
        deployedRegistrationArea,
        deployedPollingUnitCode,
        note: input.note?.trim() || null,
      },
    });
  }

  async bulkImportReporters(
    organizationId: string,
    rows: UpsertReporterInput[],
    dryRun = false,
  ) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Provide at least one reporter row to import.');
    }
    if (rows.length > 3500) {
      throw new BadRequestException('Import batch is capped at 3,500 rows per request.');
    }

    const units = await prisma.pollingUnit.findMany({
      select: { code: true, lga: true, registrationArea: true },
    });
    const unitByCode = new Map(units.map((u) => [u.code, u]));

    const accepted: Array<Required<Pick<UpsertReporterInput, 'code' | 'fullName' | 'phoneNumber' | 'role'>> & {
      deployedLga: string | null;
      deployedRegistrationArea: string | null;
      deployedPollingUnitCode: string | null;
      note: string | null;
    }> = [];
    const rejected: Array<{ row: number; reason: string; input: UpsertReporterInput }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fullName = String(r?.fullName || '').trim();
      const phoneNumber = cleanPhone(r?.phoneNumber || '');
      if (fullName.length < 2) {
        rejected.push({ row: i + 1, reason: 'Missing or too-short fullName', input: r });
        continue;
      }
      if (phoneNumber.replace(/\D/g, '').length < 10) {
        rejected.push({ row: i + 1, reason: 'Invalid phone number', input: r });
        continue;
      }
      const role: AccreditedRole =
        r.role && VALID_ROLES.has(r.role) ? r.role : 'OBSERVER';

      let deployedLga = r.deployedLga ? resolveLga(r.deployedLga) : null;
      let deployedRegistrationArea = r.deployedRegistrationArea?.trim() || null;
      let deployedPollingUnitCode: string | null = null;

      if (r.deployedPollingUnitCode?.trim()) {
        const norm = normaliseUnitCode(r.deployedPollingUnitCode);
        const unit = norm ? unitByCode.get(norm) : undefined;
        if (!unit) {
          rejected.push({
            row: i + 1,
            reason: `Unknown polling unit code "${r.deployedPollingUnitCode}"`,
            input: r,
          });
          continue;
        }
        deployedPollingUnitCode = unit.code;
        deployedLga = unit.lga;
        deployedRegistrationArea = unit.registrationArea;
      } else if (r.deployedLga && !deployedLga) {
        rejected.push({
          row: i + 1,
          reason: `Unknown Gombe LGA "${r.deployedLga}"`,
          input: r,
        });
        continue;
      }

      const code =
        r.code?.trim().toUpperCase() ||
        `GM-${String(i + 1).padStart(4, '0')}-${phoneNumber.replace(/\D/g, '').slice(-4)}`;

      accepted.push({
        code,
        fullName,
        phoneNumber,
        role,
        deployedLga,
        deployedRegistrationArea,
        deployedPollingUnitCode,
        note: r.note?.trim() || null,
      });
    }

    if (dryRun) {
      return {
        dryRun: true,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        rejected: rejected.slice(0, 50),
      };
    }

    let created = 0;
    let updated = 0;
    for (const item of accepted) {
      const existing = await prisma.accreditedReporter.findFirst({
        where: {
          organizationId,
          OR: [{ phoneNumber: item.phoneNumber }, { code: item.code }],
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.accreditedReporter.update({
          where: { id: existing.id },
          data: {
            ...item,
            active: true,
            withdrawnAt: null,
            withdrawnReason: null,
          },
        });
        updated++;
      } else {
        await prisma.accreditedReporter.create({
          data: { organizationId, ...item },
        });
        created++;
      }
    }

    return {
      dryRun: false,
      created,
      updated,
      rejectedCount: rejected.length,
      rejected: rejected.slice(0, 50),
    };
  }

  async revokeReporter(organizationId: string, id: string, reason?: string) {
    const existing = await prisma.accreditedReporter.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Accredited reporter not found.');

    return prisma.accreditedReporter.update({
      where: { id },
      data: {
        active: false,
        withdrawnAt: new Date(),
        withdrawnReason: reason?.trim() || 'Revoked by Situation Room administrator',
      },
    });
  }

  // ── 2. Election-Day Polling Unit Check-In & Milestone Matrix ──────────────

  async recordCheckIn(organizationId: string, input: CheckInInput) {
    const norm = normaliseUnitCode(input.pollingUnitCode);
    const unit = norm ? await prisma.pollingUnit.findUnique({ where: { code: norm } }) : null;
    if (!unit) {
      throw new BadRequestException(
        `Polling unit "${input.pollingUnitCode}" is not in the Gombe State register.`,
      );
    }

    let reporterId = input.reporterId ?? null;
    if (!reporterId && input.reporterCode) {
      const rep = await prisma.accreditedReporter.findFirst({
        where: { organizationId, code: input.reporterCode.trim().toUpperCase(), active: true },
        select: { id: true },
      });
      if (rep) reporterId = rep.id;
    }

    const now = new Date();
    const milestonePatch: Record<string, any> = {};
    switch (input.milestone) {
      case 'AGENT_ARRIVED':
        milestonePatch.agentCheckedInAt = now;
        break;
      case 'MATERIALS_ARRIVED':
        milestonePatch.agentCheckedInAt = now;
        milestonePatch.materialsArrivedAt = now;
        break;
      case 'VOTING_STARTED':
        milestonePatch.agentCheckedInAt = now;
        milestonePatch.materialsArrivedAt = now;
        milestonePatch.votingStartedAt = now;
        break;
      case 'VOTING_CLOSED':
        milestonePatch.votingClosedAt = now;
        break;
      case 'COUNTING_COMPLETED':
        milestonePatch.countingCompletedAt = now;
        break;
      case 'EC8A_SUBMITTED':
        milestonePatch.ec8aSubmittedAt = now;
        break;
      case 'IREV_UPLOADED':
        milestonePatch.irevUploadedAt = now;
        break;
      default:
        throw new BadRequestException(`Unknown milestone: ${String(input.milestone)}`);
    }

    if (typeof input.bvasWorking === 'boolean') {
      milestonePatch.bvasWorking = input.bvasWorking;
    }
    if (typeof input.accreditedVotersCount === 'number' && input.accreditedVotersCount >= 0) {
      milestonePatch.accreditedVotersCount = Math.floor(input.accreditedVotersCount);
    }
    if (input.channel) milestonePatch.lastChannel = input.channel;
    if (input.notes?.trim()) milestonePatch.notes = input.notes.trim();
    if (reporterId) milestonePatch.checkedInByReporterId = reporterId;

    const existing = await prisma.pollingUnitStatus.findUnique({
      where: { organizationId_pollingUnitCode: { organizationId, pollingUnitCode: unit.code } },
    });

    // Preserve earlier timestamps once recorded (monotone progress)
    if (existing) {
      if (existing.agentCheckedInAt) delete milestonePatch.agentCheckedInAt;
      if (existing.materialsArrivedAt) delete milestonePatch.materialsArrivedAt;
      if (existing.votingStartedAt) delete milestonePatch.votingStartedAt;
      return prisma.pollingUnitStatus.update({
        where: { id: existing.id },
        data: milestonePatch,
      });
    }

    return prisma.pollingUnitStatus.create({
      data: {
        organizationId,
        pollingUnitCode: unit.code,
        lga: unit.lga,
        registrationArea: unit.registrationArea,
        pollingUnitName: unit.name,
        ...milestonePatch,
      },
    });
  }

  async coverageMatrix(organizationId: string, lgaFilter?: string | null) {
    const canonicalLga = lgaFilter ? resolveLga(lgaFilter) ?? lgaFilter : null;
    const [units, statuses, reporters] = await Promise.all([
      prisma.pollingUnit.findMany({
        where: canonicalLga ? { lga: canonicalLga } : undefined,
        select: { code: true, name: true, lga: true, registrationArea: true, registeredVoters: true },
      }),
      prisma.pollingUnitStatus.findMany({
        where: { organizationId, ...(canonicalLga ? { lga: canonicalLga } : {}) },
      }),
      prisma.accreditedReporter.findMany({
        where: { organizationId, active: true, deployedPollingUnitCode: { not: null } },
        select: { deployedPollingUnitCode: true, fullName: true, phoneNumber: true, code: true },
      }),
    ]);

    const statusByCode = new Map(statuses.map((s) => [s.pollingUnitCode, s]));
    const agentByCode = new Map<string, { fullName: string; phoneNumber: string; code: string }>();
    for (const r of reporters) {
      if (r.deployedPollingUnitCode) agentByCode.set(r.deployedPollingUnitCode, r);
    }

    const byLga = new Map<
      string,
      {
        lga: string;
        totalUnits: number;
        assignedAgents: number;
        checkedIn: number;
        materialsArrived: number;
        bvasFailed: number;
        votingStarted: number;
        countingCompleted: number;
        ec8aSubmitted: number;
        irevUploaded: number;
      }
    >();

    for (const u of units) {
      const row = byLga.get(u.lga) ?? {
        lga: u.lga,
        totalUnits: 0,
        assignedAgents: 0,
        checkedIn: 0,
        materialsArrived: 0,
        bvasFailed: 0,
        votingStarted: 0,
        countingCompleted: 0,
        ec8aSubmitted: 0,
        irevUploaded: 0,
      };
      row.totalUnits++;
      if (agentByCode.has(u.code)) row.assignedAgents++;
      const s = statusByCode.get(u.code);
      if (s?.agentCheckedInAt) row.checkedIn++;
      if (s?.materialsArrivedAt) row.materialsArrived++;
      if (s?.bvasWorking === false) row.bvasFailed++;
      if (s?.votingStartedAt) row.votingStarted++;
      if (s?.countingCompletedAt) row.countingCompleted++;
      if (s?.ec8aSubmittedAt) row.ec8aSubmitted++;
      if (s?.irevUploadedAt) row.irevUploaded++;
      byLga.set(u.lga, row);
    }

    const lgaRows = [...byLga.values()].sort((a, b) => a.lga.localeCompare(b.lga));
    const totals = lgaRows.reduce(
      (acc, r) => ({
        totalUnits: acc.totalUnits + r.totalUnits,
        assignedAgents: acc.assignedAgents + r.assignedAgents,
        checkedIn: acc.checkedIn + r.checkedIn,
        materialsArrived: acc.materialsArrived + r.materialsArrived,
        bvasFailed: acc.bvasFailed + r.bvasFailed,
        votingStarted: acc.votingStarted + r.votingStarted,
        countingCompleted: acc.countingCompleted + r.countingCompleted,
        ec8aSubmitted: acc.ec8aSubmitted + r.ec8aSubmitted,
        irevUploaded: acc.irevUploaded + r.irevUploaded,
      }),
      {
        totalUnits: 0,
        assignedAgents: 0,
        checkedIn: 0,
        materialsArrived: 0,
        bvasFailed: 0,
        votingStarted: 0,
        countingCompleted: 0,
        ec8aSubmitted: 0,
        irevUploaded: 0,
      },
    );

    const unitDetails = canonicalLga
      ? units.slice(0, 500).map((u) => {
          const s = statusByCode.get(u.code);
          const a = agentByCode.get(u.code);
          return {
            code: u.code,
            name: u.name,
            lga: u.lga,
            registrationArea: u.registrationArea,
            assignedAgent: a ? { fullName: a.fullName, phoneNumber: a.phoneNumber, code: a.code } : null,
            status: s
              ? {
                  agentCheckedInAt: s.agentCheckedInAt,
                  materialsArrivedAt: s.materialsArrivedAt,
                  bvasWorking: s.bvasWorking,
                  votingStartedAt: s.votingStartedAt,
                  countingCompletedAt: s.countingCompletedAt,
                  ec8aSubmittedAt: s.ec8aSubmittedAt,
                  irevUploadedAt: s.irevUploadedAt,
                  accreditedVotersCount: s.accreditedVotersCount,
                }
              : null,
          };
        })
      : [];

    return { totals, byLga: lgaRows, units: unitDetails };
  }

  // ── 3. Form EC8A Result Collation / Parallel Vote Tabulation (PVT) ────────

  async submitResult(organizationId: string, input: SubmitResultInput) {
    const norm = normaliseUnitCode(input.pollingUnitCode);
    const unit = norm ? await prisma.pollingUnit.findUnique({ where: { code: norm } }) : null;
    if (!unit) {
      throw new BadRequestException(
        `Polling unit "${input.pollingUnitCode}" was not found in the Gombe register.`,
      );
    }

    const { votesByParty } = normalizeVotesByParty(input.votesByParty);
    if (Object.keys(votesByParty).length === 0) {
      throw new BadRequestException('Provide at least one party vote count (e.g. APC, PDP).');
    }

    const priorActive = await prisma.pollingUnitResult.findMany({
      where: {
        organizationId,
        pollingUnitCode: unit.code,
        status: { in: ['PENDING_REVIEW', 'VERIFIED', 'DISPUTED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasConflictingSubmission = priorActive.some((prev) => {
      const prevVotes = (prev.votesByParty || {}) as Record<string, number>;
      return (
        prev.accreditedVoters !== Math.floor(Number(input.accreditedVoters) || 0) ||
        JSON.stringify(prevVotes) !== JSON.stringify(votesByParty)
      );
    });

    const integrity = evaluateResultIntegrity({
      accreditedVoters: input.accreditedVoters,
      votesByParty,
      validVotes: input.validVotes,
      rejectedVotes: input.rejectedVotes,
      totalVotesCast: input.totalVotesCast,
      registeredVoters: unit.registeredVoters,
      hasEc8aPhoto: Boolean(input.ec8aEvidenceId),
      hasConflictingSubmission,
    });

    const created = await prisma.pollingUnitResult.create({
      data: {
        organizationId,
        pollingUnitCode: unit.code,
        lga: unit.lga,
        registrationArea: unit.registrationArea,
        pollingUnitName: unit.name,
        submittedByReporterId: input.submittedByReporterId ?? null,
        submittedByUserId: input.submittedByUserId ?? null,
        channel: (input.channel || 'WEB').toUpperCase(),
        accreditedVoters: Math.max(0, Math.floor(Number(input.accreditedVoters) || 0)),
        votesByParty,
        validVotes: integrity.validVotes,
        rejectedVotes: integrity.rejectedVotes,
        totalVotesCast: integrity.totalVotesCast,
        ec8aEvidenceId: input.ec8aEvidenceId ?? null,
        status: 'PENDING_REVIEW',
        flags: integrity.flags,
        notes: input.notes?.trim() || null,
      },
    });

    // Also update PollingUnitStatus to record ec8aSubmittedAt + accreditedVotersCount
    await this.recordCheckIn(organizationId, {
      pollingUnitCode: unit.code,
      reporterId: input.submittedByReporterId ?? null,
      milestone: 'EC8A_SUBMITTED',
      accreditedVotersCount: created.accreditedVoters,
      channel: created.channel,
    }).catch(() => {});

    return created;
  }

  async listResults(
    organizationId: string,
    opts?: { status?: string | null; lga?: string | null; flaggedOnly?: boolean },
  ) {
    const where: any = { organizationId };
    if (opts?.status && ['PENDING_REVIEW', 'VERIFIED', 'DISPUTED', 'SUPERSEDED'].includes(opts.status)) {
      where.status = opts.status;
    } else {
      where.status = { not: 'SUPERSEDED' };
    }
    if (opts?.lga) {
      where.lga = resolveLga(opts.lga) ?? opts.lga;
    }
    if (opts?.flaggedOnly) {
      where.flags = { isEmpty: false };
    }

    return prisma.pollingUnitResult.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
  }

  async verifyResult(
    organizationId: string,
    id: string,
    actorUserId: string,
    decision: 'VERIFIED' | 'DISPUTED',
    notes?: string,
  ) {
    if (decision !== 'VERIFIED' && decision !== 'DISPUTED') {
      throw new BadRequestException('Decision must be VERIFIED or DISPUTED.');
    }
    const existing = await prisma.pollingUnitResult.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Polling unit result submission not found.');

    if (decision === 'VERIFIED') {
      // Mark other active submissions for the same unit as SUPERSEDED so verified
      // aggregation never double-counts one polling unit.
      await prisma.pollingUnitResult.updateMany({
        where: {
          organizationId,
          pollingUnitCode: existing.pollingUnitCode,
          id: { not: existing.id },
          status: { in: ['PENDING_REVIEW', 'VERIFIED'] },
        },
        data: { status: 'SUPERSEDED' },
      });
    }

    return prisma.pollingUnitResult.update({
      where: { id: existing.id },
      data: {
        status: decision as ResultStatus,
        verifiedByUserId: actorUserId,
        verifiedAt: new Date(),
        notes: notes?.trim() || existing.notes,
      },
    });
  }

  async resultsSummary(organizationId: string, lgaFilter?: string | null) {
    const canonicalLga = lgaFilter ? resolveLga(lgaFilter) ?? lgaFilter : null;
    const [totalUnits, rows, unitsByLgaRaw] = await Promise.all([
      prisma.pollingUnit.count({ where: canonicalLga ? { lga: canonicalLga } : undefined }),
      prisma.pollingUnitResult.findMany({
        where: {
          organizationId,
          status: { in: ['VERIFIED', 'PENDING_REVIEW', 'DISPUTED'] },
          ...(canonicalLga ? { lga: canonicalLga } : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pollingUnit.groupBy({
        by: ['lga'],
        _count: { _all: true },
      }),
    ]);

    const unitTotalByLga = new Map(unitsByLgaRaw.map((g) => [g.lga, g._count._all]));

    // Deduplicate provisional submissions to latest per PU so totals never double-count
    const verifiedByPu = new Map<string, (typeof rows)[number]>();
    const provisionalByPu = new Map<string, (typeof rows)[number]>();
    let disputedCount = 0;
    let flaggedCount = 0;

    for (const r of rows) {
      if (r.flags.length > 0) flaggedCount++;
      if (r.status === 'DISPUTED') disputedCount++;
      if (r.status === 'VERIFIED' && !verifiedByPu.has(r.pollingUnitCode)) {
        verifiedByPu.set(r.pollingUnitCode, r);
      }
      if (r.status === 'PENDING_REVIEW' && !verifiedByPu.has(r.pollingUnitCode) && !provisionalByPu.has(r.pollingUnitCode)) {
        provisionalByPu.set(r.pollingUnitCode, r);
      }
    }

    const aggregate = (list: Array<(typeof rows)[number]>) => {
      const partyTotals: Record<string, number> = {};
      let accreditedVoters = 0;
      let validVotes = 0;
      let rejectedVotes = 0;
      let totalVotesCast = 0;
      for (const r of list) {
        accreditedVoters += r.accreditedVoters;
        validVotes += r.validVotes;
        rejectedVotes += r.rejectedVotes;
        totalVotesCast += r.totalVotesCast;
        const votes = (r.votesByParty || {}) as Record<string, number>;
        for (const [party, count] of Object.entries(votes)) {
          partyTotals[party] = (partyTotals[party] ?? 0) + (Number(count) || 0);
        }
      }
      return {
        unitsReported: list.length,
        accreditedVoters,
        validVotes,
        rejectedVotes,
        totalVotesCast,
        partyTotals,
      };
    };

    const verified = aggregate([...verifiedByPu.values()]);
    const provisional = aggregate([...provisionalByPu.values()]);

    // Per-LGA breakdown across all 11 LGAs
    const lgaList = canonicalLga ? [canonicalLga] : [...GOMBE_LGAS];
    const byLga = lgaList.map((lga) => {
      const vList = [...verifiedByPu.values()].filter((r) => r.lga === lga);
      const pList = [...provisionalByPu.values()].filter((r) => r.lga === lga);
      return {
        lga,
        totalUnits: unitTotalByLga.get(lga) ?? 0,
        verified: aggregate(vList),
        provisional: aggregate(pList),
      };
    });

    return {
      totalPollingUnits: totalUnits,
      reportedPollingUnits: verifiedByPu.size + provisionalByPu.size,
      disputedSubmissions: disputedCount,
      flaggedSubmissions: flaggedCount,
      verified,
      provisional,
      byLga,
      note: 'Verified totals include only Form EC8A submissions reviewed and confirmed by a Situation Room officer. Provisional totals reflect unverified field submissions and are never mixed with verified totals.',
    };
  }

  // ── 4. Incident Verification & Audit Trail ────────────────────────────────

  async verifyIncident(
    organizationId: string,
    ticketId: string,
    actor: { id: string; email: string },
    status: 'VERIFIED' | 'DISPUTED' | 'FALSE_REPORT' | 'DISMISSED',
    note: string,
  ) {
    const verification =
      status === 'DISMISSED' ? 'FALSE_REPORT' : status;
    if (
      verification !== 'VERIFIED' &&
      verification !== 'DISPUTED' &&
      verification !== 'FALSE_REPORT'
    ) {
      throw new BadRequestException(
        'Verification status must be VERIFIED, DISPUTED, FALSE_REPORT, or DISMISSED.',
      );
    }
    const trimmed = String(note || '').trim();
    if (trimmed.length < 3) {
      throw new BadRequestException('A brief verification note is required for the audit record.');
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, organizationId },
    });
    if (!ticket) throw new NotFoundException('Incident ticket not found.');

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        verification,
        verifiedByUserId: actor.id,
        verifiedAt: new Date(),
        verificationNote: trimmed,
        ...(verification === 'FALSE_REPORT' ? { status: 'CLOSED' } : {}),
      },
    });

    await prisma.caseEvent.create({
      data: {
        organizationId,
        ticketId: ticket.id,
        type: verification === 'VERIFIED' ? 'VERIFIED' : 'NOTE',
        actorUserId: actor.id,
        actorLabel: actor.email,
        body: `Situation Room verification: ${verification} — ${trimmed}`,
        internal: true,
      },
    });

    return updated;
  }
}
