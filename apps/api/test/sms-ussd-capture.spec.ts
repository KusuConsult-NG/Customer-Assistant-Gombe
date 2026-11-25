/**
 * The two channels that reach a polling unit with no data and no credit.
 *
 * WhatsApp needs data; a call needs a usable network. The units that have
 * neither are disproportionately the rural ones where an observer is the only
 * person watching, so these are not downgrades — they are the channels that
 * reach the places most likely to go unreported.
 */
import { parseSmsReport, smsAck, SMS_CODES, SMS_SEGMENT_LIMIT } from '../src/sms/report-sms';
import { ussdStep, partialFrom, menuIsValid, USSD_MENU, KNOWN_TYPE_IDS } from '../src/sms/ussd-session';

describe('reading a report out of an SMS', () => {
  it('reads the documented shape', () => {
    const r = parseSmsReport('VB 15/01/01/003 they are giving money at the gate');
    expect(r.incidentType).toBe('vote_buying');
    expect(r.via).toBe('code');
    expect(r.pollingUnitCode).toBe('15-01-01-003');
    expect(r.account).toBe('they are giving money at the gate');
  });

  it('classifies by words when no code was used', () => {
    // An observer who was briefed on codes and forgot one under pressure must
    // not be penalised for it.
    const r = parseSmsReport('they snatched the ballot box at 15-01-01-003');
    expect(r.incidentType).toBe('ballot_snatching');
    expect(r.via).toBe('keywords');
    expect(r.pollingUnitCode).toBe('15-01-01-003');
  });

  it('files prose with no code and no unit at all', () => {
    // A report needing a human to sort out is worth more than a refusal with a
    // syntax reminder.
    const r = parseSmsReport('something is very wrong at this polling unit please send someone');
    expect(r.pollingUnitCode).toBeNull();
    expect(r.text).toMatch(/send someone/);
    expect(r.account).toMatch(/send someone/);
  });

  it('recovers a unit code split by a stray space', () => {
    // "15/01/01 003" arrives this way more often than not.
    expect(parseSmsReport('MAT 15/01/01 003 no ballot papers').pollingUnitCode).toBe('15-01-01-003');
  });

  it('hears "still happening" and "I cannot talk"', () => {
    expect(parseSmsReport('VI 15-01-01-003 they are still fighting right now').isOngoing).toBe(true);
    expect(parseSmsReport('VB 15-01-01-003 dont call me it is not safe').discreet).toBe(true);
    expect(parseSmsReport('UV 15-01-01-003 saw underage voters earlier').isOngoing).toBe(false);
  });

  it('maps every short code to a real incident type', () => {
    // A briefing card that teaches a code the platform does not know is worse
    // than no card.
    for (const [code, typeId] of Object.entries(SMS_CODES)) {
      expect(KNOWN_TYPE_IDS.has(typeId)).toBe(true);
      expect(code).toMatch(/^[A-Z]{2,4}$/);
    }
  });

  it('replies inside one SMS segment', () => {
    // Longer and the carrier bills two parts, which on a prepaid line in a
    // rural ward is a real reason to stop reporting.
    for (const ack of [
      smsAck('REF-48213'),
      smsAck('REF-48213', { unitMissing: true }),
      smsAck('REF-48213', { unclassified: true }),
    ]) {
      expect(ack.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);
    }
  });

  it('never reads the report back in the reply', () => {
    // An SMS sits in an inbox somebody else may read.
    const ack = smsAck('REF-1');
    for (const word of ['ballot', 'snatch', 'violence', 'money', 'vote']) {
      expect(ack.toLowerCase()).not.toContain(word);
    }
  });
});

describe('the USSD menu', () => {
  it('offers only real incident types, with unique keys', () => {
    expect(menuIsValid()).toBe(true);
    for (const item of USSD_MENU) expect(KNOWN_TYPE_IDS.has(item.typeId)).toBe(true);
  });

  it('opens with the menu', () => {
    const first = ussdStep('');
    expect(first.kind).toBe('CONTINUE');
    if (first.kind === 'CONTINUE') expect(first.screen).toMatch(/1\. Violence/);
  });

  it('walks type, unit, ongoing, and then files', () => {
    expect(ussdStep('2').kind).toBe('CONTINUE');
    expect(ussdStep('2*15010100 3').kind).toBe('CONTINUE');
    const done = ussdStep('2*15/01/01/003*1');
    expect(done.kind).toBe('FILE');
    if (done.kind === 'FILE') {
      expect(done.report.incidentType).toBe('ballot_snatching');
      expect(done.report.pollingUnitCode).toBe('15-01-01-003');
      expect(done.report.isOngoing).toBe(true);
      expect(done.report.completed).toBe(true);
      // 112 is given when it is still happening, and the details are not read back.
      expect(done.screen('REF-9')).toMatch(/112/);
      expect(done.screen('REF-9')).toMatch(/REF-9/);
    }
  });

  it('accepts a report from someone who has no unit code', () => {
    const done = ussdStep('3*0*2');
    expect(done.kind).toBe('FILE');
    if (done.kind === 'FILE') {
      expect(done.report.incidentType).toBe('vote_buying');
      expect(done.report.pollingUnitCode).toBeNull();
    }
  });

  it('keeps an abandoned session rather than losing it', () => {
    // An observer who chose "Violence" and then lost signal has told us
    // something important. Discarding it because they never reached screen
    // three is the wrong trade on election day.
    const partial = partialFrom('1');
    expect(partial?.incidentType).toBe('violence');
    expect(partial?.completed).toBe(false);
    expect(partialFrom('1*15/01/01/003')?.pollingUnitCode).toBe('15-01-01-003');
    // Nothing chosen is nothing to file.
    expect(partialFrom('')).toBeNull();
    expect(partialFrom('99')).toBeNull();
  });

  it('keeps every screen inside a USSD page', () => {
    // No scrolling back on a feature phone.
    const screens = [ussdStep(''), ussdStep('1'), ussdStep('1*0')];
    for (const s of screens) {
      if (s.kind === 'CONTINUE' || s.kind === 'END') expect(s.screen.length).toBeLessThanOrEqual(182);
    }
  });
});
