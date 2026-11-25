/**
 * Matching a caller to the accredited roster.
 *
 * This had no test. The module is deliberately weak — it raises confidence and
 * records a deployment, and must never refuse a report — and "deliberately
 * weak" is exactly the kind of promise that decays unnoticed. Three of its
 * promises matter enough to pin down:
 *
 *   1. An empty roster yields UNKNOWN, not PUBLIC. Before anyone has been
 *      accredited, "this is a member of the public" is a claim we cannot make,
 *      and a briefing that counts unmatched callers as public before the
 *      roster is loaded understates its own coverage.
 *   2. A number written three ways is one person. A roster loaded as 0803… and
 *      a call arriving as +234803… must match, or half the roster is silently
 *      demoted to the public on election morning.
 *   3. Reporting from the wrong place is NOTED, never refused. Observers get
 *      moved, and the ones who move are often following the trouble.
 */
import { randomBytes } from 'crypto';
import { prisma } from '@ace/database';
import { matchReporter, deploymentNote } from '../src/agent-tools/accredited-reporter';

let orgId: string;

const makeOrg = async () => {
  const o = await prisma.organization.create({
    data: { name: `Roster ${randomBytes(3).toString('hex')}`, slug: `r-${randomBytes(5).toString('hex')}`, industry: 'OTHER' },
    select: { id: true },
  });
  return o.id;
};

const enrol = (over: Record<string, any> = {}) =>
  prisma.accreditedReporter.create({
    data: {
      organizationId: orgId,
      code: `OBS-${randomBytes(3).toString('hex').toUpperCase()}`,
      fullName: 'Hadiza Yakubu',
      phoneNumber: '08031234567',
      role: 'OBSERVER',
      deployedLga: 'Akko',
      active: true,
      ...over,
    },
  });

beforeEach(async () => {
  orgId = await makeOrg();
});
afterEach(async () => {
  if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
});

describe('matchReporter', () => {
  it('says UNKNOWN, not PUBLIC, while the roster is empty', async () => {
    const m = await matchReporter(orgId, { phoneNumber: '+2348031234567' });
    expect(m.kind).toBe('UNKNOWN');
    expect(m.reporterId).toBeNull();
  });

  it('says PUBLIC once a roster exists and the caller is not on it', async () => {
    await enrol();
    const m = await matchReporter(orgId, { phoneNumber: '+2349999999999' });
    expect(m.kind).toBe('PUBLIC');
    expect(m.reporterId).toBeNull();
  });

  it.each([
    ['+2348031234567', 'international'],
    ['08031234567', 'local leading zero'],
    ['2348031234567', 'no plus'],
    ['803 123 4567', 'spaced'],
  ])('matches %s (%s) to a roster row stored as 08031234567', async (incoming) => {
    const row = await enrol();
    const m = await matchReporter(orgId, { phoneNumber: incoming });
    expect(m.kind).toBe('ACCREDITED');
    expect(m.reporterId).toBe(row.id);
  });

  it('matches on the code the caller reads out when the handset is not theirs', async () => {
    // The case this exists for: the observer's phone died and they are calling
    // from a colleague's. A phone number is not a credential.
    const row = await enrol();
    const m = await matchReporter(orgId, { phoneNumber: '+2340000000000', reporterCode: row.code.toLowerCase() });
    expect(m.kind).toBe('ACCREDITED');
    expect(m.reporterId).toBe(row.id);
  });

  it('notes a report from outside the deployment without refusing it', async () => {
    await enrol({ deployedLga: 'Akko' });
    const m = await matchReporter(orgId, { phoneNumber: '08031234567', lga: 'Billiri' });
    expect(m.kind).toBe('ACCREDITED');
    expect(m.awayFromDeployment).toBe(true);
    expect(deploymentNote(m)).toMatch(/OUTSIDE THEIR DEPLOYMENT/);
  });

  it('does not cry wolf when the same LGA is spelled differently', async () => {
    // INEC writes it "YALMALTU/ DEBA"; a caller says "Yamaltu Deba". Flagging
    // that as off-deployment would put a false note on every real report from
    // the LGA whose name is spelled two ways.
    await enrol({ deployedLga: 'Yamaltu/Deba' });
    const m = await matchReporter(orgId, { phoneNumber: '08031234567', lga: 'yalmaltu deba' });
    expect(m.awayFromDeployment).toBe(false);
  });

  it('keeps the reporter out of what is spoken', () => {
    // deploymentNote is the ONLY place the name and code may appear, and it is
    // a case-file line. Reading "you are accredited observer OBS-123" back to
    // a caller announces, possibly within earshot, who they are.
    expect(deploymentNote({ kind: 'PUBLIC', reporterId: null, label: null, awayFromDeployment: false, deployment: null })).toBeNull();
    expect(deploymentNote({ kind: 'UNKNOWN', reporterId: null, label: null, awayFromDeployment: false, deployment: null })).toBeNull();
  });

  it('never throws, and never blocks a report, when the roster lookup fails', async () => {
    // A report must be filed even if the roster is unreachable.
    const m = await matchReporter('not-a-real-org-id', { phoneNumber: '08031234567' });
    expect(m.kind).toBe('UNKNOWN');
  });
});
