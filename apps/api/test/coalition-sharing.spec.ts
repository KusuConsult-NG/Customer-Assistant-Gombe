/**
 * What crosses an organisation boundary in a coalition, and what must not.
 *
 * Tenant isolation in this platform is not a convenience — it is what stops
 * the lands registry reading health records, and every query is written
 * assuming `organizationId` is a hard boundary. A situation room still needs
 * several organisations to pool what their observers see, so there is exactly
 * ONE method that reads across tenants and this suite is what holds it to its
 * promises.
 */
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { prisma } from '@ace/database';
import { SituationRoomService } from '../src/situation-room/situation-room.service';

let room: SituationRoomService;
let orgA: string;
let orgB: string;
let orgC: string;
let coalitionId: string;

const makeOrg = async (name: string) => {
  const o = await prisma.organization.create({
    data: { name, slug: `${name.toLowerCase()}-${randomBytes(4).toString('hex')}`, industry: 'OTHER' },
    select: { id: true },
  });
  return o.id;
};

const fileIncident = async (organizationId: string, over: Record<string, any> = {}) => {
  const contact = await prisma.contact.create({
    data: { organizationId, phoneNumber: `+234${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(10, '7').slice(0, 10)}`, fullName: 'Observer' },
    select: { id: true },
  });
  return prisma.ticket.create({
    data: {
      organizationId,
      contactId: contact.id,
      ticketNumber: `TCK-${randomBytes(6).toString('hex')}`,
      subject: 'Ballot box snatched',
      // The reporter's own words, which routinely carry their name and number.
      description: 'My name is Garba Mamman on 08031112222 and I saw them take the box.',
      incidentType: 'ballot_snatching',
      severity: 'CRITICAL',
      lga: 'Akko',
      pollingUnitCode: '15-01-01-003',
      ...over,
    },
    select: { id: true, ticketNumber: true },
  });
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ providers: [SituationRoomService] }).compile();
  room = moduleRef.get(SituationRoomService);

  orgA = await makeOrg('CoalitionA');
  orgB = await makeOrg('CoalitionB');
  orgC = await makeOrg('OutsiderC');

  const coalition = await prisma.coalition.create({
    data: { name: 'Gombe Situation Room 2027', electionLabel: '2027 general' },
    select: { id: true },
  });
  coalitionId = coalition.id;
  await prisma.coalitionMember.createMany({
    data: [
      { coalitionId, organizationId: orgA, canRead: true, canShare: true },
      { coalitionId, organizationId: orgB, canRead: true, canShare: true },
    ],
  });
}, 60_000);

afterAll(async () => {
  for (const id of [orgA, orgB, orgC]) {
    await prisma.organization.delete({ where: { id } }).catch(() => {});
  }
  await prisma.coalition.delete({ where: { id: coalitionId } }).catch(() => {});
});

describe('the coalition pool', () => {
  it('shows a member another member’s incident, attributed', async () => {
    const mine = await fileIncident(orgA);
    const theirs = await fileIncident(orgB);

    const pool = await room.coalitionIncidents(orgA);
    expect(pool.inCoalition).toBe(true);
    const refs = pool.incidents.map((i: any) => i.ticketNumber);
    expect(refs).toContain(mine.ticketNumber);
    expect(refs).toContain(theirs.ticketNumber);

    const ours = pool.incidents.find((i: any) => i.ticketNumber === mine.ticketNumber)!;
    const other = pool.incidents.find((i: any) => i.ticketNumber === theirs.ticketNumber)!;
    expect((ours as any).mine).toBe(true);
    // Never presented as our own.
    expect((other as any).mine).toBe(false);
    expect((other as any).reportedByOrganisation).toBe('CoalitionB');
  }, 60_000);

  it('never lets the reporter cross the boundary', async () => {
    await fileIncident(orgB);
    const pool = await room.coalitionIncidents(orgA);
    const serialised = JSON.stringify(pool);

    // The description is the reporter's own words and routinely contains their
    // name and telephone number. It is not selected at all.
    expect(serialised).not.toContain('Garba Mamman');
    expect(serialised).not.toContain('08031112222');
    for (const i of pool.incidents as any[]) {
      expect(i.description).toBeUndefined();
      expect(i.contactId).toBeUndefined();
      expect(i.accreditedReporter).toBeUndefined();
      // The owning organisation's id is not handed out either; its NAME is.
      expect(i.organizationId).toBeUndefined();
    }
  }, 60_000);

  it('shows nothing to an organisation outside the coalition', async () => {
    await fileIncident(orgA);
    const pool = await room.coalitionIncidents(orgC);
    expect(pool.inCoalition).toBe(false);
    expect(pool.incidents).toHaveLength(0);
  }, 60_000);

  it('honours a member who reads but does not share', async () => {
    // A real arrangement: consume the pool without publishing into it.
    await prisma.coalitionMember.updateMany({
      where: { coalitionId, organizationId: orgB },
      data: { canShare: false },
    });
    const theirs = await fileIncident(orgB);
    const pool = await room.coalitionIncidents(orgA);
    expect(pool.incidents.map((i: any) => i.ticketNumber)).not.toContain(theirs.ticketNumber);

    await prisma.coalitionMember.updateMany({
      where: { coalitionId, organizationId: orgB },
      data: { canShare: true },
    });
  }, 60_000);

  it('stops sharing when the window closes', async () => {
    // A coalition for one election must not silently keep sharing through the
    // next one.
    await prisma.coalition.update({
      where: { id: coalitionId },
      data: { sharingEndsAt: new Date(Date.now() - 60_000) },
    });
    const pool = await room.coalitionIncidents(orgA);
    expect(pool.inCoalition).toBe(false);

    await prisma.coalition.update({ where: { id: coalitionId }, data: { sharingEndsAt: null } });
  }, 60_000);

  it('pools election incidents only, never service cases', async () => {
    const serviceCase = await fileIncident(orgB, {
      incidentType: null,
      severity: null,
      category: 'roads',
      subject: 'Collapsed culvert',
    });
    const pool = await room.coalitionIncidents(orgA);
    expect(pool.incidents.map((i: any) => i.ticketNumber)).not.toContain(serviceCase.ticketNumber);
  }, 60_000);
});
