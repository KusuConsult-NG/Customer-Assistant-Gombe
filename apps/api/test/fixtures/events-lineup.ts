/**
 * An events-lineup document, in the shape the real one must take.
 *
 * ── Why this is a fixture and not the State's own document ──────────────────
 *
 * Four suites — the passage picker, the FAQ ordering, the keyword ranking and
 * the chunk stitching — used to read
 * `data/mda-knowledge/December-Tourism-Month-2026-Events.md` and assert on its
 * contents. That document was PLATEAU State's real December lineup, and the
 * rebrand to Gombe left its venues intact: the Christmas Village on Jonah Jang
 * Way, the Azi Nyako Youth Centre, the Secretariat Flyover Bridge, "TinCity
 * Fashion Week", PLAFEST. Gombe State's events calendar has not been compiled,
 * so those assertions were requiring the knowledge base to state another
 * State's venues as Gombe's — tests holding wrong data in place.
 *
 * What the suites are actually for is the retrieval machinery: that a broad
 * question returns EVERY event rather than the first few, that a lineup cut
 * into ~1,800-character chunks is stitched back together, that a long document
 * with a matching title outranks shorter ones, and that one line carries date,
 * event, venue and organiser so the line that answers a question is complete.
 * None of that depends on which State's events they are.
 *
 * So the lineup lives here, with placeholder events at real Gombe places, and
 * this is the specification Gombe's own calendar will have to satisfy when the
 * Ministry of Culture and Tourism supplies it. The real document is asserted
 * separately — in `events-lineup-knowledge.spec.ts` — to be an honest "no
 * calendar is confirmed" page carrying no Plateau venue at all.
 *
 * Kept deliberately longer than 3,600 characters: one suite slices it into
 * three chunks to reproduce how production stores it.
 */
export const LINEUP_TITLE = 'Gombe State Events Lineup 2027';

export const LINEUP = `# ${LINEUP_TITLE}
Also known as: events lineup, what is on in Gombe, festive season events, Gombe State events calendar, ONE GOMBE FEST

March is Gombe State's cultural season. The State's public and private sector events are coordinated under ONE GOMBE FEST, so that visitors and residents can enjoy a single, well-planned season from the opening at Dadin Kowa to the closing concert. The Gombe State Tourism Corporation (GSTC) coordinates the State's events.

## Events, in date order

- **3 March 2027 — Dadin Kowa Wildlife Week** (guided game drives, conservation talks and school visits across the reserve, with evening programmes at the springs). Venue: Dadin Kowa Dam, Akko. Organised by: the Government (Gombe State Tourism Corporation, GSTC).
- **8 March 2027 — Gombe Youth Enterprise Roundtable** (youth enterprise, digital tourism and jobs, with a pitch session for young operators). Venue: Gombe. Organised by: the Government (Gombe State Tourism Corporation, GSTC) with development partners.
- **10 to 12 March 2027 — Gombe Craft Exhibition** (crafts, leatherwork, textiles, products and businesses of the State on show, with daily demonstrations). Venue: Gombe. Organised by: the private sector.
- **14 March 2027 — Bulok Warm Spring Open Day** (swimming, guided walks and family activities at the warm springs, free for school groups). Venue: Bulok Warm Spring, Akko. Organised by: the Government (Gombe State Tourism Corporation, GSTC).
- **16 to 18 March 2027 — Gombe Food Festival** (cooking, tasting and a producers' market, with a competition on the final evening). Venue: Gombe. Organised by: the private sector.
- **20 March 2027 — Akko Durbar** (horsemanship, parades and traditional music, beginning in the morning and closing at dusk). Venue: Kumo, Akko. Organised by: jointly, public and private sector.
- **22 to 24 March 2027 — Gombe Cultural Carnival** (parades, troupes and cultural showcases from communities across the twenty Local Government Areas). Venue: Gombe, venue to be announced. Organised by: jointly, public and private sector.
- **25 March 2027 — Gombe Film Showcase** (screenings of work by film-makers from the State, with a question-and-answer session). Venue: Gombe. Organised by: the private sector.
- **26 to 28 March 2027 — Urban Fest** (graffiti, music, basketball and a gaming arena, running from the afternoon into the evening each day). Venue: Gombe. Organised by: the private sector, supported by the Gombe State Tourism Corporation (GSTC).
- **28 March 2027 — Gombe Marathon** (full and half distances, with a family fun run). Venue: Gombe, route to be announced. Organised by: the private sector.
- **Late March 2027, dates to be announced — Dadin Kowa Lakeside Festival** (a three-day waterside programme of music, boating and food). Venue: Dadin Kowa Dam, Gombe. Organised by: the Government (the State).
- **30 March 2027 — Billiri Agricultural Fair** (livestock, produce and farm equipment, with extension advice stands). Venue: Billiri. Organised by: the Government (the State).
- **31 March 2027 — Closing Concert and Fireworks Countdown** (the season's closing night, with performances and a fireworks display). Venue: Gombe. Organised by: the Government (Gombe State Tourism Corporation, GSTC).

## Looking ahead

- **December 2027 — BAUFEST**, the State's flagship culture, tourism and creative economy festival.

## Please note

Dates and venues may change. Where a date or venue says "to be announced" or "to be confirmed", it has not been fixed yet: say so, and do not guess one. Visitors should check official Gombe State Government and Gombe State Tourism Corporation (GSTC) channels for updates.
`;
