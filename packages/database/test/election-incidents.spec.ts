/**
 * The rules an election situation room's dataset depends on.
 *
 * Each of these is a way the platform could publish something untrue, which is
 * the only failure mode that matters for a body whose output is quoted in the
 * press and filed in tribunals.
 */
import {
  CORROBORATION_THRESHOLD,
  INCIDENT_TYPES,
  RESPONSE_MINUTES,
  classifyIncident,
  clusterKeyFor,
  dueAtFor,
  incidentType,
  severityFor,
  verificationFromCorroboration,
} from '../src/election-incidents';
import {
  normaliseUnitCode,
  resolvePollingUnit,
  rejectReason,
  unitMissReply,
  type PollingUnitResolution,
} from '../src/polling-units';

// The casts are deliberate. `jest.packages.config.js` runs ts-jest with
// `strict: false`, and without strictNullChecks a `{ok:true}|{ok:false}` union
// does not narrow on the boolean discriminant — so the runtime check below is
// what actually guarantees the shape, and the cast only tells the compiler.
type Miss = Extract<PollingUnitResolution, { ok: false }>;
type Hit = Extract<PollingUnitResolution, { ok: true }>;

/** Assert a resolution missed, and hand back the miss. */
function miss(r: PollingUnitResolution): Miss {
  if (r.ok) throw new Error(`expected a miss, got ${(r as Hit).unit.code}`);
  return r as Miss;
}
/** Assert a resolution hit, and hand back the unit. */
function hit(r: PollingUnitResolution) {
  if (!r.ok) throw new Error(`expected a hit, got ${(r as Miss).reason}`);
  return (r as Hit).unit;
}

describe('the incident taxonomy', () => {
  it('has a unique, stable id for every type', () => {
    const ids = INCIDENT_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Reports are counted on these ids across elections; a rename is a break.
    expect(ids).toContain('vote_buying');
    expect(ids).toContain('bvas_failure');
    expect(ids).toContain('ballot_snatching');
    expect(ids).toContain('violence');
  });

  it.each([
    ['They are buying votes at the gate, giving money to people', 'vote_buying'],
    ['The BVAS machine is not capturing fingerprints', 'bvas_failure'],
    ['Thugs came and snatched the ballot box', 'ballot_snatching'],
    ['Materials have not arrived, voting has not started', 'late_or_no_materials'],
    ['They are not allowing elderly people to vote', 'disenfranchisement'],
    ['The result sheet figures were altered', 'result_sheet_irregularity'],
    ['Result has not been uploaded to IReV', 'irev_upload_failure'],
  ])('classifies what a reporter actually says: %s', (said, expected) => {
    expect(classifyIncident(said)?.id).toBe(expected);
  });

  it('puts SAFETY first when a report mentions more than one thing', () => {
    // A report of a fight AND a result sheet is a fight first: the result sheet
    // will still be there in an hour and the people will not.
    const both = classifyIncident('They were fighting and shooting, and the result sheet was not signed');
    expect(both?.group).toBe('SAFETY');
  });

  it('prefers the longer phrase, so "vote buying" is not beaten by a shorter match', () => {
    expect(classifyIncident('there is vote buying here')?.id).toBe('vote_buying');
  });

  it('returns null rather than "other" when nothing matches', () => {
    // The CALLER decides what "other" means, not the matcher: on election day
    // an unclassified report goes to a human, and `null` is what says so.
    expect(classifyIncident('I want to know my polling unit address')).toBeNull();
    expect(classifyIncident('')).toBeNull();
    expect(classifyIncident(null)).toBeNull();
  });
});

describe('severity', () => {
  it('is raised by an ongoing incident and by casualties, never lowered', () => {
    expect(severityFor('underage_voting')).toBe('MEDIUM');
    expect(severityFor('underage_voting', { isOngoing: true })).toBe('HIGH');
    // Somebody hurt is CRITICAL whatever the type says.
    expect(severityFor('underage_voting', { victimsOrInjuries: 'two people were beaten' })).toBe('CRITICAL');
    expect(severityFor('violence')).toBe('CRITICAL');
    expect(severityFor('violence', { isOngoing: true })).toBe('CRITICAL');
  });

  it('does not read "nobody was hurt" as casualties', () => {
    // The field is free text and an agent fills it in either way. Treating
    // "none" as injuries would make every careful report CRITICAL and drown
    // the ones that are.
    for (const said of ['none', 'No', 'nobody', 'no one was hurt', 'nil', 'N/A']) {
      expect(severityFor('underage_voting', { victimsOrInjuries: said })).toBe('MEDIUM');
    }
  });
});

describe('response deadlines', () => {
  it('are in minutes, not days', () => {
    // The service charter measures in days. Reusing it would have an ongoing
    // attack "on time" until after the result was declared.
    expect(RESPONSE_MINUTES.CRITICAL).toBeLessThanOrEqual(5);
    expect(RESPONSE_MINUTES.HIGH).toBeLessThanOrEqual(30);
    const now = new Date('2027-02-20T09:00:00Z');
    expect(dueAtFor('CRITICAL', now).toISOString()).toBe('2027-02-20T09:05:00.000Z');
  });
});

