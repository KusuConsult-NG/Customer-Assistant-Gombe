/**
 * Every leader the platform names is in the verified table, with a date and a
 * source; every other head is shown as not confirmed. The records named a
 * Permanent Secretary "Dr. Cletus Bako / Dr. Agabus" and most of a cabinet two
 * months out of date.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { leadershipLines, NOT_CONFIRMED } = require('./apply-verified-leadership.js');

const ROOT = join(__dirname, '..');
const verified = JSON.parse(readFileSync(join(ROOT, 'data', 'verified-leadership.json'), 'utf8'));
const catalog: any[] = JSON.parse(readFileSync(join(ROOT, 'data', 'gombe-mdas-knowledge-base.json'), 'utf8'));
const MD = join(ROOT, 'data', 'mda-knowledge');

describe('verified leadership', () => {
  it('dates and sources every name it confirms', () => {
    for (const [abbr, v] of Object.entries<any>(verified.leaders)) {
      expect({ abbr, asOf: Boolean(v.asOf), source: Boolean(v.source) }).toEqual({ abbr, asOf: true, source: true });
      expect(catalog.some((a) => a.abbreviation === abbr)).toBe(true);
    }
  });

  it('is what the agency records now say — and nothing else', () => {
    for (const a of catalog) {
      const v = verified.leaders[a.abbreviation];
      if (v) {
        expect(a.currentLeadership).toMatchObject({ name: v.name, position: v.position, asOf: v.asOf });
      } else {
        expect(a.currentLeadership).toMatchObject({ name: null, unconfirmed: true });
      }
      // Only a confirmed Permanent Secretary is named.
      if (a.currentLeadership.permanentSecretary) expect(v?.permanentSecretary).toBeTruthy();
    }
  });

  it('never names two people for one post', () => {
    for (const a of catalog) expect(String(a.currentLeadership.name ?? '')).not.toMatch(/\s\/\s/);
  });

  it('writes the same thing into every agency document', () => {
    for (const a of catalog) {
      const file = readdirSync(MD).find((f) => f.startsWith(`${a.abbreviation.replace(/[&\s]/g, '-')}-`));
      if (!file) continue;
      const doc = readFileSync(join(MD, file), 'utf8');
      expect(doc).toContain(leadershipLines(a.currentLeadership).slice(0, 2).join('\n'));
    }
  });

  it('says plainly when a name is not confirmed', () => {
    expect(leadershipLines({ position: 'Director General', name: null, unconfirmed: true }).join('\n')).toContain(NOT_CONFIRMED);
  });

  it('gives the assistant only confirmed names, and tells it never to guess', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { STATE_PERSONA_PROMPT } = require('./update-state-info-center.js');
    expect(STATE_PERSONA_PROMPT).toContain('Executive Governor: His Excellency, Muhammadu Inuwa Yahaya');
    expect(STATE_PERSONA_PROMPT).toContain('Secretary to the State Government (SSG): Prof. Ibrahim Abubakar Njodi');
    // No commissioner is named: Gombe's 23 are in office but unmapped to
    // portfolios in every source read, so the prompt lists none at all.
    expect(STATE_PERSONA_PROMPT).not.toMatch(/^- Commissioner for /m);
    expect(STATE_PERSONA_PROMPT).toMatch(/NEVER guess or recall a name from memory/);
    for (const stale of ['Satmark', 'Sunday Alex', 'Doeyok', 'Agabus', 'Timothy Dantong', 'Julie Sanda', 'Datong Dominic Gwaman']) {
      expect(STATE_PERSONA_PROMPT).not.toContain(stale);
    }

    // The 51 Plateau officials the table used to carry must not be reachable
    // through the persona by any route: every one of them held office in
    // another State, and the prompt is where the agent gets the names it says
    // out loud without searching.
    for (const plateau of [
      'Mutfwang', 'Josephine Chundung Piyo', 'Cletus Shurkuk', 'Chuwang Pwajok', 'Hart Bankat',
      'Dawal Solomon Kwande', 'Joyce Lohya Ramnap', 'Nicholas Ba', 'Philemon Audu Daffi',
      'Samuel Nanchang Jatau', 'Stephen Pam Gadong', 'Jim Wayas Pam',
      // Bauchi's, from the step between Plateau and Gombe. A rename maps a
      // surname onto an LGA name: "Muhammad Hamisu Shira" became "Muhammad
      // Hamisu Funakaye", a Gombe commissioner who does not exist.
      'Hamisu', 'Baraya Ibrahim', 'Bashir Yau', 'Adamu Babayo', 'Hassan Eliyakub',
      'Abdulkadir Ibrahim', 'Aminu Hammayo', 'Sani Umar', 'Bala Mohammed', 'Auwal Jatau',
    ]) {
      expect(STATE_PERSONA_PROMPT).not.toContain(plateau);
    }

    // Only offices a published Gombe source confirmed are named. Health,
    // Information, Agriculture and Works are in office but unnamed in any
    // source read, so the prompt must not list them at all.
    for (const unconfirmed of ['Commissioner for Health:', 'Commissioner for Works:', 'Commissioner for Agriculture:', 'Commissioner for Information', 'Commissioner for Education:']) {
      expect(STATE_PERSONA_PROMPT).not.toContain(unconfirmed);
    }
  });
});
