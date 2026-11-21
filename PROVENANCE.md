# Provenance

This codebase is a repurposing of **Customer Care Agent** — a commercial
multi-tenant customer-experience product whose flagship tenant was PLASCHEMA,
the Plateau State Contributory Healthcare Management Agency. (That name is
historical and is left as it was: this file is the record of what happened, and
the rebrand described below must not be allowed to rewrite it.)

It is being rebuilt as a **State-wide citizen customer care platform**, operated
by the Ministry of Information, with every ministry, department and agency as
an isolated tenant of one deployment.

## What was removed, and why

| Removed | Reason |
|---|---|
| Subscription billing (plans, checkout, usage limits, subscription guard) | The State is not a paying SaaS customer of itself. |
| Citizen premium collection (`/api/public/pay/*`, the Paystack path, the `Payment` model) | Out of scope: this platform answers citizens, it does not collect revenue. |
| Health-scheme identity in citizen-facing output | A hardcoded scheme name, two premium amounts and one helpline were being read aloud and texted to the citizens of every agency. |
| Dated QA and certification artefacts | See below. |

## On the removed certification documents

Fourteen QA and certification artefacts were removed in the first subtraction
commit. They described the old single-agency deployment, and several made
claims that were **not true of the code they described** — two separate
documents certified the system as production ready with "0 remaining P0/P1
defects" at a time when an unauthenticated endpoint could activate health
coverage for any enrollee on any tenant, for any amount, for free.

Upstream, one of those documents was formally withdrawn in place so the record
of what had been asserted would survive. That withdrawal covered one file; four
others carrying the same class of claim were left untouched, and a second
document certifying the system outright was never withdrawn at all.

Carrying them into this repository would be worse than deleting them: a reader
here would reasonably take them as describing *this* system, which has not been
assessed at all.

They are removed rather than re-withdrawn because:

- the **upstream repository retains them**, including the formal withdrawal
  notice, so the record of what was claimed is not destroyed; and
- they remain in this repository's **git history** at and before the first
  subtraction commit.

**Nothing in this repository certifies this system as production ready.** No
such assessment has been carried out against the repurposed codebase.

## Known gaps carried over

These were true of the upstream system and remain true here:

- The voice path has **never completed a real call end to end** under either
  conversation engine.
- The hosted agent layer (`apps/api/src/agent-tools`) is built and tested but
  **has never served a real customer**.
- Outbound WhatsApp notices are blocked on provider template approval.
- Calendar synchronisation is not implemented.
- SMS, email and social channels exist in the data model only.

## Still to do for the State-wide model

- ~~A platform administration tier.~~ **Built** — `apps/api/src/platform`, see
  the section in `CLAUDE.md`. State-wide overview, per-agency comparative
  reporting, agency provisioning, suspension and reinstatement, and a
  cross-agency audit trail, with a console at `/platform` in the dashboard. It
  reports metrics and configuration only, never citizen content.
- ~~Per-agency service hours.~~ **Done.** `Organization.openingHour`,
  `closingHour` and `serviceDays` drive appointment search for both engines,
  editable under Settings → General. Defaults reproduce the old Mon–Fri
  08:00–18:00 exactly, so no existing agency changed behaviour.
- ~~De-scheme the agent prompt.~~ **Done.** `SYSTEM_PROMPT` went from 443 lines
  to 61: the health plans, the accredited-facility directory and the scheme
  pronunciation rule are gone, and it now states that the agency's own
  instructions are the only source for services, eligibility, fees and
  locations — and to refuse rather than infer when they do not cover a
  question. The dashboard shell, the digital ID card, the spoken registration
  confirmations and the issued reference prefix are all driven by the agency's
  own record.

- ~~Per-agency service locations.~~ **Done.** `ServiceLocation` rows per
  agency, keyed by LGA, replacing the hardcoded hospital directory.

- ~~Generalise the registration flow.~~ **Done.** `ServiceOption` rows per
  agency replace the four hardcoded health plans, and the flow reads whichever
  the agency configured. `npm run catalogue:seed <slug> --apply` moved the
  health scheme's own plans and facilities into its rows, so it kept working.
  An agency with no services configured cannot run a registration and hands
  over, rather than asking a citizen to choose from an empty list.
  `ENROLLMENT_FLOW_NAME` stays `'gohealth-enrollment'` deliberately — it is
  written into `Conversation.flowState`, so renaming it would strand every
  citizen part-way through a form.

- ~~No management screen for the catalogue.~~ **Done.** `/services` in the
  dashboard, under Administration. Reading is open to any member; writing is
  OWNER/ADMIN. LGAs are chosen from the State's list rather than typed, and
  the page states the consequences — an agency with no active services cannot
  register anyone, and an LGA with no location simply means the assistant does
  not ask which office.


## The Gombe State rebrand (2026-11-20)

