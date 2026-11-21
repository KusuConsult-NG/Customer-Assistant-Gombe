/**
 * The State's own administrative geography.
 *
 * This used to be derived: `GOMBE_LGAS = Object.keys(ACCREDITED_FACILITIES)`,
 * so the list of Local Government Areas the whole platform recognised was
 * whatever the health scheme happened to have an accredited hospital in. It
 * produced the right count only because that directory was complete.
 *
 * That coupling is wrong for a platform serving every ministry: if the health
 * agency de-accredited the last facility in an LGA, that LGA would silently
 * stop existing for the lands registry, the revenue board and everyone else —
 * and a citizen there could not say where they live.
 *
 * An LGA is a fact about the State, not about one agency's service coverage,
 * so it is stated here and the service directories are checked against it.
 */

/**
 * The 11 Local Government Areas of Gombe State, alphabetically.
 *
 * Source: the Gombe State Government's own LGA listing (gombestate.gov.ng) and
 * the Federal Government's state profile (nigeria.gov.ng/states/gombe/), both
 * read 2026-11-21. "Billiri" is also written "Biliri" and "Yamaltu/Deba" is
 * commonly shortened to "Deba"; both are aliases in `resolveLga`.
 *
 * NOT included: the 13 Local Council Development Areas created by the bill the
 * Governor signed in August 2025. An LCDA is a State-level administrative unit,
 * NOT one of the 11 Local Government Areas recognised in the Constitution, and
 * the two are routinely reported together as "24 administrative units". A
 * citizen is registered against an LGA, so only the 11 are here. If the State
 * wants service delivery tracked per LCDA, that is a second, separate list.
 */
export const GOMBE_LGAS: readonly string[] = [
  'Akko',
  'Balanga',
  'Billiri',
  'Dukku',
  'Funakaye',
  'Gombe',
  'Kaltungo',
  'Kwami',
  'Nafada',
  'Shongom',
  'Yamaltu/Deba',
];

/**
 * Spoken and mis-transcribed forms of an LGA name, mapped to the gazetted one.
 *
 * These are the forms that reach us from speech-to-text on a phone call and
 * from citizens typing on WhatsApp. Kept here, next to the list itself, so one
 * place decides what a place is called.
 */
const LGA_ALIASES: Record<string, string> = {
  // "Biliri" is the commoner press spelling of the gazetted "Billiri".
  biliri: 'Billiri',
  bilri: 'Billiri',
  // Yamaltu/Deba is one LGA that callers name by either half, and "Deba" —
  // its headquarters town — is what most people actually say.
  deba: 'Yamaltu/Deba',
  yamaltu: 'Yamaltu/Deba',
  'yamaltu deba': 'Yamaltu/Deba',
  'yamaltu-deba': 'Yamaltu/Deba',
  'yelmatu deba': 'Yamaltu/Deba',
  // Headquarters towns that are not the LGA's own name, as callers say them.
  kumo: 'Akko',
  bajoga: 'Funakaye',
  'malam sidi': 'Kwami',
  'mallam sidi': 'Kwami',
  talasse: 'Balanga',
  // Common speech-to-text confusions on an 8kHz line.
  ako: 'Akko',
  akko: 'Akko',
  duku: 'Dukku',
  dukku: 'Dukku',
  kwame: 'Kwami',
  kwami: 'Kwami',
  shongum: 'Shongom',
  shangom: 'Shongom',
  shongom: 'Shongom',
  funakai: 'Funakaye',
  funakaye: 'Funakaye',
  kaltungo: 'Kaltungo',
  kaltungu: 'Kaltungo',
  nafada: 'Nafada',
  balanga: 'Balanga',
};

/**
 * Words that qualify a place name without being part of it.
 *
 * "Gombe" is both the State and one of its LGAs — unlike Gombe, whose LGAs
 * share no name with the State. So "I live in Gombe State" must NOT resolve to
 * the Gombe LGA: a citizen in Akko who answers with the State's name has
 * told us nothing about which office to send them to, and recording them in the
 * capital's LGA sends them three hours in the wrong direction. The State's own
 * name, alone, resolves to null and the caller is asked again.
 */
const QUALIFIERS = /\b(local government( area)?|lga|l\.g\.a\.?|council|state|area)\b/g;

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z'/\s-]/g, ' ')
    .replace(QUALIFIERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves what a citizen said into a known LGA, or null.
 *
 * Returns null rather than guessing: an unrecognised answer recorded as the
 * nearest-looking LGA sends somebody to the wrong office, which is worse than
 * asking them again.
 */
export function resolveLga(input: string | undefined | null): string | null {
  const asked = normalise(input ?? '');
  if (!asked) return null;

  // The State's own name, with nothing else, is not an LGA answer.
  if (asked === 'gombe' && /\bstate\b/i.test(input ?? '')) return null;

  const exact = GOMBE_LGAS.find((l) => normalise(l) === asked);
  if (exact) return exact;

  const alias = LGA_ALIASES[asked];
  if (alias) return alias;

  // "kaltungo lga", "i live in kaltungo" — a contained match is safe because no
  // LGA name is a substring of another. It is checked longest-first so that
  // "Kaltungo" is not shadowed by a shorter name inside a long sentence.
  const byLength = [...GOMBE_LGAS].sort((a, b) => b.length - a.length);
  const contained = byLength.find((l) => asked.includes(normalise(l)));
  if (contained) return contained;

  // An alias inside a longer sentence, same rule.
  const aliasKey = Object.keys(LGA_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((k) => asked.includes(k));
  if (aliasKey) return LGA_ALIASES[aliasKey];

  // Finally, a partial the citizen typed: "katag" for Akko. Required to be
  // at least four characters so "das" does not claim Funakaye over Dukku.
  if (asked.length >= 4) {
    const prefix = GOMBE_LGAS.find((l) => normalise(l).startsWith(asked));
    if (prefix) return prefix;
  }

  return null;
}

export function isKnownLga(input: string | undefined | null): boolean {
  return resolveLga(input) !== null;
}
