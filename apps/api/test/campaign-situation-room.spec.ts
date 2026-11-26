import { evaluateResultIntegrity, RESULT_INTEGRITY_FLAGS } from '@ace/database';
import { parseCampaignSms } from '../src/sms/campaign-sms-parser';

describe('Campaign Situation Room — EC8A integrity & 2G SMS parsers', () => {
  describe('evaluateResultIntegrity', () => {
    it('returns clean result with only MISSING_EC8A_PHOTO when arithmetic and accreditation match', () => {
      const out = evaluateResultIntegrity({
        accreditedVoters: 420,
        votesByParty: { apc: 290, pdp: 115, nnpp: 10 },
        rejectedVotes: 5,
        registeredVoters: 650,
        hasEc8aPhoto: false,
      });
      expect(out.validVotes).toBe(415);
      expect(out.rejectedVotes).toBe(5);
      expect(out.totalVotesCast).toBe(420);
      expect(out.flags).toEqual([RESULT_INTEGRITY_FLAGS.MISSING_EC8A_PHOTO]);
    });

    it('returns zero flags when EC8A photo is attached and all checks pass', () => {
      const out = evaluateResultIntegrity({
        accreditedVoters: 450,
        votesByParty: { APC: 300, PDP: 120 },
        rejectedVotes: 10,
        registeredVoters: 800,
        hasEc8aPhoto: true,
      });
      expect(out.flags).toEqual([]);
      expect(out.totalVotesCast).toBe(430);
    });

    it('flags OVER_VOTING_EXCEEDS_ACCREDITED when total votes exceed accredited voters', () => {
      const out = evaluateResultIntegrity({
        accreditedVoters: 300,
        votesByParty: { APC: 200, PDP: 150 },
        rejectedVotes: 10,
        hasEc8aPhoto: true,
      });
      expect(out.totalVotesCast).toBe(360);
      expect(out.flags).toContain(RESULT_INTEGRITY_FLAGS.OVER_VOTING_EXCEEDS_ACCREDITED);
    });

    it('flags ARITHMETIC_MISMATCH, PARTY_SUM_MISMATCH, and EXCEEDS_REGISTERED_VOTERS', () => {
      const out = evaluateResultIntegrity({
        accreditedVoters: 550,
        votesByParty: { APC: 300, PDP: 100 },
        validVotes: 450,
        rejectedVotes: 10,
        totalVotesCast: 520,
        registeredVoters: 500,
        hasEc8aPhoto: true,
        hasConflictingSubmission: true,
      });
      expect(out.flags).toEqual(
        expect.arrayContaining([
          RESULT_INTEGRITY_FLAGS.PARTY_SUM_MISMATCH,
          RESULT_INTEGRITY_FLAGS.ARITHMETIC_MISMATCH,
          RESULT_INTEGRITY_FLAGS.EXCEEDS_REGISTERED_VOTERS,
          RESULT_INTEGRITY_FLAGS.CONFLICTING_SUBMISSION,
        ]),
      );
    });
  });

  describe('parseCampaignSms', () => {
    it('parses a polling unit check-in SMS with materials and BVAS status', () => {
      const parsed = parseCampaignSms('CHK 15/01/01/003 MAT OK BVAS OK');
      expect(parsed).toMatchObject({
        kind: 'CHECKIN',
        pollingUnitCode: '15-01-01-003',
        milestone: 'MATERIALS_ARRIVED',
        bvasWorking: true,
      });
    });

    it('detects BVAS failure in check-in SMS', () => {
      const parsed = parseCampaignSms('CHECKIN 15/01/01/003 BVAS FAIL');
      expect(parsed).toMatchObject({
        kind: 'CHECKIN',
        pollingUnitCode: '15-01-01-003',
        bvasWorking: false,
      });
    });

    it('parses a Form EC8A result SMS with space-separated and colon-separated counts', () => {
      const a = parseCampaignSms('RES 15/01/01/003 ACC 420 APC 290 PDP 115 NNPP 10 REJ 5');
      expect(a).toMatchObject({
        kind: 'RESULT',
        pollingUnitCode: '15-01-01-003',
        accreditedVoters: 420,
        rejectedVotes: 5,
        votesByParty: { APC: 290, PDP: 115, NNPP: 10 },
      });

      const b = parseCampaignSms('EC8A 15-01-01-003 ACC:300 APC:210 PDP:80 REJ:4');
      expect(b).toMatchObject({
        kind: 'RESULT',
        pollingUnitCode: '15-01-01-003',
        accreditedVoters: 300,
        rejectedVotes: 4,
        votesByParty: { APC: 210, PDP: 80 },
      });
    });

    it('returns null for incident SMS so parseSmsReport handles them', () => {
      expect(parseCampaignSms('VB 15/01/01/003 they are buying votes at the gate')).toBeNull();
    });
  });
});
