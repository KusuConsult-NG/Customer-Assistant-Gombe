/**
 * The petition bundle.
 *
 * This had no test, and it is the one output of the whole platform that may end
 * up in front of a tribunal. Four things have to hold, and none of them is
 * guaranteed by the code merely running:
 *
 *   1. It must not cross a tenant boundary. A bundle is assembled by one
 *      organisation about one polling unit; another organisation's report about
 *      the same unit is not theirs to file.
 *   2. Every file must carry its SHA-256, because the hash is the only thing
 *      that shows the copy filed is the copy that arrived.
 *   3. Exporting must stop deletion. The normal reason to export is that
 *      somebody is considering a petition, which is exactly when the retention
 *      job must not run over the evidence. (That the hold is then honoured is
 *      proved in scripts/retention-legal-hold.spec.ts.)
 *   4. It must not overstate itself. An UNVERIFIED report is one report that
 *      nobody checked, and a bundle that reads as a finding is worse than no
 *      bundle at all.
 */
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@ace/database';
import { PetitionExportService } from '../src/situation-room/petition-export.service';

const svc = new PetitionExportService();
const UNIT = '15/01/01/003';

let orgA: string;
let orgB: string;

const makeOrg = async () => {
  const o = await prisma.organization.create({
    data: { name: `Pet ${randomBytes(3).toString('hex')}`, slug: `p-${randomBytes(5).toString('hex')}`, industry: 'OTHER' },
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
      description: 'They took the box towards the market.',
      incidentType: 'ballot_snatching',
      severity: 'CRITICAL',
      verification: 'UNVERIFIED',
      pollingUnitCode: UNIT,
      lga: 'Akko',
      ...over,
    },
    select: { id: true, ticketNumber: true },
  });
};

beforeAll(async () => {
  orgA = await makeOrg();
  orgB = await makeOrg();
});
afterAll(async () => {
  for (const id of [orgA, orgB]) if (id) await prisma.organization.delete({ where: { id } }).catch(() => {});
});

describe('bundleForUnit', () => {
  it('contains only the exporting organisation’s incidents', async () => {
    const mine = await fileIncident(orgA);
    const theirs = await fileIncident(orgB, { subject: 'Another org’s report' });

    const bundle = await svc.bundleForUnit(orgA, UNIT, { hold: false });
    const refs = bundle.incidents.map((i: any) => i.reference);
    expect(refs).toContain(mine.ticketNumber);
    expect(refs).not.toContain(theirs.ticketNumber);
  });

  it('gives a SHA-256 for every evidence file, and it is the hash of the bytes', async () => {
    const t = await fileIncident(orgA);
    const bytes = Buffer.from('pretend this is the video the observer sent');
    const digest = createHash('sha256').update(bytes).digest('hex');
    await prisma.evidence.create({
      data: {
        organizationId: orgA,
        ticketId: t.id,
        channel: 'WHATSAPP',
        kind: 'video',
        storagePath: `evidence/${digest}.mp4`,
        mimeType: 'video/mp4',
        byteSize: bytes.byteLength,
        sha256: digest,
      },
    });

    const bundle = await svc.bundleForUnit(orgA, UNIT, { hold: false });
    const files = bundle.incidents.flatMap((i: any) => i.evidence);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.byteSize).toBeGreaterThan(0);
    }
    expect(files.map((f: any) => f.sha256)).toContain(digest);
  });

  it('places a legal hold by default, and does not when asked not to', async () => {
    const held = await fileIncident(orgA, { pollingUnitCode: '15/01/01/009' });
    await svc.bundleForUnit(orgA, '15/01/01/009', { reason: 'Petition window open', actorLabel: 'Legal' });
    const afterHold = await prisma.ticket.findUnique({ where: { id: held.id }, select: { legalHold: true, legalHoldReason: true } });
    expect(afterHold?.legalHold).toBe(true);
    expect(afterHold?.legalHoldReason).toBeTruthy();

    const loose = await fileIncident(orgA, { pollingUnitCode: '15/01/01/010' });
    await svc.bundleForUnit(orgA, '15/01/01/010', { hold: false });
    const afterNoHold = await prisma.ticket.findUnique({ where: { id: loose.id }, select: { legalHold: true } });
    expect(afterNoHold?.legalHold).toBe(false);
  });

  it('states what UNVERIFIED means instead of letting a reader assume', async () => {
    await fileIncident(orgA, { pollingUnitCode: '15/01/01/011' });
    const bundle = await svc.bundleForUnit(orgA, '15/01/01/011', { hold: false });
    expect(bundle.readThisFirst.join(' ')).toMatch(/UNVERIFIED means one report and nobody checked/);
    expect(bundle.summary.byVerification.unverified).toBe(1);
    expect(bundle.summary.byVerification.verified).toBe(0);
  });

  it('withholds an anonymous reporter’s contact details', async () => {
    await fileIncident(orgA, { pollingUnitCode: '15/01/01/012', isAnonymous: true });
    const bundle = await svc.bundleForUnit(orgA, '15/01/01/012', { hold: false });
    const [i] = bundle.incidents;
    expect(i.reportedBy.kind).toBe('ANONYMOUS');
    expect(JSON.stringify(i.reportedBy)).not.toMatch(/\+234/);
  });

  it('strips the internal contact marker from a corroborating account', async () => {
    const t = await fileIncident(orgA, { pollingUnitCode: '15/01/01/013' });
    const contactId = randomBytes(16).toString('hex');
    await prisma.caseEvent.create({
      data: {
        organizationId: orgA,
        ticketId: t.id,
        type: 'CORROBORATION',
        body: `contact:${contactId}\nI was there too and they drove off in a white bus.`,
      },
    });
    const bundle = await svc.bundleForUnit(orgA, '15/01/01/013', { hold: false });
    const accounts = bundle.incidents.flatMap((i: any) => i.furtherAccounts).map((a: any) => a.account);
    expect(accounts.join(' ')).toMatch(/white bus/);
    expect(accounts.join(' ')).not.toMatch(/contact:/);
  });

  it('refuses to produce a bundle for a unit with nothing reported', async () => {
    // Deliberately NOT an empty bundle. A signed, hashed document headed with a
    // polling unit and containing no incidents reads as a finding that nothing
    // happened there. What is actually true is that this platform holds
    // nothing about it — which may only mean nobody was there to report. The
    // weaker claim is the honest one, so there is no document to misread.
    await expect(svc.bundleForUnit(orgA, '15/01/01/099', { hold: false })).rejects.toThrow(
      /No incidents recorded for polling unit/,
    );
  });
});
