import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '@ace/shared-types';
import { SituationRoomService } from './situation-room.service';
import { PetitionExportService } from './petition-export.service';

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
}
