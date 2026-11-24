/**
 * Keeping what a reporter sent.
 *
 * ── The data loss this exists to stop ───────────────────────────────────────
 *
 * Inbound media was downloaded, handed to the model for a transcript or a
 * description, and the BYTES DISCARDED. What survived in the database was that
 * description plus `Message.mediaUrl` — a `graph.facebook.com/v22.0/<id>` URL
 * that needs a provider token and expires with the provider's own retention.
 *
 * For a service case that is tolerable: "a photograph of a collapsed culvert"
 * is enough to send an engineer. For an election incident it is a total loss.
 * A photograph of a ballot box being carried away becomes a sentence of
 * model prose — hearsay about a file nobody can produce — and the file is gone
 * before anyone files a petition.
 *
 * ── What this does instead ──────────────────────────────────────────────────
 *
 * The bytes go to our own storage, unmodified, and are hashed at the moment of
 * receipt. The hash is the point: it is what later lets anyone show the copy
 * produced in a tribunal is the copy that arrived. Nothing in this module
 * rewrites, re-encodes, compresses or strips a file, because every one of those
 * destroys the metadata (the capture time, the device, the position) that makes
 * a photograph worth having.
 *
 * `derivedText` — the transcript or description — is stored ALONGSIDE the file,
 * never instead of it, and it is labelled as a description rather than a
 * finding. A model saying "this appears to show ballot snatching" is not
 * evidence that ballot snatching occurred.
 *
 * ── Deduplication ───────────────────────────────────────────────────────────
 *
 * The same photograph forwarded by six observers is one file. Storing it once
 * per report, under six paths, would make the same image look like six
 * independent pieces of evidence — which is exactly the inference a situation
 * room must not make. So ingest is keyed on the hash: a file already held is
 * linked, not stored again, and the caller is told it was a duplicate so the
 * corroboration count is not inflated by a forward.
 */
import { createHash } from 'crypto';
import { prisma } from '@ace/database';
import { uploadObject } from './object-storage';
import { AceLogger } from '../config/logger';

const log = new AceLogger('Evidence');

export const EVIDENCE_BUCKET = 'incident-evidence';

export type EvidenceKind = 'image' | 'audio' | 'video' | 'document';

