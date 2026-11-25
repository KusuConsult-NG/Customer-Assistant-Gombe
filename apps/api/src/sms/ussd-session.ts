/**
 * The USSD menu, as a state machine.
 *
 * ── Why USSD, when SMS already works ───────────────────────────────────────
 *
 * USSD runs on the signalling channel. It works where SMS is delayed and data
 * is absent, it is session-based so the network holds the connection, and —
 * the part that matters most — the observer pays nothing on most Nigerian
 * aggregator arrangements. An observer on a prepaid line with ₦0 credit can
 * still report. Nothing else in this platform can say that.
 *
 * ── What that costs, and the design it forces ──────────────────────────────
 *
 * A USSD screen is about 160 characters, there is no scrolling back, and the
 * session dies after a short idle. So:
 *
 *   - FEWEST POSSIBLE STEPS. Four: type, unit, still happening, done. Anything
 *     else is asked later by a human on the telephone.
 *   - RECORD AT THE LAST STEP, NOT THE FIRST. A session that dies halfway must
 *     not leave a half report, and must not leave nothing either — see
 *     `partialFrom`, which turns an abandoned session into a real report with
 *     whatever was gathered.
 *   - NO FREE TEXT. There is no keyboard worth the name. The account is taken
 *     by callback afterwards; the USSD session's job is to get the TYPE and the
 *     PLACE on the record in under thirty seconds.
 *
 * Provider-agnostic on purpose: aggregators differ, and the only contract here
 * is (sessionId, msisdn, accumulated text) in, a screen out, which every
 * Nigerian aggregator can be adapted to.
 */
import { INCIDENT_TYPES, incidentType, normaliseUnitCode } from '@ace/database';

/** Offered on the first screen. Ordered by what a situation room needs soonest. */
export const USSD_MENU: ReadonlyArray<{ key: string; typeId: string; label: string }> = [
  { key: '1', typeId: 'violence', label: 'Violence/attack' },
  { key: '2', typeId: 'ballot_snatching', label: 'Box snatched' },
  { key: '3', typeId: 'vote_buying', label: 'Vote buying' },
  { key: '4', typeId: 'late_or_no_materials', label: 'No materials' },
  { key: '5', typeId: 'bvas_failure', label: 'BVAS failed' },
  { key: '6', typeId: 'voter_intimidation', label: 'Intimidation' },
  { key: '7', typeId: 'result_sheet_irregularity', label: 'Result sheet' },
  { key: '8', typeId: 'other_election_incident', label: 'Something else' },
];

export type UssdAction =
  | { kind: 'CONTINUE'; screen: string }
  | { kind: 'END'; screen: string }
  /** The session is complete: file this and reply with the reference. */
  | { kind: 'FILE'; report: UssdReport; screen: (reference: string) => string };

export interface UssdReport {
  incidentType: string;
  pollingUnitCode: string | null;
  isOngoing: boolean;
  /** How far the session got, for the case file. */
  completed: boolean;
}

const ask = (s: string) => ({ kind: 'CONTINUE' as const, screen: s });
const stop = (s: string) => ({ kind: 'END' as const, screen: s });

function menuScreen(): string {
  return ['Report an election incident:', ...USSD_MENU.map((m) => `${m.key}. ${m.label}`)].join('\n');
}

/**
 * Advance the session.
 *
 * `text` is the aggregator's accumulated input, `*`-separated, which is how
 * every Nigerian aggregator presents it: "" then "3" then "3*15010100 3".
 */
export function ussdStep(text: string): UssdAction {
  const steps = (text ?? '').split('*').map((s) => s.trim()).filter((s) => s.length > 0);

  // Step 0 — what happened.
  if (steps.length === 0) return ask(menuScreen());

  const chosen = USSD_MENU.find((m) => m.key === steps[0]);
  if (!chosen) return ask(`Not a valid choice.\n${menuScreen()}`);

  // Step 1 — where. A code, or 0 to say they do not have it.
  if (steps.length === 1) {
    return ask(`${chosen.label}.\nEnter polling unit code (e.g. 15010100 3) or 0 if you do not have it:`);
  }

  const saidUnit = steps[1];
  const unit = saidUnit === '0' ? null : normaliseUnitCode(saidUnit) ?? normaliseUnitCode(saidUnit.replace(/\s+/g, ''));
  if (saidUnit !== '0' && !unit) {
    // Asked once more and then accepted without, because a report with no unit
    // beats no report, and a third screen loses the session.
    if (steps.length === 2) {
      return ask('Could not read that code. Enter it again as 15/01/01/003, or 0 to continue without it:');
    }
  }

  // Step 2 — still happening. The one question that changes the response time.
  if (steps.length === 2 || (steps.length === 3 && !unit && saidUnit !== '0' && !normaliseUnitCode(steps[2]))) {
    return ask('Is it still happening now?\n1. Yes\n2. No');
  }

  const ongoingAnswer = steps[steps.length - 1];
  const isOngoing = ongoingAnswer === '1';

  return {
    kind: 'FILE',
    report: {
      incidentType: chosen.typeId,
      pollingUnitCode: unit ?? (normaliseUnitCode(steps[2] ?? '') || null),
      isOngoing,
      completed: true,
    },
    screen: (reference) =>
      isOngoing
        ? `Recorded as urgent. Ref ${reference}. If you are in danger call 112. An officer will call you.`
        : `Recorded. Ref ${reference}. An officer will call you to take the details.`,
  };
}

/**
 * What to file when a session is abandoned part-way.
 *
 * Called from the aggregator's session-timeout callback, or by a sweep over
 * stale sessions. An observer who chose "Violence" and then lost signal has
 * told us something important, and discarding it because they never reached
 * screen three is the wrong trade on election day. Returns null only when
 * nothing at all was chosen.
 */
export function partialFrom(text: string): UssdReport | null {
  const steps = (text ?? '').split('*').map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return null;
  const chosen = USSD_MENU.find((m) => m.key === steps[0]);
  if (!chosen) return null;
  return {
    incidentType: chosen.typeId,
    pollingUnitCode: steps[1] && steps[1] !== '0' ? normaliseUnitCode(steps[1]) : null,
    isOngoing: steps[2] === '1',
    completed: false,
  };
}

/** Every menu entry must name a real incident type, or the menu lies. */
export function menuIsValid(): boolean {
  return USSD_MENU.every((m) => incidentType(m.typeId) !== null) &&
    new Set(USSD_MENU.map((m) => m.key)).size === USSD_MENU.length;
}

export const KNOWN_TYPE_IDS: ReadonlySet<string> = new Set(INCIDENT_TYPES.map((t) => t.id));
