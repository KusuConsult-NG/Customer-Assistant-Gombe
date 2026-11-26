/**
 * Pure 2G SMS parsers for Election-Day check-ins and Form EC8A results.
 *
 * Examples:
 *   CHK 15/01/01/003 MAT OK
 *   CHECKIN 15/01/01/003 VOTING
 *   RES 15/01/01/003 ACC 420 APC 290 PDP 115 NNPP 10 REJ 5
 *
 * Returns null if the message does not start with a check-in or result prefix,
 * so ordinary incident SMS messages fall straight through to `parseSmsReport`.
 */
import { normaliseUnitCode } from '@ace/database';

export interface ParsedCheckInSms {
  kind: 'CHECKIN';
  pollingUnitCode: string | null;
  milestone:
    | 'AGENT_ARRIVED'
    | 'MATERIALS_ARRIVED'
    | 'VOTING_STARTED'
    | 'VOTING_CLOSED'
    | 'COUNTING_COMPLETED'
    | 'EC8A_SUBMITTED'
    | 'IREV_UPLOADED';
  bvasWorking?: boolean;
  notes: string;
}

export interface ParsedResultSms {
  kind: 'RESULT';
  pollingUnitCode: string | null;
  accreditedVoters: number;
  votesByParty: Record<string, number>;
  rejectedVotes: number;
  rawText: string;
}

export function parseCampaignSms(raw: string): ParsedCheckInSms | ParsedResultSms | null {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const tokens = text.split(' ');
  const head = tokens[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  if (head === 'CHK' || head === 'CHECKIN' || head === 'ARRIVED') {
    let pollingUnitCode: string | null = null;
    const rest = tokens.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const u = normaliseUnitCode(rest[i]);
      if (u) {
        pollingUnitCode = u;
        break;
      }
      if (i + 1 < rest.length) {
        const joined = normaliseUnitCode(`${rest[i]}-${rest[i + 1]}`);
        if (joined) {
          pollingUnitCode = joined;
          break;
        }
      }
    }

    const upper = text.toUpperCase();
    let milestone: ParsedCheckInSms['milestone'] = 'AGENT_ARRIVED';
    if (/\bIREV\b/.test(upper)) milestone = 'IREV_UPLOADED';
    else if (/\bEC8A\b/.test(upper)) milestone = 'EC8A_SUBMITTED';
    else if (/\bCOUNT(ING|ED)?\b/.test(upper)) milestone = 'COUNTING_COMPLETED';
    else if (/\bCLOS(E|ED)\b/.test(upper)) milestone = 'VOTING_CLOSED';
    else if (/\bVOT(E|ING)\b|\bSTART(ED)?\b|\bOPEN(ED)?\b/.test(upper)) milestone = 'VOTING_STARTED';
    else if (/\bMAT(ERIALS?)?\b|\bBVAS\b/.test(upper)) milestone = 'MATERIALS_ARRIVED';

    let bvasWorking: boolean | undefined;
    if (/\bBVAS\s*(FAIL|BAD|NO|DOWN|ISSUE)\b/.test(upper)) bvasWorking = false;
    else if (/\b(BVAS|MAT)\s*(OK|GOOD|WORK|READY)\b/.test(upper)) bvasWorking = true;

    return {
      kind: 'CHECKIN',
      pollingUnitCode,
      milestone,
      bvasWorking,
      notes: text,
    };
  }

  if (head === 'RES' || head === 'RESULT' || head === 'EC8A') {
    let pollingUnitCode: string | null = null;
    const rest = tokens.slice(1);
    const remaining: string[] = [];

    for (let i = 0; i < rest.length; i++) {
      if (!pollingUnitCode) {
        const u = normaliseUnitCode(rest[i]);
        if (u) {
          pollingUnitCode = u;
          continue;
        }
        if (i + 1 < rest.length) {
          const joined = normaliseUnitCode(`${rest[i]}-${rest[i + 1]}`);
          if (joined) {
            pollingUnitCode = joined;
            i++;
            continue;
          }
        }
      }
      remaining.push(rest[i]);
    }

    let accreditedVoters = 0;
    let rejectedVotes = 0;
    const votesByParty: Record<string, number> = {};

    // Accept both "APC 290" and "APC:290" / "APC=290"
    for (let i = 0; i < remaining.length; i++) {
      const tok = remaining[i];
      const inline = tok.match(/^([A-Za-z]{2,10})[:=](\d+)$/);
      let label: string | null = null;
      let val: number | null = null;
      if (inline) {
        label = inline[1].toUpperCase();
        val = Number(inline[2]);
      } else if (/^[A-Za-z]{2,10}$/.test(tok) && i + 1 < remaining.length && /^\d+$/.test(remaining[i + 1])) {
        label = tok.toUpperCase();
        val = Number(remaining[i + 1]);
        i++;
      }
      if (!label || val === null || !Number.isFinite(val)) continue;
      if (label === 'ACC' || label === 'ACCREDITED') {
        accreditedVoters = val;
      } else if (label === 'REJ' || label === 'REJECTED' || label === 'INV' || label === 'INVALID') {
        rejectedVotes = val;
      } else if (label !== 'TOT' && label !== 'TOTAL' && label !== 'VAL' && label !== 'VALID') {
        votesByParty[label] = val;
      }
    }

    return {
      kind: 'RESULT',
      pollingUnitCode,
      accreditedVoters,
      votesByParty,
      rejectedVotes,
      rawText: text,
    };
  }

  return null;
}