describe('clustering many reports of one event', () => {
  const at = new Date('2027-02-20T09:10:00Z');

  it('gives the same key to the same unit, type and hour', () => {
    const a = clusterKeyFor('15-04-07-012', 'ballot_snatching', at);
    const b = clusterKeyFor('15-04-07-012', 'ballot_snatching', new Date('2027-02-20T09:50:00Z'));
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('separates a different unit, a different type, and a later hour', () => {
    const base = clusterKeyFor('15-04-07-012', 'ballot_snatching', at);
    expect(clusterKeyFor('15-04-07-013', 'ballot_snatching', at)).not.toBe(base);
    expect(clusterKeyFor('15-04-07-012', 'vote_buying', at)).not.toBe(base);
    // The same unit can be attacked twice in a day, and those are two incidents.
    expect(clusterKeyFor('15-04-07-012', 'ballot_snatching', new Date('2027-02-20T14:10:00Z'))).not.toBe(base);
  });

  it('refuses to cluster without a polling unit', () => {
    // Clustering on LGA alone would merge unrelated events across hundreds of
    // units, which is worse than not clustering at all.
    expect(clusterKeyFor(null, 'vote_buying', at)).toBeNull();
    expect(clusterKeyFor('', 'vote_buying', at)).toBeNull();
    expect(clusterKeyFor('15-04-07-012', null, at)).toBeNull();
  });
});

describe('verification', () => {
  it('lets corroboration reach CORROBORATED and no further', () => {
    expect(verificationFromCorroboration('UNVERIFIED', 1)).toBe('UNVERIFIED');
    expect(verificationFromCorroboration('UNVERIFIED', CORROBORATION_THRESHOLD)).toBe('CORROBORATED');
    // Not VERIFIED at any count. A coordinated campaign is exactly a lot of
    // independent-looking reports, so only a person who looked at the evidence
    // may say it is true.
    expect(verificationFromCorroboration('UNVERIFIED', 50)).toBe('CORROBORATED');
  });

  it('never walks back a human verdict', () => {
    for (const verdict of ['VERIFIED', 'DISPUTED', 'FALSE_REPORT'] as const) {
      expect(verificationFromCorroboration(verdict, 1)).toBe(verdict);
      expect(verificationFromCorroboration(verdict, 99)).toBe(verdict);
    }
  });
});

describe('polling units', () => {
  it('normalises the separators people actually type', () => {
    for (const said of ['15-04-07-012', '15/04/07/012', '15 4 7 12', '15.04.07.012']) {
      expect(normaliseUnitCode(said)).toBe('15-04-07-012');
    }
    expect(normaliseUnitCode('Pantami Primary School')).toBeNull();
    expect(normaliseUnitCode('')).toBeNull();
  });

  it('says the register is empty rather than guessing a unit', () => {
    // Nobody has INEC's register in this repository, and a plausible invented
    // code would pass every validation and end up in a petition.
    const empty = miss(resolvePollingUnit([], 'Pantami Primary School'));
    expect(empty.reason).toBe('register_empty');
    // The reporter's own words survive, so the report is still usable.
    expect(empty.said).toBe('Pantami Primary School');
    expect(unitMissReply(empty)).toMatch(/written down exactly what you said/i);
  });

  const UNITS = [
    { code: '15-01-03-004', name: 'Central Primary School', lga: 'Akko', registrationArea: 'Kumo East' },
    { code: '15-02-01-001', name: 'Central Primary School', lga: 'Balanga', registrationArea: 'Talasse' },
    { code: '15-01-03-007', name: 'Dispensary Open Space', lga: 'Akko', registrationArea: 'Kumo East' },
  ];

  it('resolves a code exactly, in preference to any name', () => {
    expect(hit(resolvePollingUnit(UNITS, '15-02-01-001')).lga).toBe('Balanga');
  });

  it('asks which one rather than picking, when a name repeats across LGAs', () => {
    // "Central Primary School" exists in most LGAs. Picking the first would
    // file an incident in the wrong Local Government Area.
    const ambiguous = miss(resolvePollingUnit(UNITS, 'Central Primary School'));
    expect(ambiguous.reason).toBe('ambiguous');
    expect(ambiguous.candidates).toHaveLength(2);
    expect(unitMissReply(ambiguous)).toMatch(/more than one unit/i);
  });

  it('resolves the same name once the LGA narrows it', () => {
    expect(hit(resolvePollingUnit(UNITS, 'Central Primary School', { lga: 'Akko' })).code).toBe('15-01-03-004');
  });

  it('refuses a register row from another State', () => {
    // Gombe was carved out of Bauchi in 1996 and the two registers are often
    // distributed together, so this is the check that stops the wrong one.
    expect(rejectReason({ code: '10-05-02-001', name: 'A Unit', lga: 'Katagum', registrationArea: 'Azare' }))
      .toMatch(/not one of the State's/);
    expect(rejectReason({ code: 'not-a-code', name: 'A Unit', lga: 'Akko', registrationArea: 'Kumo East' }))
      .toMatch(/not an INEC polling unit code/);
    expect(rejectReason({ code: '15-01-03-004', name: 'A Unit', lga: 'Akko', registrationArea: 'Kumo East' }))
      .toBeNull();
  });
});

describe('the enum and the union cannot drift apart', () => {
  it('has the same states in both', () => {
    // `election-incidents.ts` keeps its own union so it stays usable without a
    // generated Prisma client; this is what pins the two together.
    const { VerificationState } = require('@prisma/client');
    const fromPrisma = Object.keys(VerificationState).sort();
    const fromUnion = ['CORROBORATED', 'DISPUTED', 'FALSE_REPORT', 'UNVERIFIED', 'VERIFIED'];
    expect(fromPrisma).toEqual(fromUnion);
  });

  it('agrees on severity too', () => {
    const { IncidentSeverity } = require('@prisma/client');
    expect(Object.keys(IncidentSeverity).sort()).toEqual(Object.keys(RESPONSE_MINUTES).sort());
  });
});
