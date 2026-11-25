#!/usr/bin/env node
/**
 * Apply each agency's retention period (PRD §18 "retention/deletion schedules").
 *
 *   node scripts/apply-retention.js            # report only: what WOULD be removed
 *   node scripts/apply-retention.js --apply    # remove it
 *
 * For every agency with `retentionDays` set, message text, call transcripts and
 * call recordings older than that many days are REMOVED — replaced with a
 * marker, not deleted as rows — so the record that a conversation or call
 * happened (and every dashboard and report built on it) survives, while what
 * the citizen said does not. An agency with no period set is left alone.
 *
 * Deliberately a script, report-first, like contacts:dedupe and
 * secrets:encrypt: removing citizens' words is irreversible and should be an
 * act somebody chose to perform, with the counts in front of them, not a
 * nightly side effect nobody looked at. Schedule it once the report has been
 * read and the period agreed with the agency's data-protection officer.
 *
 * ── Legal hold ──────────────────────────────────────────────────────────────
 *
 * Anything belonging to an incident under LEGAL HOLD is skipped. An election
 * petition has a statutory filing window that runs from the declaration of a
 * result, and this job's age rule knows nothing about it — so without this,
 * `placeLegalHold` set a flag that nothing read, and a held incident's
 * conversation would have been redacted on schedule anyway.
 *
 * What is held is NOT only the files. The reporter's own words in a WhatsApp
 * message and the transcript of the call they made ARE evidence of what they
 * said and when, and those are precisely what this job removes. The files
 * themselves are safe for a different reason: since the evidence pipeline
 * stores bytes under `Evidence.storagePath`, blanking `Message.mediaUrl` no
 * longer destroys anything — but that is a property of the evidence table, not
 * of this job, and it does not cover the words.
 *
 * Held conversations and calls are found through `Evidence`, which carries the
 * structured `conversationId` / `callSid` / `messageId` of whatever arrived,
 * and through the `Call reference:` line the intake writes onto a case event
 * for a voice report that sent no media.
 *
 * Every applied run writes an AuditLog entry per agency with the counts,
 * including how much was skipped as held.
 */
const path = require('path');
require(path.join(__dirname, '..', 'apps', 'api', 'dist', 'config', 'load-env.js'));
const { PrismaClient } = require('@prisma/client');

const MARKER = '[removed under the agency’s retention policy]';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany({
      where: { retentionDays: { not: null } },
      select: { id: true, name: true, retentionDays: true },
    });
    if (!orgs.length) {
      console.log('No agency has a retention period set. Nothing to do.');
      return;
    }
    let total = 0;
    let totalHeld = 0;
    for (const org of orgs) {
      const cutoff = new Date(Date.now() - org.retentionDays * 86_400_000);

      // ── What is under legal hold, and therefore exempt ────────────────────
      const heldTickets = await prisma.ticket.findMany({
        where: { organizationId: org.id, legalHold: true },
        select: { id: true, events: { select: { body: true } } },
      });
      const heldEvidence = heldTickets.length
        ? await prisma.evidence.findMany({
            where: { organizationId: org.id, ticketId: { in: heldTickets.map((t) => t.id) } },
            select: { conversationId: true, callSid: true, messageId: true },
          })
        : [];

      const heldConversationIds = new Set(
        heldEvidence.map((e) => e.conversationId).filter(Boolean),
      );
      const heldCallSids = new Set(heldEvidence.map((e) => e.callSid).filter(Boolean));
      const heldMessageIds = new Set(heldEvidence.map((e) => e.messageId).filter(Boolean));

      // A voice report that sent no media has no Evidence row; the intake
      // writes "Call reference: <conversationId>." onto its case event.
      for (const t of heldTickets) {
        for (const ev of t.events) {
          for (const m of String(ev.body ?? '').matchAll(/Call reference:\s*([0-9a-zA-Z_-]+)\./g)) {
            heldConversationIds.add(m[1]);
          }
        }
      }

      const msgWhere = {
        conversation: { organizationId: org.id },
        sentAt: { lt: cutoff },
        NOT: { content: MARKER },
        ...(heldConversationIds.size || heldMessageIds.size
          ? {
              AND: [
                ...(heldConversationIds.size ? [{ conversationId: { notIn: [...heldConversationIds] } }] : []),
                ...(heldMessageIds.size ? [{ externalId: { notIn: [...heldMessageIds] } }] : []),
              ],
            }
          : {}),
      };
      const callWhere = {
        organizationId: org.id,
        startedAt: { lt: cutoff },
        OR: [{ transcript: { not: null } }, { recordingUrl: { not: null } }],
        ...(heldCallSids.size ? { callSid: { notIn: [...heldCallSids] } } : {}),
      };

      // Counted so a person can see the hold working rather than infer it.
      const heldFromDeletion = heldConversationIds.size || heldCallSids.size
        ? await prisma.message.count({
            where: {
              conversation: { organizationId: org.id },
              sentAt: { lt: cutoff },
              NOT: { content: MARKER },
              conversationId: { in: [...heldConversationIds] },
            },
          }) +
          (heldCallSids.size
            ? await prisma.callLog.count({
                where: {
                  organizationId: org.id,
                  startedAt: { lt: cutoff },
                  OR: [{ transcript: { not: null } }, { recordingUrl: { not: null } }],
                  callSid: { in: [...heldCallSids] },
                },
              })
            : 0)
        : 0;
      totalHeld += heldFromDeletion;
      const [messages, calls] = await Promise.all([prisma.message.count({ where: msgWhere }), prisma.callLog.count({ where: callWhere })]);
      total += messages + calls;
      console.log(`${org.name}: keep ${org.retentionDays} days (before ${cutoff.toISOString().slice(0, 10)}) — ${messages} message(s), ${calls} call transcript/recording(s)`);
      if (heldTickets.length) {
        console.log(`  ${heldFromDeletion} item(s) SKIPPED under legal hold, across ${heldTickets.length} held incident(s).`);
      }
      if (!apply || messages + calls === 0) continue;
      await prisma.$transaction([
        prisma.message.updateMany({ where: msgWhere, data: { content: MARKER, mediaUrl: null } }),
        prisma.callLog.updateMany({ where: callWhere, data: { transcript: null, recordingUrl: null } }),
        prisma.auditLog.create({
          data: {
            organizationId: org.id,
            actor: 'system:retention',
            action: 'retention.applied',
            targetType: 'Organization',
            targetId: org.id,
            newValue: {
              retentionDays: org.retentionDays,
              cutoff: cutoff.toISOString(),
              messages,
              calls,
              skippedUnderLegalHold: heldFromDeletion,
              heldIncidents: heldTickets.length,
            },
          },
        }),
      ]);
      console.log('  applied.');
    }
    if (totalHeld > 0) {
      console.log(`\n${totalHeld} item(s) are under legal hold and will NOT be removed.`);
    }
    if (!apply && total > 0) console.log('\nReport only. Re-run with --apply to remove the above.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
