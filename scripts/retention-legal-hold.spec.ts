/**
 * Legal hold must survive the retention job.
 *
 * `placeLegalHold` set a flag that NOTHING READ. The retention job redacts
 * message text and call transcripts on an age rule, and for an election
 * incident the reporter's own words and the transcript of their call ARE the
 * evidence of what they said and when. So a held incident inside a petition's
 * filing window would have been quietly redacted on schedule.
 *
 * Found by verifying the claim rather than trusting it.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { prisma } from '@ace/database';

const ROOT = join(__dirname, '..');
const MARKER = '[removed under the agency’s retention policy]';

const runRetention = () =>
  execFileSync('node', [join(ROOT, 'scripts', 'apply-retention.js'), '--apply'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });

describe('the retention job and legal hold', () => {
  let orgId: string;
  const old = new Date(Date.now() - 400 * 86_400_000);

  const seed = async (held: boolean) => {
    const org = await prisma.organization.create({
      data: {
        name: `Retention hold ${randomBytes(3).toString('hex')}`,
        slug: `rh-${randomBytes(5).toString('hex')}`,
        industry: 'OTHER',
        // Short enough that the seeded rows are well past the cutoff.
        retentionDays: 30,
      },
      select: { id: true },
    });
    orgId = org.id;

    const contact = await prisma.contact.create({
      data: { organizationId: orgId, phoneNumber: `+234${randomBytes(5).toString('hex').replace(/\D/g, '').padEnd(10, '7').slice(0, 10)}`, fullName: 'Observer' },
      select: { id: true },
    });
    const conversation = await prisma.conversation.create({
      data: { organizationId: orgId, contactId: contact.id, channel: 'WHATSAPP' },
      select: { id: true },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'CUSTOMER',
        content: 'They snatched the ballot box at my unit and I filmed it.',
        sentAt: old,
      },
      select: { id: true },
    });
    const ticket = await prisma.ticket.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        ticketNumber: `TCK-${randomBytes(6).toString('hex')}`,
        subject: 'Ballot box snatched',
        description: 'Reporter account.',
        incidentType: 'ballot_snatching',
        legalHold: held,
        legalHoldReason: held ? 'Petition window open' : null,
      },
      select: { id: true },
    });
    // The structured link the retention job follows.
    await prisma.evidence.create({
      data: {
        organizationId: orgId,
        ticketId: ticket.id,
        conversationId: conversation.id,
        channel: 'WHATSAPP',
        kind: 'video',
        storagePath: 'test/held.mp4',
        mimeType: 'video/mp4',
        byteSize: 10,
        sha256: randomBytes(32).toString('hex'),
      },
    });
    return { messageId: message.id };
  };

  afterEach(async () => {
    if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  });

  it('does NOT redact the words of an incident under legal hold', async () => {
    const { messageId } = await seed(true);
    runRetention();
    const after = await prisma.message.findUnique({ where: { id: messageId }, select: { content: true } });
    expect(after?.content).toBe('They snatched the ballot box at my unit and I filmed it.');
    expect(after?.content).not.toBe(MARKER);
  }, 120_000);

  it('DOES redact an identical incident that is not held', async () => {
    // The other half of the red-green: if this passed too, the test above
    // would prove nothing — it would just mean retention was not running.
    const { messageId } = await seed(false);
    runRetention();
    const after = await prisma.message.findUnique({ where: { id: messageId }, select: { content: true } });
    expect(after?.content).toBe(MARKER);
  }, 120_000);
});