export interface IngestInput {
  organizationId: string;
  bytes: Buffer;
  mimeType: string;
  kind: EvidenceKind;
  channel: string;
  /** The provider's own id for the file, kept so its origin is traceable. */
  sourceRef?: string | null;
  fileName?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  callSid?: string | null;
  ticketId?: string | null;
  /** The model's description or transcript. Never a finding. */
  derivedText?: string | null;
  /** From the file's own metadata, when the caller could read it. */
  capturedAt?: Date | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface IngestResult {
  id: string;
  sha256: string;
  storagePath: string;
  /** True when this hash was already held and the stored file was reused. */
  duplicate: boolean;
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A safe, non-colliding file name that keeps the extension for replay. */
function storedName(sha: string, mimeType: string, fileName?: string | null): string {
  const fromName = (fileName ?? '').match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  const fromMime = mimeType.split('/')[1]?.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const ext = (fromName || fromMime || 'bin').toLowerCase();
  return `${sha}.${ext}`;
}

/**
 * Store a file and record it, or link the one already held with that hash.
 *
 * NEVER THROWS. A failure to store evidence must not lose the report it came
 * with: the caller files the report either way and this returns null, which is
 * logged loudly because it means a citizen's photograph did not survive.
 */
export async function ingestEvidence(input: IngestInput): Promise<IngestResult | null> {
  const sha256 = sha256Of(input.bytes);
  try {
    const held = await prisma.evidence.findFirst({
      where: { organizationId: input.organizationId, sha256 },
      select: { id: true, storagePath: true },
    });

    if (held) {
      // Same bytes, new report: link it, do not store a second copy.
      const linked = await prisma.evidence.create({
        data: {
          organizationId: input.organizationId,
          ticketId: input.ticketId ?? null,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
          messageId: input.messageId ?? null,
          callSid: input.callSid ?? null,
          channel: input.channel,
          kind: input.kind,
          storagePath: held.storagePath,
          mimeType: input.mimeType,
          byteSize: input.bytes.byteLength,
          sha256,
          sourceRef: input.sourceRef ?? null,
          derivedText: input.derivedText ?? null,
          capturedAt: input.capturedAt ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        },
        select: { id: true },
      });
      log.info('evidence_duplicate_linked', {
        organizationId: input.organizationId, sha256, evidenceId: linked.id,
      });
      return { id: linked.id, sha256, storagePath: held.storagePath, duplicate: true };
    }

    const storagePath = await uploadObject(
      EVIDENCE_BUCKET,
      input.organizationId,
      storedName(sha256, input.mimeType, input.fileName),
      input.bytes,
      input.mimeType,
    );

    const row = await prisma.evidence.create({
      data: {
        organizationId: input.organizationId,
        ticketId: input.ticketId ?? null,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        callSid: input.callSid ?? null,
        channel: input.channel,
        kind: input.kind,
        storagePath,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        sha256,
        sourceRef: input.sourceRef ?? null,
        derivedText: input.derivedText ?? null,
        capturedAt: input.capturedAt ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
      select: { id: true },
    });

    log.info('evidence_stored', {
      organizationId: input.organizationId,
      evidenceId: row.id,
      sha256,
      kind: input.kind,
      byteSize: input.bytes.byteLength,
    });
    return { id: row.id, sha256, storagePath, duplicate: false };
  } catch (err: any) {
    // Loud: this is a citizen's evidence that did not survive.
    log.error('evidence_not_stored', err instanceof Error ? err : new Error(String(err)), {
      organizationId: input.organizationId,
      sha256,
      kind: input.kind,
      byteSize: input.bytes.byteLength,
    });
    return null;
  }
}

/** Attach already-stored evidence to a report once the report exists. */
export async function attachEvidenceToTicket(
  organizationId: string,
  evidenceIds: string[],
  ticketId: string,
): Promise<number> {
  if (evidenceIds.length === 0) return 0;
  const { count } = await prisma.evidence.updateMany({
    where: { organizationId, id: { in: evidenceIds }, ticketId: null },
    data: { ticketId },
  });
  return count;
}

/**
 * Put evidence beyond the reach of the retention job.
 *
 * An election petition has a statutory filing window that runs from the
 * declaration of a result, and `retention:apply` deletes on an age rule that
 * knows nothing about it. A legal hold is the override, and it is deliberately
 * explicit and reasoned rather than a side effect of a category: somebody
 * decides, and the reason is on the record.
 */
export async function placeLegalHold(
  organizationId: string,
  opts: { ticketIds?: string[]; evidenceIds?: string[]; reason: string },
): Promise<{ tickets: number; evidence: number }> {
  const reason = opts.reason.trim();
  if (!reason) throw new Error('A legal hold needs a reason: it is the record of why deletion was stopped.');

  const tickets = opts.ticketIds?.length
    ? (await prisma.ticket.updateMany({
        where: { organizationId, id: { in: opts.ticketIds } },
        data: { legalHold: true, legalHoldReason: reason },
      })).count
    : 0;

  // Everything attached to a held report is held with it: the report without
  // its photographs is not what was placed on hold.
  const evidenceIds = new Set(opts.evidenceIds ?? []);
  if (opts.ticketIds?.length) {
    const attached = await prisma.evidence.findMany({
      where: { organizationId, ticketId: { in: opts.ticketIds } },
      select: { id: true },
    });
    for (const e of attached) evidenceIds.add(e.id);
  }

  const evidence = evidenceIds.size
    ? (await prisma.evidence.updateMany({
        where: { organizationId, id: { in: [...evidenceIds] } },
        data: { legalHold: true, legalHoldReason: reason },
      })).count
    : 0;

  log.info('legal_hold_placed', { organizationId, tickets, evidence, reason });
  return { tickets, evidence };
}
