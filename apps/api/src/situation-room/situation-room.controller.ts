import { Controller, Delete, Get, Patch, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '@ace/shared-types';
import { SituationRoomService } from './situation-room.service';
import { PetitionExportService } from './petition-export.service';
import { CampaignOpsService, CheckInInput, SubmitResultInput, UpsertReporterInput } from './campaign-ops.service';

/**
 * The situation room's own screens.
 *
 * Reading is open to any member, because on election day the people who need
 * the picture are whoever is in the room. Exporting a petition bundle is
 * OWNER/ADMIN: it places a legal hold that stops deletion, and it assembles a
 * named reporter's account with the evidence hashes — not something to leave
 * to any logged-in account.
 */
@Controller('api/situation-room')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SituationRoomController {
  constructor(
    private readonly room: SituationRoomService,
    private readonly petitions: PetitionExportService,
    private readonly ops: CampaignOpsService,
  ) {}

  /** Counts, coverage, confidence and the map points. */
  @Get('overview')
  overview(
    @Req() req: { user: AuthUser },
    @Query('since') since?: string,
    @Query('lga') lga?: string,
  ) {
    const from = since ? new Date(since) : undefined;
    return this.room.overview(req.user.organizationId, {
      since: from && !Number.isNaN(from.getTime()) ? from : undefined,
      lga: lga?.trim() || null,
    });
  }

  /**
   * Registration Areas that have reported nothing.
   *
   * Its own route because it answers a different question from `overview` and
   * the answer is a list of places to telephone, not a statistic.
   */
  @Get('silent')
  silent(@Req() req: { user: AuthUser }, @Query('since') since?: string) {
    const from = since ? new Date(since) : undefined;
    return this.room.silentAreas(
      req.user.organizationId,
      from && !Number.isNaN(from.getTime()) ? from : undefined,
    );
  }

  /**
   * The coalition pool. See `coalitionIncidents` for exactly what crosses an
   * organisation boundary and what does not.
   */
  @Get('coalition')
  coalition(
    @Req() req: { user: AuthUser },
    @Query('since') since?: string,
    @Query('lga') lga?: string,
  ) {
    const from = since ? new Date(since) : undefined;
    return this.room.coalitionIncidents(req.user.organizationId, {
      since: from && !Number.isNaN(from.getTime()) ? from : undefined,
      lga: lga?.trim() || null,
    });
  }

  /** Which polling units have anything that could be filed. */
  @Get('petition/units')
  @Roles('OWNER', 'ADMIN')
  units(@Req() req: { user: AuthUser }) {
    return this.petitions.unitsWithIncidents(req.user.organizationId);
  }

  /**
   * The bundle for one polling unit. Places a legal hold by default.
   *
   * POST, not GET: it changes something. A GET that stops the retention job
   * deleting evidence is a GET with a side effect, and the next person to add
   * a cache or a prefetch would place holds nobody asked for.
   */
  @Post('petition/unit/:code')
  @Roles('OWNER', 'ADMIN')
  bundle(
    @Req() req: { user: AuthUser },
    @Param('code') code: string,
    @Body() body?: { hold?: boolean; reason?: string },
  ) {
    return this.petitions.bundleForUnit(req.user.organizationId, code, {
      hold: body?.hold,
      reason: body?.reason,
      actorLabel: req.user.email,
    });
  }

  // ── Accredited Party Agent Roster ─────────────────────────────────────────

  @Get('reporters')
  listReporters(
    @Req() req: { user: AuthUser },
    @Query('lga') lga?: string,
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.ops.listReporters(req.user.organizationId, {
      lga: lga?.trim() || null,
      role: role?.trim() || null,
      search: search?.trim() || null,
      activeOnly: includeInactive !== 'true',
    });
  }

  @Post('reporters')
  @Roles('OWNER', 'ADMIN')
  upsertReporter(@Req() req: { user: AuthUser }, @Body() body: UpsertReporterInput) {
    return this.ops.upsertReporter(req.user.organizationId, body);
  }

  @Post('reporters/import')
  @Roles('OWNER', 'ADMIN')
  importReporters(
    @Req() req: { user: AuthUser },
    @Body() body: { rows: UpsertReporterInput[]; dryRun?: boolean },
  ) {
    return this.ops.bulkImportReporters(req.user.organizationId, body?.rows ?? [], Boolean(body?.dryRun));
  }

  @Delete('reporters/:id')
  @Roles('OWNER', 'ADMIN')
  revokeReporter(
    @Req() req: { user: AuthUser },
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.ops.revokeReporter(req.user.organizationId, id, reason);
  }

  // ── Election-Day Check-In & Milestone Coverage Matrix ─────────────────────

  @Post('check-in')
  @Roles('OWNER', 'ADMIN', 'AGENT')
  recordCheckIn(@Req() req: { user: AuthUser }, @Body() body: CheckInInput) {
    return this.ops.recordCheckIn(req.user.organizationId, body);
  }

  @Get('coverage-matrix')
  coverageMatrix(@Req() req: { user: AuthUser }, @Query('lga') lga?: string) {
    return this.ops.coverageMatrix(req.user.organizationId, lga?.trim() || null);
  }

  // ── Form EC8A Parallel Vote Tabulation (PVT) ──────────────────────────────

  @Post('results')
  @Roles('OWNER', 'ADMIN', 'AGENT')
  submitResult(@Req() req: { user: AuthUser }, @Body() body: SubmitResultInput) {
    return this.ops.submitResult(req.user.organizationId, {
      ...body,
      submittedByUserId: req.user.userId,
      channel: body?.channel || 'WEB',
    });
  }

  @Get('results')
  listResults(
    @Req() req: { user: AuthUser },
    @Query('status') status?: string,
    @Query('lga') lga?: string,
    @Query('flaggedOnly') flaggedOnly?: string,
  ) {
    return this.ops.listResults(req.user.organizationId, {
      status: status?.trim() || null,
      lga: lga?.trim() || null,
      flaggedOnly: flaggedOnly === 'true',
    });
  }

  @Get('results/summary')
  resultsSummary(@Req() req: { user: AuthUser }, @Query('lga') lga?: string) {
    return this.ops.resultsSummary(req.user.organizationId, lga?.trim() || null);
  }

  @Patch('results/:id/verify')
  @Roles('OWNER', 'ADMIN', 'AGENT')
  verifyResult(
    @Req() req: { user: AuthUser },
    @Param('id') id: string,
    @Body() body: { decision: 'VERIFIED' | 'DISPUTED'; notes?: string },
  ) {
    return this.ops.verifyResult(req.user.organizationId, id, req.user.userId, body?.decision, body?.notes);
  }

  // ── Incident Verification ─────────────────────────────────────────────────

  @Patch('incidents/:id/verify')
  @Roles('OWNER', 'ADMIN', 'AGENT')
  verifyIncident(
    @Req() req: { user: AuthUser },
    @Param('id') id: string,
    @Body() body: { status: 'VERIFIED' | 'DISPUTED' | 'FALSE_REPORT' | 'DISMISSED'; note: string },
  ) {
    return this.ops.verifyIncident(
      req.user.organizationId,
      id,
      { id: req.user.userId, email: req.user.email },
      body?.status,
      body?.note,
    );
  }
}
