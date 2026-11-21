/**
 * The State FAQs are generated from the verified records, and they lead the
 * right question to the right answer under the shared FAQ rule.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildStateFaqs, phoneForPeople } = require('./seed-state-faqs.js');
import { bestFaqMatch } from '../packages/database/src/faq-match';

const ROOT = join(__dirname, '..');
const agencies = JSON.parse(readFileSync(join(ROOT, 'data', 'gombe-mdas-knowledge-base.json'), 'utf8'));
// Gombe State's events calendar has not been compiled, so the real document
// lists no events and eventsFaq() seeds none. The lineup-shaped fixture below
// keeps the "every event in one answer" rule under test, which is what the
// calendar will have to satisfy when it arrives.
const eventsMd = readFileSync(join(ROOT, 'data', 'mda-knowledge', 'Gombe-State-Tourism-and-Events.md'), 'utf8');
const LINEUP_FIXTURE = [
  '# Gombe State Events Lineup \u2014 test fixture',
  'Also known as: events lineup, what is on in Gombe',
  '',
  '## Events, in date order',
  '',
  '- **3 March 2027 \u2014 Dadin Kowa Wildlife Week** (guided game drives). Venue: Dadin Kowa Dam, Akko. Organised by: the Government (GSTC).',
  '- **16 to 18 March 2027 \u2014 Gombe Food Festival.** Venue: Gombe. Organised by: the private sector.',
  '- **20 March 2027 \u2014 Akko Durbar** (horsemanship and parades). Venue: Kumo, Akko. Organised by: jointly, public and private sector.',
  '- **26 to 28 March 2027 \u2014 Urban Fest** (music, basketball and a gaming arena). Venue: Gombe. Organised by: the private sector.',
  '- **Late March 2027, dates to be announced \u2014 Dadin Kowa Lakeside Festival.** Venue: Dadin Kowa Dam, Gombe. Organised by: the Government (the State).',
  '',
  '## Please note',
  '',
  'Dates and venues may change. Where a date or venue says "to be announced", it has not been fixed yet: say so, and do not guess one.',
  '',
].join('\n');
const faqs: Array<{ question: string; answer: string }> = buildStateFaqs(agencies, LINEUP_FIXTURE);
/** The same FAQs built from the real, empty events document. */
const liveFaqs: Array<{ question: string; answer: string }> = buildStateFaqs(agencies, eventsMd);
const ORG = 'Gombe State Government Citizen Contact Centre';

const answerFor = (q: string) => {
  const m = bestFaqMatch(faqs, q, ORG);
  return m ? faqs.find((f) => f.answer === m.answer)!.question : null;
};

describe('State FAQs', () => {
  it('lists EVERY event of a lineup in one answer', () => {
    const events = faqs.find((f) => /events are happening in Gombe State\?$/.test(f.question))!;
    const count = (LINEUP_FIXTURE.match(/^- \*\*/gm) ?? []).length;
    expect(events.answer.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(count);
    expect(events.answer).toContain('Urban Fest');
    expect(events.answer).toMatch(/to be announced|Dates and venues may change/);
  });

  it('seeds NO events FAQ while the State\u2019s calendar is empty', () => {
    // An events FAQ built from nothing would answer "the lineup is:" with no
    // lineup, and a matched FAQ stops the knowledge base being searched \u2014 so
    // the honest document, which says we do not have the calendar, must be what
    // the caller reaches.
    expect(liveFaqs.some((f) => /events|festival/i.test(f.question) && /lineup is/.test(f.answer))).toBe(false);
  });

  it('generates no agency-head FAQ at all, because none is confirmed', () => {
    // Gombe State HAS a cabinet — 23 Commissioners sworn in in July 2026 — but
    // no source read states WHICH of them holds WHICH portfolio, and a name
    // without its ministry is no use to a citizen asking who to see about
    // their land. So `verified-leadership.json` lists no agency heads, and the
    // generator must produce no "who heads X" FAQ rather than fall back to
    // whatever name the agency record happened to carry.
    expect(faqs.some((f) => /head/.test(f.question))).toBe(false);
    for (const abbr of ['MOH', 'MOIC', 'MARD', 'MOW', 'MoE', 'MOF', 'GOHEALTH']) {
      const head = faqs.find((f) => new RegExp(`\\(${abbr}\\)\\?$`).test(f.question) && /head/.test(f.question));
      expect(head).toBeUndefined();
    }
    // The scraped `raw*` fields are never used: MARD's rawLeader was a college provost.
    expect(faqs.some((f) => /Provost/.test(f.answer))).toBe(false);
  });

  it('carries no official from either State this deployment used to serve', () => {
    // Plateau's 51 agency heads were deleted, then Bauchi's eight, each time
    // because they were a different State's office-holders. A rename maps a
    // surname onto an LGA name and the result reads plausible: Bauchi's
    // "Muhammad Hamisu Shira" became "Muhammad Hamisu Funakaye", a Gombe
    // commissioner who does not exist.
    const everyAnswer = faqs.map((f) => f.answer).join('\n');
    for (const stale of [
      'Mutfwang', 'Josephine Chundung Piyo', 'Cletus Shurkuk', 'Chuwang Pwajok',
      'Hamisu', 'Baraya Ibrahim', 'Bashir Yau', 'Adamu Babayo', 'Hassan Eliyakub',
      'Abdulkadir Ibrahim', 'Aminu Hammayo', 'Sani Umar', 'Bala Mohammed',
    ]) {
      expect(everyAnswer).not.toContain(stale);
    }
  });

  it('reads phone numbers the way people dial them', () => {
    expect(phoneForPeople('+2348037042854')).toBe('0803 704 2854');
  });

  it.each([
    ['What events are happening in Gombe State?', /events/],
    ['what events are coming up in Gombe State', /events/],
    ['what festivals are happening in Gombe', /events|festivals/],
    ["What are Governor Inuwa Yahaya's projects and achievements?", /projects and achievements/],
    ['What road and infrastructure projects has Governor Inuwa Yahaya done?', /projects and achievements/],
    ['What does the Ministry of Health do?', /^What does the Ministry of Health/],
    ['How can I contact the Gombe State Water Board?', /office of the Gombe State Water Board/],
    ['What services does GOHEALTH offer?', /services does the .*GOHEALTH/],
  ])('"%s" reaches the right FAQ', (q, expected) => {
    expect(answerFor(q)).toMatch(expected);
  });

  it('leaves questions no FAQ asks to the knowledge base', () => {
    expect(answerFor('Tell me about Urban Fest')).toBeNull();
    expect(answerFor('How do I pay my taxes?')).toBeNull();
  });
});
