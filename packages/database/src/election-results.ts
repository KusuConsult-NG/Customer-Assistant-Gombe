/**
 * Pure Form EC8A result normalization and integrity checks for Parallel Vote
 * Tabulation (PVT).
 *
 * Deliberately pure (no DB imports) so API services, SMS/USSD parsers, and
 * unit tests share one exact definition of over-voting and arithmetic checks.
 */

export const RESULT_INTEGRITY_FLAGS = {
  OVER_VOTING_EXCEEDS_ACCREDITED: 'OVER_VOTING_EXCEEDS_ACCREDITED',
  EXCEEDS_REGISTERED_VOTERS: 'EXCEEDS_REGISTERED_VOTERS',
  ARITHMETIC_MISMATCH: 'ARITHMETIC_MISMATCH',
  PARTY_SUM_MISMATCH: 'PARTY_SUM_MISMATCH',
  CONFLICTING_SUBMISSION: 'CONFLICTING_SUBMISSION',
  MISSING_EC8A_PHOTO: 'MISSING_EC8A_PHOTO',
} as const;

export type ResultIntegrityFlag =
  (typeof RESULT_INTEGRITY_FLAGS)[keyof typeof RESULT_INTEGRITY_FLAGS];

export interface NormalizedVotes {
  votesByParty: Record<string, number>;
  partySum: number;
}

/**
 * Normalise party keys to uppercase trimmed codes and non-negative integers.
 */
export function normalizeVotesByParty(raw: Record<string, unknown>): NormalizedVotes {
  const votesByParty: Record<string, number> = {};
  let partySum = 0;
  for (const [k, v] of Object.entries(raw || {})) {
    const key = String(k).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!key) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    const whole = Math.floor(n);
    votesByParty[key] = (votesByParty[key] ?? 0) + whole;
    partySum += whole;
  }
  return { votesByParty, partySum };
}

export interface ResultIntegrityInput {
  accreditedVoters: number;
  votesByParty: Record<string, number>;
  validVotes?: number;
  rejectedVotes?: number;
  totalVotesCast?: number;
  registeredVoters?: number | null;
  hasEc8aPhoto?: boolean;
  hasConflictingSubmission?: boolean;
}

export interface ResultIntegrityOutput {
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  flags: ResultIntegrityFlag[];
}

/**
 * Compute authoritative totals and integrity flags for a polling unit result.
 *
 * Never throws or blocks storage on an anomaly: if an agent reports over-voting
 * at a polling unit, storing the exact reported numbers WITH the flag is what
 * gives the legal team an actionable tribunal lead.
 */
export function evaluateResultIntegrity(input: ResultIntegrityInput): ResultIntegrityOutput {
  const { votesByParty, partySum } = normalizeVotesByParty(input.votesByParty);
  const accredited = Math.max(0, Math.floor(Number(input.accreditedVoters) || 0));
  const rejected = Math.max(0, Math.floor(Number(input.rejectedVotes ?? 0) || 0));
  const valid =
    input.validVotes !== undefined && Number.isFinite(Number(input.validVotes))
      ? Math.max(0, Math.floor(Number(input.validVotes)))
      : partySum;
  const total =
    input.totalVotesCast !== undefined && Number.isFinite(Number(input.totalVotesCast))
      ? Math.max(0, Math.floor(Number(input.totalVotesCast)))
      : valid + rejected;

  const flags: ResultIntegrityFlag[] = [];

  if (valid !== partySum) {
    flags.push(RESULT_INTEGRITY_FLAGS.PARTY_SUM_MISMATCH);
  }
  if (valid + rejected !== total) {
    flags.push(RESULT_INTEGRITY_FLAGS.ARITHMETIC_MISMATCH);
  }
  if (accredited > 0 && total > accredited) {
    flags.push(RESULT_INTEGRITY_FLAGS.OVER_VOTING_EXCEEDS_ACCREDITED);
  } else if (accredited === 0 && total > 0) {
    flags.push(RESULT_INTEGRITY_FLAGS.OVER_VOTING_EXCEEDS_ACCREDITED);
  }
  if (
    typeof input.registeredVoters === 'number' &&
    input.registeredVoters > 0 &&
    (accredited > input.registeredVoters || total > input.registeredVoters)
  ) {
    flags.push(RESULT_INTEGRITY_FLAGS.EXCEEDS_REGISTERED_VOTERS);
  }
  if (!input.hasEc8aPhoto) {
    flags.push(RESULT_INTEGRITY_FLAGS.MISSING_EC8A_PHOTO);
  }
  if (input.hasConflictingSubmission) {
    flags.push(RESULT_INTEGRITY_FLAGS.CONFLICTING_SUBMISSION);
  }

  return {
    validVotes: valid,
    rejectedVotes: rejected,
    totalVotesCast: total,
    flags,
  };
}
