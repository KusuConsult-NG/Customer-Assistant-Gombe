/**
 * Reading a report out of an SMS.
 *
 * ── Why SMS at all ─────────────────────────────────────────────────────────
 *
 * WhatsApp needs data and a voice call needs a usable network. Plenty of
 * Nigerian polling units have neither, and the ones that have neither are
 * disproportionately the rural units where an observer is the only person
 * watching. A channel that works on 2G with one bar is not a downgrade; it is
 * the channel that reaches the places most likely to go unreported.
 *
 * ── The format, and why it is forgiving ────────────────────────────────────
 *
 * The documented shape is:
 *
 *     <CODE> <polling unit> <what happened>
 *     VB 15/01/01/003 they are giving money at the gate
 *
 * but an observer types this one-handed, in a hurry, possibly in the dark, and
 * every part of it is optional:
 *
 *   - No short code? The text is classified by keyword, exactly as a call is.
 *   - No unit code? It resolves by name, or the report files without one and
 *     somebody attaches it later.
 *   - Nothing but prose? That still files. A report that needs a human to sort
 *     out is worth infinitely more than a refusal with a syntax reminder.
 *
 * The one thing never done is guessing: an unparseable unit is left unresolved
 * rather than matched to the nearest-looking one.
 */
import { classifyIncident, incidentType, normaliseUnitCode } from '@ace/database';

/**
 * Short codes an observer can be briefed to use.
 *
 * Two or three letters, because they are typed under pressure and a typo in a
 * long word is a misfiled report. Deliberately mnemonic in English: these are
 * taught at accreditation, not guessed.
 */
export const SMS_CODES: Record<string, string> = {
  VB: 'vote_buying',
  BV: 'bvas_failure',
  BVAS: 'bvas_failure',
  MAT: 'late_or_no_materials',
  LM: 'late_or_no_materials',
  SN: 'ballot_snatching',
  BS: 'ballot_snatching',
  VI: 'violence',
  VL: 'violence',
  IN: 'voter_intimidation',
  UV: 'underage_voting',
  OV: 'over_voting',
  RS: 'result_sheet_irregularity',
  EC: 'result_sheet_irregularity',
  CD: 'collation_dispute',
  IR: 'irev_upload_failure',
  PA: 'party_agent_misconduct',
  SE: 'security_misconduct',
  DE: 'disenfranchisement',
  RL: 'polling_unit_relocation',
  SB: 'secrecy_of_ballot',
};

export interface ParsedSmsReport {
  /** Resolved type, or null when nothing could be read and a human must look. */
  incidentType: string | null;
  /** How it was determined, for the case file. */
  via: 'code' | 'keywords' | 'none';
  /** A unit code if one was typed, normalised. */
  pollingUnitCode: string | null;
  /** A unit NAME if something unit-shaped was typed but was not a code. */
  pollingUnitText: string | null;
  /** Everything the observer wrote, untouched. Always kept. */
  text: string;
  /** What is left after the code and unit are removed — the account. */
  account: string;
  /** The reporter said it is still happening. */
  isOngoing: boolean;
  /** They asked for no read-back, or signalled they cannot talk. */
  discreet: boolean;
}

/** Words observers actually use to say it has not stopped. */
const ONGOING = /\b(ongoing|still|now|happening|as i (write|text|speak)|right now|currently|continuing)\b/i;
/** A request not to be called back or read back to. */
const DISCREET = /\b(do ?n'?t call|dont call|no call|cannot talk|can'?t talk|not safe|discreet|quiet)\b/i;

export function parseSmsReport(body: string): ParsedSmsReport {
  const text = (body ?? '').trim();
  const tokens = text.split(/\s+/).filter(Boolean);

  let incidentTypeId: string | null = null;
  let via: ParsedSmsReport['via'] = 'none';
  let rest = [...tokens];

  // A leading short code, if there is one.
  if (rest.length) {
    const head = rest[0].replace(/[^A-Za-z]/g, '').toUpperCase();
    const mapped = SMS_CODES[head];
    if (mapped) {
      incidentTypeId = mapped;
      via = 'code';
      rest = rest.slice(1);
    }
  }

  // A unit code anywhere in the message. Checked token by token AND as pairs,
  // because "15/01/01 003" arrives split by a stray space more often than not.
  let pollingUnitCode: string | null = null;
  let consumed = -1;
  for (let i = 0; i < rest.length; i++) {
    const single = normaliseUnitCode(rest[i]);
    if (single) { pollingUnitCode = single; consumed = i; break; }
    if (i + 1 < rest.length) {
      const joined = normaliseUnitCode(`${rest[i]}-${rest[i + 1]}`);
      if (joined) { pollingUnitCode = joined; consumed = i; rest.splice(i, 1); break; }
    }
  }
  if (consumed >= 0) rest.splice(consumed, 1);

  const account = rest.join(' ').trim();

  // No code: read the words, exactly as a phone call is read.
  if (!incidentTypeId) {
    const guessed = classifyIncident(text);
    if (guessed) { incidentTypeId = guessed.id; via = 'keywords'; }
  }

  // Something unit-shaped but not a code — "central pri sch" — kept for the
  // resolver to try by name, never guessed at here.
  const pollingUnitText =
    !pollingUnitCode && /\b(pri|primary|sch|school|unit|hall|open space|market|clinic|dispensary)\b/i.test(account)
      ? account
      : null;

  return {
    incidentType: incidentTypeId && incidentType(incidentTypeId) ? incidentTypeId : null,
    via,
    pollingUnitCode,
    pollingUnitText,
    text,
    account: account || text,
    isOngoing: ONGOING.test(text),
    discreet: DISCREET.test(text),
  };
}

/**
 * The reply, which must fit one SMS segment and cost the observer nothing to read.
 *
 * 160 GSM-7 characters. Longer and the carrier splits it into two billable
 * parts, which on a prepaid line in a rural ward is a real cost and a real
 * reason to stop reporting. So: the reference, and whether more is needed.
 * Never the details back — an SMS sits in an inbox somebody else may read.
 */
export function smsAck(reference: string, opts: { unitMissing?: boolean; unclassified?: boolean } = {}): string {
  const base = `Recorded. Ref ${reference}.`;
  if (opts.unitMissing) return `${base} Reply with your polling unit code if you can.`;
  if (opts.unclassified) return `${base} An officer will call to confirm what happened.`;
  return `${base} Thank you.`;
}

export const SMS_SEGMENT_LIMIT = 160;
