/**
 * The "needs attention now" list is ordered by triage, and reads as English.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * The list was `filter(...).slice(0, 50)` over a query ordered by time across
 * the whole State. So the first fifty rows were the fifty most recent, in
 * whatever LGA happened to be busy — rendered, every visible row was Akko —
 * and a CRITICAL incident elsewhere sat below the fold behind fifty MEDIUMs.
 * A triage list that is not ordered by triage is just a list.
 *
 * It also sent `incidentType`, a machine id, straight to the screen: an
 * officer read `ballot_snatching` and `result_alteration`. The label existed
 * the whole time and the petition bundle already used it.
 */
import { randomBytes } from 'crypto';
import { prisma } from '@ace/database';
import { SituationRoomService } from '../src/situation-room/situation-room.service';

const room = new SituationRoomService();
let orgId: string;

const incident = async (over: Record<string, any>) => {
  const contact = await prisma.contact.create({
    data: { organizationId: orgId, fullName: 'Observer', phoneNumber: `+234${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(10, '7').slice(0, 10)}` },
    select: { id: true },
  });
  return prisma.ticket.create({
    data: {
      organizationId: orgId, contactId: contact.id,
      ticketNumber: `TCK-${randomBytes(5).toString('hex').toUpperCase()}`,
      subject: 'Incident', description: 'Account.',
      incidentType: 'ballot_snatching', severity: 'CRITICAL',
      ...over,
    },
    select: { ticketNumber: true },
  });
};

beforeAll(async () => {
  const o = await prisma.organization.create({
    data: { name: `Triage ${randomBytes(3).toString('hex')}`, slug: `tri-${randomBytes(5).toString('hex')}`, industry: 'GOVERNMENT' },
    select: { id: true },
  });
  orgId = o.id;
});
afterAll(async () => {
  if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
});

describe('needsAttention', () => {
  it('puts the worst first, then the longest overdue, whatever order they arrived in', async () => {
    const hour = 3600_000;
    // Deliberately created newest-first-worst-last, the order that used to win.
    const mediumOverdueLong = await incident({ severity: 'MEDIUM', dueAt: new Date(Date.now() - 4 * hour) });
    const highOverdueShort = await incident({ severity: 'HIGH', dueAt: new Date(Date.now() - 1 * hour) });
    const criticalNewest = await incident({ severity: 'CRITICAL' });

    const o: any = await room.overview(orgId);
    const order = o.needsAttention.map((n: any) => n.ticketNumber);

    expect(order[0]).toBe(criticalNewest.ticketNumber);
    expect(order.indexOf(highOverdueShort.ticketNumber)).toBeLessThan(
      order.indexOf(mediumOverdueLong.ticketNumber),
    );
  });

  it('sends a human label, not the machine id', async () => {
    const o: any = await room.overview(orgId);
    const row = o.needsAttention.find((n: any) => n.incidentType === 'ballot_snatching');
    expect(row).toBeTruthy();
    expect(row.incidentLabel).not.toBe('ballot_snatching');
    expect(row.incidentLabel).not.toMatch(/_/);
    // The id stays, for the machine and for linking.
    expect(row.incidentType).toBe('ballot_snatching');
  });

  it('says when it arrived and how overdue it is, in minutes', async () => {
    await incident({ severity: 'HIGH', dueAt: new Date(Date.now() - 90 * 60_000) });
    const o: any = await room.overview(orgId);
    const row = o.needsAttention.find((n: any) => n.overdueByMinutes !== null);
    expect(row.overdueByMinutes).toBeGreaterThanOrEqual(89);
    expect(Date.parse(row.reportedAt)).not.toBeNaN();
  });

  it('names an unclassified incident rather than leaving it blank', async () => {
    await incident({ incidentType: 'not_a_real_type', needsClassification: true, severity: 'LOW' });
    const o: any = await room.overview(orgId);
    const row = o.needsAttention.find((n: any) => n.why === 'not classified');
    expect(row.incidentLabel).toBeTruthy();
  });
});

describe('labelling an incident type that is not in the taxonomy', () => {
  it('humanises the id instead of showing it raw', async () => {
    // A record written before a type was renamed, or by a classifier that has
    // since changed. The officer is reading a list of emergencies; they should
    // never be shown `result_alteration`.
    await incident({ incidentType: 'result_alteration', severity: 'CRITICAL' });
    const o: any = await room.overview(orgId);
    const row = o.needsAttention.find((n: any) => n.incidentType === 'result_alteration');
    expect(row.incidentLabel).toBe('Result alteration');
    expect(row.incidentLabel).not.toMatch(/_/);
  });
});