The platform was a **Plateau State** deployment. It is now a **Gombe State**
one. The rename itself was mechanical — 188 files, the agency acronyms
(PLASCHEMA → GOHEALTH, PLASEMA → GSEMA, PICTDA → GICTDA, JMDB → GMDB and the
rest), the filenames, the prompts. What took the work was everything the rename
would have left quietly wrong.

### Why a rename is not enough

The repository was factually dense and its facts were *verified* — 51 agency
heads each with a published source URL, 17 named LGAs, ~170 projects with naira
figures, a budget to the kobo, accredited hospitals by LGA, traditional rulers
by chiefdom, five emergency telephone numbers. A rebrand turns a correct record
about one State into a **confident false record about another**, and the
confidence is the part that does the damage: the platform's own rule is that "a
wrong name said with confidence is worse than none".

So Plateau's facts were **deleted, not translated**. What replaced them is
either confirmed by a published Gombe source read on 2026-11-20, or marked
NOT CONFIRMED so the assistant says it does not know and names the office that
does. The detail is in the commit messages on `rebrand/gombe-state`.

### What a rename could not fix, and what is still outstanding

These are the items no amount of text editing resolves. Each is flagged in the
code that uses it.

| Outstanding | Where | Why it matters |
|---|---|---|
| **Both ElevenLabs voice clones are Plateau's.** The assistant voice is a clone the Plateau team commissioned; the opening is a clone of **Caleb Mutfwang**, Governor of Plateau State. | `GARBA_VOICE_ID`, `GOVERNOR_VOICE_ID` in `agent-tools/elevenlabs-contracts.ts` | "Welcome to the Gombe State Government Citizen Contact Centre" would be spoken in another State's Governor's voice, under Inuwa Yahaya's name. It is also a licensing question: the people who recorded them consented to a Plateau deployment. **Re-record before any live call.** |
| **The pronunciation dictionary is Plateau's**, and lives in their ElevenLabs workspace, not in this repo. | `agent-tool-catalog.ts`, the dictionary-pinning block | It pins Nanpan, Plateau, Mutfwang, Rantya, Gyel. Nothing teaches the model to say Akko, Shongom, Yamaltu/Deba, GOHEALTH or Inuwa Yahaya, which it will mispronounce until a Gombe dictionary exists. |
| **The ASR confusion table was empirical and is now empty.** | `agent-tool-catalog.ts` | "State Lagos" → "Rantya, State Lowcost" was *observed* in Plateau call transcripts. A mapping nobody has heard on a Gombe line is a guess that files a citizen under the wrong LGA. Collect the real ones from live calls. |
| **No emergency numbers.** 112 is the only number the platform states. | `Organization.emergencyContacts`, Settings | The five that were hardcoded were Plateau's police, fire service, task force, SEMA and security control room. Set Gombe's real lines in Settings; `{{emergency_contacts}}` carries them to the live agent. |
| **49 of 57 agency heads have no name.** | `data/verified-leadership.json` | Gombe's press names commissioners by portfolio at each reshuffle, but no source enumerates the full cabinet or the parastatal chief executives. Add each with a source. |
| **No projects, no budget figures, no events calendar, no tax or scholarship schedules, no ministry phone directory, no office addresses, no LGA chairmen, no traditional rulers.** | `data/mda-knowledge/*`, `scripts/enrich-mda-projects.js` | Each page says so and names the office that holds it. |
| **One accredited facility pair.** Gombe State Specialist Hospital and FTH Gombe, both in Gombe LGA. | `packages/database/src/service-locations.ts` | Gombe publishes counts (26 general hospitals, 323 primary health facilities) but names none. `lgasWithoutFacilities()` reports the 19 uncovered LGAs. Load the real directory with `npm run catalogue:seed`. |
| **Which LGAs form which Senatorial District is disputed** between published lists (Billiri is placed in both North and Central). | `Gombe-State-Master-Citizen-Guide.md` | Take the current delimitation from INEC. |
| **`test-evidence/*.webp` screenshots still show Plateau branding.** | `test-evidence/` | They are images of the old deployment's UI and cannot be edited. Re-capture them. |
| **The GOHEALTH scheme documents are banner-marked, not rewritten.** | `scripts/gohealth-knowledge-base/*.md` | Their plans, premiums, benefit packages and procedures are PLASCHEMA's, under its own 2019 law. Replace with GOHEALTH's own published documents, then delete the banners. |

### One thing the rename nearly broke

`ENROLLMENT_FLOW_NAME` was renamed from `'plaschema-enrollment'` to
`'gohealth-enrollment'`. The comment above that constant warns, in terms, that
renaming it strands every citizen part-way through a form, because the old
string is written into `Conversation.flowState.flow` and the flow registry is
keyed by name. The flow is therefore registered under **both** names
(`LEGACY_ENROLLMENT_FLOW_NAMES`), with a test pinning it and the query to run
before deleting the alias. A fresh Gombe database has no such rows; nothing in
the code can tell a fresh database from one being re-pointed, and the failure
would have been silent and landed on the citizen.
