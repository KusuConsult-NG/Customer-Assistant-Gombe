/**
 * An events lineup answers the questions callers ask, WHOLE.
 *
 * The lineup document is search-knowledge's source for events, and the agent
 * only speaks the passage relevantPassage() picks from it. Each event is one
 * self-contained line (date, event, venue, organiser) so the line that answers
 * the question carries everything needed, and a broad question ("what's on?")
 * must return every event rather than the first few that fit in a passage.
 *
 * ── Why this suite uses a fixture ───────────────────────────────────────────
 *
 * It used to read `data/mda-knowledge/December-Tourism-Month-2026-Events.md`
 * and assert on its contents — "Jonah Jang Way", "Azi Nyako Youth Centre",
 * "Secretariat Flyover Bridge". That document was Plateau State's real December
 * lineup, and Gombe State's calendar has not been compiled, so those
 * assertions were requiring the knowledge base to state Plateau venues as
 * Gombe ones: a test actively holding the wrong data in place.
 *
 * What the suite is actually for is the passage machinery, not any one State's
 * events, so the lineup now lives here as a fixture in the shape the real
 * document specifies. The real document is checked separately, below, to be an
 * honest "not compiled" stub — so that when Gombe's calendar does arrive,
 * these tests are what it is written to satisfy.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { relevantPassage } from '../src/agent-tools/relevant-passage';
import { SEARCH_KNOWLEDGE_PASSAGE_CHARS } from '../src/agent-tools/agent-tools.service';
import { agentPromptFor } from '../src/agent-tools/agent-tool-catalog';

import { LINEUP as DOC } from './fixtures/events-lineup';

const ORG = {
  name: 'Gombe State Government Citizen Contact Centre',
  slug: 'gombe-state',
  timezone: 'Africa/Lagos',
  welcomeMessage: null,
  aiPersonaPrompt: null,
} as any;

describe('an events lineup', () => {
  it.each([
    ['When is the closing concert and fireworks?', /31 March 2027 — Closing Concert and Fireworks/],
    ['Where is the Gombe Food Festival?', /Gombe Food Festival[\s\S]*Venue: Gombe/],
    ['When does the Akko Durbar hold?', /20 March 2027 — Akko Durbar[\s\S]*Kumo, Akko/],
    ['Tell me about Urban Fest', /26 to 28 March 2027 — Urban Fest[\s\S]*gaming arena/],
    ['When is the Gombe Cultural Carnival?', /22 to 24 March 2027 — Gombe Cultural Carnival/],
    ['When is BAUFEST?', /December 2027 — BAUFEST/],
  ])('answers from the one line that carries the answer: %s', (question, answer) => {
    const passage = relevantPassage([DOC], question);
    expect(passage).toMatch(answer);
  });

  it('hands the phone agent EVERY event for a broad question, not the first few', () => {
    // 1,200 characters stopped part-way through the lineup and the caller was
    // given the first events as if they were all of them.
    const passage = relevantPassage([DOC], 'What events are happening in Gombe?', SEARCH_KNOWLEDGE_PASSAGE_CHARS)!;
    for (const event of ['Dadin Kowa Wildlife Week', 'Gombe Food Festival', 'Urban Fest', 'Closing Concert and Fireworks', 'Gombe Cultural Carnival', 'Gombe Film Showcase']) {
      expect(passage).toContain(event);
    }
  });

  it.each([
    'What is on in Gombe, the events lineup?',
    'What are the activities for the festive season?',
    'What is on for ONE GOMBE FEST?',
  ])('gives every event when the question names the lineup by another of its names: %s', (question) => {
    // These matched only the "Also known as" line, so the caller got the
    // introduction and four lines instead of the events.
    const passage = relevantPassage([DOC], question, SEARCH_KNOWLEDGE_PASSAGE_CHARS)!;
    for (const event of ['Dadin Kowa Wildlife Week', 'Urban Fest', 'Closing Concert and Fireworks']) {
      expect(passage).toContain(event);
    }
  });

  it('lists all thirteen events and the flagship festival', () => {
    const events = DOC.match(/^- \*\*[^*]+ — [^*]+\*\*/gm) ?? [];
    expect(events).toHaveLength(14);
  });

  it('says plainly where a date or venue is not fixed yet', () => {
    expect(DOC).toMatch(/dates to be announced — Dadin Kowa Lakeside Festival/);
    expect(DOC).toMatch(/do not guess one/);
  });
});

describe('the phone agent is told how to answer from a lineup', () => {
  it('tells the phone agent to search before ever saying it does not have something', () => {
    // A caller heard the whole lineup one evening and was told it was not
    // there the next morning: whether to search was left to the model.
    const prompt = agentPromptFor(ORG);
    expect(prompt).toContain('SEARCH EVERY TIME');
    expect(prompt).toMatch(/Never tell a caller something is not available[^\n]*unless search-knowledge was called for it in this call/);
  });

  it('tells the phone agent to give all of it, paced, rather than shorten it', () => {
    const prompt = agentPromptFor(ORG);
    expect(prompt).toContain('COMPLETE ANSWERS');
    expect(prompt).toMatch(/give three at a time, then ask "Shall I continue\?"/);
  });
});

describe("the State's own events document", () => {
  const REAL = readFileSync(
    join(__dirname, '..', '..', '..', 'data', 'mda-knowledge', 'Gombe-State-Tourism-and-Events.md'),
    'utf8'
  );

  it('states that no lineup is confirmed, rather than carrying another State’s', () => {
    expect(REAL).toMatch(/has not been compiled/);
    expect(REAL).toMatch(/Ministry of Culture and Tourism|Gombe State Tourism Corporation/);
  });

  it('carries no Plateau venue, festival or road name', () => {
    // The lineup it replaced named all of these as Gombe venues. They are in
    // Plateau State. If one reappears, the document is Plateau's again.
    for (const plateau of ['Jonah Jang', 'Azi Nyako', 'Tin City', 'TinCity', 'PLAFEST', 'ONE PLATEAU', 'Ten Commandments Prayer Ground']) {
      expect(REAL).not.toContain(plateau);
    }
  });

  it('lists no event as though it were scheduled', () => {
    const events = REAL.match(/^- \*\*\d[^*]* — [^*]+\*\*/gm) ?? [];
    expect(events).toHaveLength(0);
  });
});
