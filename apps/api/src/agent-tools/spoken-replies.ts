/**
 * The longest things the phone agent says, as functions.
 *
 * They lived inline in `createTicket`, which is why nothing could measure them.
 * They matter because ElevenLabs hangs up `silenceEndCallTimeout` seconds after
 * the CALLER last spoke, and the caller does not speak while the agent reads
 * these. At 10 seconds the agent was cut off mid-sentence on every one.
 * `spoken-duration.spec.ts` speaks each of them, at the configured voice speed,
 * against that timeout — so a longer script or a slower voice fails the build
 * instead of a call.
 */

export type IncidentKind = 'security' | 'fire' | 'disaster' | 'medical';

/**
 * A reference as it should be SPOKEN: digit by digit ("4 8 2 1 3"), the way
 * the phone numbers below are written. Read as a number it is "forty-eight
 * thousand two hundred and thirteen", which nobody writes down correctly.
 * A prefix (REF-BK) is kept as written.
 */
export function spokenReference(reference: string): string {
  // Only a reference that ENDS in a run of digits after its label: "48213",
  // "REF-BK-48213". An older mixed one ("CB-9DF9421E") is left as written —
  // spacing the digits inside it gave "CB-9DF9 4 2 1E".
  const m = /^(.*?)(\d+)$/.exec(reference);
  if (!m || (m[1] && !m[1].endsWith('-'))) return reference;
  return m[1] + m[2].split('').join(' ');
}

/**
 * Who to call depends on what is happening. **112 is the only number spoken
 * here**, because it is the only one that is a fact about Nigeria rather than
 * about one State.
 *
 * ── What was here, and why it had to go ─────────────────────────────────────
 *
 * Four services and five telephone numbers were hardcoded into these lines and
 * read out to callers reporting an attack, a fire or a flood:
 *
 *   Operation Enduring Peace, "the joint military task force", toll-free
 *   Operation Rainbow, "the State early-warning and security outfit",
 *     toll-free and a control room
 *   the Police Command
 *   the State Fire Service
 *   the State Emergency Management Agency
 *
 * Every one of those numbers belonged to PLATEAU State's services. Operation
 * Enduring Peace is the military task force covering Jos; Operation Rainbow is
 * Plateau's own security outfit and has no presence in Gombe. The rebrand
 * changed the State name in the words around them and left the digits
 * untouched, so a caller in Akko reporting an attack would have been given,
 * calmly and digit by digit, the control room of another State — and told it
 * was theirs.
 *
 * This is the single most dangerous string in the repository, and it is the one
 * place where "say nothing" is unambiguously safer than "say something close".
 *
 * ── The rule this restores ─────────────────────────────────────────────────
 *
 * It is also the rule the platform already had, and this code had drifted from:
 * 112 is the only hardcoded number, and everything else comes from
 * `Organization.emergencyContacts` — the agency's own approved lines, set at
 * Settings, read out verbatim, never filled in by the platform. The emergency
 * path in `packages/orchestrator/src/emergency.ts` does exactly that. These
 * lines now say 112 and what to do, and leave naming the agency's own services
 * to the agency.
 *
 * To restore per-service guidance for Gombe, set the State's real lines in
 * Settings → Emergency contacts. Do not hardcode them here again.
 */
export function incidentAuthorityLine(kind: IncidentKind): string {
  return kind === 'security'
    ? 'The fastest route for anything happening now is 1 1 2 — it reaches the police and every emergency service, and it is free from any phone. If you are in danger, move somewhere safe first and keep your line free so they can call you back.'
    : kind === 'fire'
    ? 'Please call 1 1 2 right away — it reaches the fire service — and keep everyone away from the building.'
    : kind === 'disaster'
    ? 'Please call 1 1 2 — it will connect you to the emergency services who handle floods and disasters — and move to higher ground or a safe place if you can.'
    : 'Please call 1 1 2 for an ambulance, or get to the nearest hospital as fast as you safely can.';
}

