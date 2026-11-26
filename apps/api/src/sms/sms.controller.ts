import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  createTicketWithUniqueNumber,
  dueAtFor,
  incidentType,
  normalizePhoneNumber,
  prisma,
  severityFor,
} from '@ace/database';
import { CampaignOpsService } from '../situation-room/campaign-ops.service';
import { parseSmsReport, smsAck } from './report-sms';
import { ussdStep } from './ussd-session';
import { parseCampaignSms } from './campaign-sms-parser';

/**
 * Provider-agnostic 2G SMS & USSD intake webhooks for rural polling units.
 *
 * Supports Africa's Talking, Termii, Infobip, and generic JSON payloads.
 * When `SMS_WEBHOOK_SECRET` is configured, callers must supply it via
 * `x-sms-webhook-secret` header or `?secret=` query parameter.
 */
@SkipThrottle()
@Controller('api')
export class SmsController {
  private readonly log = new Logger('SmsUssdIntake');

  constructor(private readonly ops: CampaignOpsService) {}

  private assertSecret(headerSecret?: string, querySecret?: string) {
    const expected = process.env.SMS_WEBHOOK_SECRET?.trim();
    if (!expected) return;
    const provided = (headerSecret || querySecret || '').trim();
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid SMS/USSD webhook secret.');
    }
  }

  private async resolveOrg(orgSlug?: string): Promise<string> {
    const slug = (orgSlug || process.env.DEFAULT_CAMPAIGN_ORG_SLUG || '').trim();
    if (slug) {
      const bySlug = await prisma.organization.findFirst({
        where: { OR: [{ slug }, { id: slug }] },
        select: { id: true },
      });
      if (bySlug) return bySlug.id;
    }
    const fallback = await prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallback) throw new BadRequestException('No organization configured to receive SMS/USSD reports.');
    return fallback.id;
  }

  private async findReporterByPhone(organizationId: string, rawPhone: string) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (digits.length < 9) return null;
    const tail = digits.slice(-9);
    return prisma.accreditedReporter.findFirst({
      where: { organizationId, active: true, phoneNumber: { endsWith: tail } },
    });
  }

  private async findOrCreateContact(
    organizationId: string,
    rawPhone: string,
    fallbackName: string,
    city?: string | null,
  ) {
    const phone = rawPhone ? normalizePhoneNumber(rawPhone) || rawPhone : 'sms:anonymous';
    const existing = await prisma.contact.findUnique({
      where: { organizationId_phoneNumber: { organizationId, phoneNumber: phone } },
    });
    if (existing) return existing;
    return prisma.contact.create({
      data: {
        organizationId,
        phoneNumber: phone,
        fullName: fallbackName,
        city: city ?? undefined,
      },
    });
  }

  @Post('sms/inbound')
  @HttpCode(200)
  async inboundSms(
    @Body() body: Record<string, any>,
    @Headers('x-sms-webhook-secret') headerSecret?: string,
    @Query('secret') querySecret?: string,
    @Query('org') orgParam?: string,
  ) {
    this.assertSecret(headerSecret, querySecret);

    const from = String(body?.from || body?.sender || body?.msisdn || body?.phoneNumber || '').trim();
    const text = String(body?.text || body?.message || body?.body || '').trim();
    if (!text) {
      return { ok: false, reply: 'Empty SMS received. Send CHK, RES, or incident code + unit code.' };
    }

    const organizationId = await this.resolveOrg(orgParam || body?.org);
    const reporter = from ? await this.findReporterByPhone(organizationId, from) : null;

    // 1. Check for Check-In or EC8A Result SMS first
    const structured = parseCampaignSms(text);
    if (structured?.kind === 'CHECKIN') {
      const puCode = structured.pollingUnitCode || reporter?.deployedPollingUnitCode;
      if (!puCode) {
        return {
          ok: false,
          kind: 'CHECKIN',
          reply: 'Check-in needs your polling unit code, e.g. CHK 15/01/01/003 MAT OK.',
        };
      }
      const status = await this.ops.recordCheckIn(organizationId, {
        pollingUnitCode: puCode,
        reporterId: reporter?.id ?? null,
        milestone: structured.milestone,
        bvasWorking: structured.bvasWorking,
        channel: 'SMS',
        notes: structured.notes,
      });
      return {
        ok: true,
        kind: 'CHECKIN',
        pollingUnitCode: status.pollingUnitCode,
        milestone: structured.milestone,
        reply: `Check-in recorded for PU ${status.pollingUnitCode} (${structured.milestone}). Thank you.`,
      };
    }

    if (structured?.kind === 'RESULT') {
      const puCode = structured.pollingUnitCode || reporter?.deployedPollingUnitCode;
      if (!puCode) {
        return {
          ok: false,
          kind: 'RESULT',
          reply: 'Result SMS needs your polling unit code, e.g. RES 15/01/01/003 ACC 420 APC 290 PDP 115.',
        };
      }
      if (Object.keys(structured.votesByParty).length === 0) {
        return {
          ok: false,
          kind: 'RESULT',
          reply: 'Include party counts, e.g. RES 15/01/01/003 ACC 420 APC 290 PDP 115 REJ 5.',
        };
      }
      const res = await this.ops.submitResult(organizationId, {
        pollingUnitCode: puCode,
        accreditedVoters: structured.accreditedVoters,
        votesByParty: structured.votesByParty,
        rejectedVotes: structured.rejectedVotes,
        submittedByReporterId: reporter?.id ?? null,
        channel: 'SMS',
        notes: structured.rawText,
      });
      const flagNote = res.flags.length ? ` Flags: ${res.flags.join(', ')}.` : '';
      return {
        ok: true,
        kind: 'RESULT',
        resultId: res.id,
        pollingUnitCode: res.pollingUnitCode,
        flags: res.flags,
        reply: `EC8A received for PU ${res.pollingUnitCode} (Total ${res.totalVotesCast}).${flagNote}`.slice(0, 160),
      };
    }

    // 2. Incident SMS (VB, BVAS, MAT, SN, VI, or free text)
    const parsed = parseSmsReport(text);
    const puCode = parsed.pollingUnitCode || reporter?.deployedPollingUnitCode || null;
    const unit = puCode ? await prisma.pollingUnit.findUnique({ where: { code: puCode } }) : null;
    const def = parsed.incidentType ? incidentType(parsed.incidentType) : null;
    const sev = def ? severityFor(def.id, { isOngoing: parsed.isOngoing }) : 'HIGH';
    const dueAt = dueAtFor(sev);

    const contact = await this.findOrCreateContact(
      organizationId,
      from,
      reporter?.fullName || (from ? `SMS Reporter (${from})` : 'Anonymous SMS Reporter'),
      unit?.lga || reporter?.deployedLga,
    );

    const ticket = await createTicketWithUniqueNumber((ticketNumber) =>
      prisma.ticket.create({
        data: {
          organizationId,
          contactId: contact.id,
          ticketNumber,
          subject: def ? `${def.label}${unit ? ` — ${unit.name}` : ''}` : `SMS Incident Report${unit ? ` — ${unit.name}` : ''}`,
          description: parsed.account,
          priority: sev === 'CRITICAL' ? 'URGENT' : sev === 'HIGH' ? 'HIGH' : 'MEDIUM',
          channel: 'SMS',
          lga: unit?.lga ?? reporter?.deployedLga ?? null,
          registrationArea: unit?.registrationArea ?? reporter?.deployedRegistrationArea ?? null,
          pollingUnitCode: unit?.code ?? puCode,
          pollingUnitName: unit?.name ?? parsed.pollingUnitText,
          incidentType: def?.id ?? null,
          severity: sev,
          verification: 'UNVERIFIED',
          needsClassification: !def,
          reporterKind: reporter ? 'ACCREDITED' : 'PUBLIC',
          accreditedReporterId: reporter?.id ?? null,
          dueAt,
        },
      }),
    );

    this.log.log(`sms_incident_filed org=${organizationId} ref=${ticket.ticketNumber} unit=${ticket.pollingUnitCode ?? 'none'}`);
    return {
      ok: true,
      kind: 'INCIDENT',
      ticketId: ticket.id,
      reference: ticket.ticketNumber,
      reply: smsAck(ticket.ticketNumber, {
        unitMissing: !ticket.pollingUnitCode,
        unclassified: !def,
      }),
    };
  }

  /**
   * USSD aggregator callback (Africa's Talking / Infobip standard format).
   * Responds with plain text prefixed by `CON ` (keep session open) or `END ` (close session).
   */
  @Post('ussd/callback')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async ussdCallback(
    @Body() body: Record<string, any>,
    @Headers('x-sms-webhook-secret') headerSecret?: string,
    @Query('secret') querySecret?: string,
    @Query('org') orgParam?: string,
  ): Promise<string> {
    this.assertSecret(headerSecret, querySecret);

    const phone = String(body?.phoneNumber || body?.msisdn || body?.from || '').trim();
    const text = String(body?.text ?? '').trim();
    const action = ussdStep(text);

    if (action.kind === 'CONTINUE') {
      return `CON ${action.screen}`;
    }
    if (action.kind === 'END') {
      return `END ${action.screen}`;
    }

    const organizationId = await this.resolveOrg(orgParam || body?.org);
    const reporter = phone ? await this.findReporterByPhone(organizationId, phone) : null;
    const puCode = action.report.pollingUnitCode || reporter?.deployedPollingUnitCode || null;
    const unit = puCode ? await prisma.pollingUnit.findUnique({ where: { code: puCode } }) : null;
    const def = incidentType(action.report.incidentType);
    const sev = def ? severityFor(def.id, { isOngoing: action.report.isOngoing }) : 'HIGH';

    const contact = await this.findOrCreateContact(
      organizationId,
      phone,
      reporter?.fullName || (phone ? `USSD Reporter (${phone})` : 'Anonymous USSD Reporter'),
      unit?.lga || reporter?.deployedLga,
    );

    const ticket = await createTicketWithUniqueNumber((ticketNumber) =>
      prisma.ticket.create({
        data: {
          organizationId,
          contactId: contact.id,
          ticketNumber,
          subject: `${def?.label ?? action.report.incidentType}${unit ? ` — ${unit.name}` : ''}`,
          description: `USSD election incident report (${action.report.isOngoing ? 'ONGOING' : 'not ongoing'}).`,
          priority: sev === 'CRITICAL' ? 'URGENT' : 'HIGH',
          channel: 'USSD',
          lga: unit?.lga ?? reporter?.deployedLga ?? null,
          registrationArea: unit?.registrationArea ?? reporter?.deployedRegistrationArea ?? null,
          pollingUnitCode: unit?.code ?? puCode,
          pollingUnitName: unit?.name ?? null,
          incidentType: def?.id ?? action.report.incidentType,
          severity: sev,
          verification: 'UNVERIFIED',
          reporterKind: reporter ? 'ACCREDITED' : 'PUBLIC',
          accreditedReporterId: reporter?.id ?? null,
          dueAt: dueAtFor(sev),
        },
      }),
    );

    return `END ${action.screen(ticket.ticketNumber)}`;
  }
}
