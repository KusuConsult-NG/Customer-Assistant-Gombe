/**
 * Filing an election incident, against a real database.
 *
 * The three things a situation room's credibility rests on, end to end:
 * many reporters at one unit become one incident, a reporter standing in danger
 * is not read their own report back aloud, and a report is never lost for want
 * of a category.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@ace/database';
import { AgentToolsModule } from '../src/agent-tools/agent-tools.module';
import { WorkflowTriggerModule } from '../src/workflows/workflow-trigger.module';
import { AGENT_KEY_PREFIX } from '../src/agent-tools/agent-key.guard';

const KEY = `${AGENT_KEY_PREFIX}${randomBytes(16).toString('hex')}`;
const UNIT = '15-01-03-004';

let app: INestApplication;
let orgId: string;

const post = (tool: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post(`/api/agent-tools/${tool}`).set('Authorization', `Bearer ${KEY}`).send(body);

const phone = () => `+23480${randomBytes(4).toString('hex').replace(/\D/g, '').padEnd(8, '7').slice(0, 8)}`;

const report = (over: Record<string, unknown> = {}) => ({
  phoneNumber: phone(),
  fullName: 'Garba Mamman',
  subject: 'Ballot box snatched',
  description: 'Men came and snatched the ballot box from the polling unit.',
  lga: 'Akko',
  pollingUnitCode: UNIT,
  pollingUnit: 'Central Primary School',
  registrationArea: 'Kumo East',
  summary: 'A ballot box was snatched at Central Primary School, Kumo East, Akko.',
  summaryConfirmed: true,
  ...over,
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkflowTriggerModule, AgentToolsModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const org = await prisma.organization.create({
    data: {
      name: 'Gombe Situation Room (test)',
      slug: `sit-room-${randomBytes(4).toString('hex')}`,
      industry: 'OTHER',
    },
    select: { id: true },
  });
  orgId = org.id;
  await prisma.apiKey.create({
    data: {
      organizationId: orgId,
      keyName: 'situation room agent key',
      keyHash: createHash('sha256').update(KEY).digest('hex'),
      keyPrefix: KEY.slice(0, 20),
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  await app?.close();
});

describe('many reporters, one event', () => {
  it('adds the second reporter to the first incident instead of opening another', async () => {
    const first = await post('create-ticket', report()).expect(201);
    expect(first.body.ok).toBe(true);
    expect(first.body.data.corroborated).toBeUndefined();
    const reference = first.body.data.ticketNumber;

    const second = await post('create-ticket', report({
      description: 'I saw them carry the ballot box away in a vehicle.',
    })).expect(201);

    expect(second.body.data.corroborated).toBe(true);
    // The SAME reference, so a situation room following up reaches one
    // incident rather than twenty threads about one event.
    expect(second.body.data.ticketNumber).toBe(reference);
    expect(second.body.data.corroborations).toBe(2);
    expect(second.body.speak).toMatch(/Others have reported this/i);

    const stored = await prisma.ticket.findUnique({
      where: { ticketNumber: reference },
      select: {
        corroborations: true, verification: true, incidentType: true, severity: true,
        pollingUnitCode: true, registrationArea: true, clusterKey: true, dueAt: true, createdAt: true,
        events: { where: { type: 'CORROBORATION' }, select: { body: true } },
      },
    });
    expect(stored?.corroborations).toBe(2);
    // Two independent reports is CORROBORATED and NOT verified.
    expect(stored?.verification).toBe('CORROBORATED');
    expect(stored?.incidentType).toBe('ballot_snatching');
    expect(stored?.severity).toBe('CRITICAL');
    expect(stored?.pollingUnitCode).toBe(UNIT);
    expect(stored?.registrationArea).toBe('Kumo East');

    // The second reporter's own account is kept whole, not merged away: an
    // incident with two corroborations and one narrative has thrown away a
    // witness statement.
    expect(stored?.events).toHaveLength(1);
    expect(stored?.events[0].body).toMatch(/carry the ballot box away in a vehicle/);

    // A critical incident is overdue in MINUTES, not days.
    const minutes = (stored!.dueAt!.getTime() - stored!.createdAt.getTime()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(5);
  }, 60_000);

  it('does not let one person corroborate themselves', async () => {
    // One person reporting twice is one witness. Counting it twice is the
    // easiest way to manufacture a false consensus.
    const caller = phone();
    const unit = '15-01-03-009';
    const first = await post('create-ticket', report({ phoneNumber: caller, pollingUnitCode: unit })).expect(201);
    const again = await post('create-ticket', report({
      phoneNumber: caller,
      pollingUnitCode: unit,
      description: 'Adding that it was two men in a white car.',
    })).expect(201);

    expect(again.body.data.ticketNumber).toBe(first.body.data.ticketNumber);
    expect(again.body.data.corroborations).toBe(1);
    const stored = await prisma.ticket.findUnique({
      where: { ticketNumber: first.body.data.ticketNumber },
      select: { corroborations: true, verification: true },
    });
    expect(stored?.corroborations).toBe(1);
    expect(stored?.verification).toBe('UNVERIFIED');
  }, 60_000);

  it('keeps a different incident type at the same unit separate', async () => {
    const unit = '15-01-03-011';
    const snatch = await post('create-ticket', report({ pollingUnitCode: unit })).expect(201);
    const buying = await post('create-ticket', report({
      pollingUnitCode: unit,
      subject: 'Vote buying',
      description: 'They are giving money to people at the gate.',
      summary: 'Vote buying at the gate.',
    })).expect(201);

    expect(buying.body.data.ticketNumber).not.toBe(snatch.body.data.ticketNumber);
    const stored = await prisma.ticket.findUnique({
      where: { ticketNumber: buying.body.data.ticketNumber },
      select: { incidentType: true, severity: true },
    });
    expect(stored?.incidentType).toBe('vote_buying');
    expect(stored?.severity).toBe('HIGH');
  }, 60_000);
});

describe('a reporter who may be overheard', () => {
  it('files on the first pass and names no detail back, when the incident is ongoing', async () => {
    // No summaryConfirmed: the read-back is skipped, because reciting
    // "you said men are snatching ballot boxes at Unit 012" out loud can be
    // overheard by the people being reported.
    const res = await post('create-ticket', report({
      pollingUnitCode: '15-01-03-021',
      isOngoing: true,
      summaryConfirmed: undefined,
    })).expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.readBackSkipped).toBe(true);
    expect(res.body.speak).toMatch(/I will not read the details back/i);
    expect(res.body.speak).not.toMatch(/ballot box|snatch/i);
    // Still tells them what to do if they are in danger.
    expect(res.body.speak).toMatch(/1 1 2/);
  }, 60_000);

  it('skips the read-back when the reporter asks, even if the incident is over', async () => {
    const res = await post('create-ticket', report({
      pollingUnitCode: '15-01-03-022',
      noReadBack: true,
      summaryConfirmed: undefined,
    })).expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.readBackSkipped).toBe(true);
  }, 60_000);

  it('still reads back a past incident nobody asked to skip', async () => {
    // Severity is not a proxy for danger-to-the-reporter-now. A report about
    // last night is not overheard, and the read-back is the only thing between
    // a half-heard detail and a case file an officer acts on.
    const res = await post('create-ticket', report({
      pollingUnitCode: '15-01-03-023',
      isOngoing: false,
      summaryConfirmed: undefined,
    })).expect(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.data.filed).toBe(false);
  }, 60_000);
});

describe('capture first', () => {
  it('files an election report it could not classify, and says so', async () => {
    const res = await post('create-ticket', report({
      pollingUnitCode: '15-01-03-031',
      subject: 'Something is wrong here',
      description: 'The arrangement at this polling unit is not correct at all.',
      summary: 'The reporter says the arrangement at the unit is not correct.',
      electionIncident: true,
    })).expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.needsClassification).toBe(true);
    expect(res.body.data.incidentType).toBe('other_election_incident');

    const stored = await prisma.ticket.findUnique({
      where: { ticketNumber: res.body.data.ticketNumber },
      select: { needsClassification: true, incidentType: true, description: true },
    });
    expect(stored?.needsClassification).toBe(true);
    // The reporter's own words are kept whatever the classifier managed.
    expect(stored?.description).toMatch(/not correct at all/);
  }, 60_000);
});

describe('an ordinary service complaint is untouched', () => {
  it('carries no election fields and keeps its service deadline in days', async () => {
    const res = await post('create-ticket', {
      phoneNumber: phone(),
      fullName: 'Garba Mamman',
      subject: 'Collapsed culvert',
      description: 'The culvert on the main road has collapsed and cars cannot pass.',
      category: 'infrastructure',
      lga: 'Gombe',
      ward: 'Pantami',
      community: 'Pantami Junction',
      summary: 'A collapsed culvert at Pantami Junction, Pantami ward, Gombe.',
      summaryConfirmed: true,
    }).expect(201);

    expect(res.body.ok).toBe(true);
    const stored = await prisma.ticket.findUnique({
      where: { ticketNumber: res.body.data.ticketNumber },
      select: { incidentType: true, severity: true, clusterKey: true, verification: true, dueAt: true, createdAt: true, category: true },
    });
    // The service classifier narrows 'infrastructure' to 'roads' for a
    // culvert — existing behaviour, and the point here is only that the
    // ELECTION fields stayed null.
    expect(stored?.category).toBe('roads');
    expect(stored?.incidentType).toBeNull();
    expect(stored?.severity).toBeNull();
    expect(stored?.clusterKey).toBeNull();
    // The default, not a claim about anything.
    expect(stored?.verification).toBe('UNVERIFIED');
    const days = (stored!.dueAt!.getTime() - stored!.createdAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(1);
  }, 60_000);
});

describe('a surge at one polling unit', () => {
  it('becomes ONE incident, with every report accounted for', async () => {
    // Found by `npm run surge -- --scenario cluster`, which no sequential test
    // could have found. Sixty simultaneous reports at one unit produced TWENTY
    // TWO incidents and lost nine reports in twenty, through three separate
    // bugs:
    //
    //   1. read-then-write — every request read "no incident here" before any
    //      had written one, so every request created one;
    //   2. `corroborations: n + 1` computed in JavaScript — simultaneous
    //      writers all read the same n and wrote the same n+1, losing 33 of 60
    //      increments;
    //   3. `crm.createTicket` mapped EVERY P2002 to "Could not allocate a
    //      unique ticket number" in a ConflictException with no `code`, so the
    //      new cluster constraint was reported as a numbering failure and the
    //      caller could not recognise it to retry as a corroboration.
    //
    // Twelve at once is enough to reproduce all three and still run quickly.
    const unit = '15-07-04-077';
    const AT_ONCE = 12;

    const responses = await Promise.all(
      Array.from({ length: AT_ONCE }, (_, i) =>
        post('create-ticket', report({
          phoneNumber: `+2347${String(10000000 + i)}`,
          pollingUnitCode: unit,
          description: `Reporter ${i} saw the ballot box carried off.`,
        })),
      ),
    );

    // Not one report refused. `ok: false` inside an HTTP 201 is still a lost
    // report, and that is how all nine hid on the first surge run.
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
    }

    // All of them point at the same incident.
    const references = new Set(responses.map((r) => r.body.data.ticketNumber));
    expect(references.size).toBe(1);

    const tickets = await prisma.ticket.findMany({
      where: { organizationId: orgId, pollingUnitCode: unit },
      select: { id: true, corroborations: true, verification: true },
    });
    expect(tickets).toHaveLength(1);

    // Every report is accounted for: the creator plus one event each.
    expect(tickets[0].corroborations).toBe(AT_ONCE);
    const events = await prisma.caseEvent.count({
      where: { organizationId: orgId, ticketId: tickets[0].id, type: 'CORROBORATION' },
    });
    expect(events).toBe(AT_ONCE - 1);
    expect(tickets[0].verification).toBe('CORROBORATED');
  }, 120_000);

  it('reports a cluster conflict as a cluster conflict, not a numbering failure', async () => {
    // The error that hid the bug. A P2002 on anything but `ticketNumber` must
    // reach the caller with its code intact, so it can be acted on.
    const { isClusterConflict } = require('../src/agent-tools/election-incident');
    expect(isClusterConflict({ code: 'P2002', meta: { target: ['organizationId', 'clusterKey'] } })).toBe(true);
    // Not swallowed: the numbering retry is a different problem with its own
    // handling, and treating it as a cluster conflict would hide it.
    expect(isClusterConflict({ code: 'P2002', meta: { target: ['ticketNumber'] } })).toBe(false);
    expect(isClusterConflict({ code: 'P2003' })).toBe(false);
    expect(isClusterConflict(new Error('something else'))).toBe(false);
  });
});