/** create-ticket's reply for an emergency still happening. */
export function urgentReportReply(ticketNumber: string, kind: IncidentKind): string {
  return (
    `Thank you for your patience. Your report has now been registered in our system as urgent and flagged to our team. Your unique reference number is ${spokenReference(ticketNumber)}. I repeat, ${spokenReference(ticketNumber)}. Please keep this number safe, as it will help you track the progress of your report. ` +
    incidentAuthorityLine(kind)
  );
}

/**
 * create-ticket's reply for a complaint: Phase 8 then Phase 10, in the State's
 * document's own words, with the one addition main made on purpose (e0ee9f6):
 * the caller is asked whether there is anything else before the goodbye.
 */
export function reportRegisteredReply(ticketNumber: string, callerDisplayName?: string | null): string {
  const thanks = callerDisplayName ? `Once again, thank you, ${callerDisplayName}, for` : 'Once again, thank you for';
  return (
    `Thank you for your patience. Your report has now been registered in our system. ` +
    `Your unique complaint reference number is ${spokenReference(ticketNumber)}. I repeat, ${spokenReference(ticketNumber)}. Please keep this number safe, as it will ` +
    `help you track the progress of your report and make subsequent enquiries. ` +
    `${thanks} contacting the Gombe State Government Citizen Contact Centre. Your report has been recorded under ` +
    `reference number ${spokenReference(ticketNumber)}. We appreciate your contribution towards improving governance and ` +
    `public service delivery across Gombe State. Your voice matters, and we encourage you to continue using this ` +
    `platform to communicate your concerns, seek information and provide feedback on government services. ` +
    `Is there anything else I can assist you with today, or may I go ahead and end the call?`
  );
}

// ── How long it takes to say ─────────────────────────────────────────────────

/**
 * Words per second at speed 1.0. Conversational TTS runs at about 150 words a
 * minute (2.5/s); 2.3 is deliberately slower, so the estimate errs towards a
 * LONGER turn — the safe side when the question is "will the line hang up".
 */
export const WORDS_PER_SECOND_AT_SPEED_1 = 2.3;
/** The pause the voice leaves at a full stop, question mark or dash. */
export const PAUSE_PER_SENTENCE_SECONDS = 0.4;
/**
 * Single digits and letters read one at a time ("0 8 0 3", "T C K"). They are
 * one short syllable each, so they go faster than words — but still counted
 * conservatively at 2.5/s rather than the 3+/s a voice actually manages.
 */
export const CHARACTERS_PER_SECOND_AT_SPEED_1 = 2.5;

/**
 * Roughly how many seconds `text` takes to speak at `speed`.
 *
 * Counted the way it is read: a phone number already written "0 8 0 3" is
 * four words, and a reference like TCK-000123 — which the agent is told to
 * read "slowly and clearly" — is one word per character. Markup the voice does
 * not say (`<governor>` tags) is dropped and a `<break time="Ns" />` adds N.
 */
export function estimateSpokenSeconds(text: string, speed: number): number {
  let breaks = 0;
  const clean = text
    .replace(/<break\s+time="([\d.]+)s"\s*\/>/g, (_, s) => {
      breaks += Number(s);
      return ' ';
    })
    .replace(/<\/?[a-z]+>/gi, ' ');
  let words = 0;
  let characters = 0;
  for (const token of clean.split(/\s+/)) {
    const bare = token.replace(/[^\p{L}\p{N}]/gu, '');
    if (!bare) continue;
    if (/\d/.test(bare)) characters += bare.length; // a digit run or a reference: read character by character
    else words += 1;
  }
  const sentences = (clean.match(/[.?!—]/g) ?? []).length;
  return (
    words / (WORDS_PER_SECOND_AT_SPEED_1 * speed) +
    characters / (CHARACTERS_PER_SECOND_AT_SPEED_1 * speed) +
    sentences * PAUSE_PER_SENTENCE_SECONDS +
    breaks
  );
}
