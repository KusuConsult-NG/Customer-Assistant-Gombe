# APC Gombe 2027 Election-Day Party Agent Field Handbook & SMS/USSD Reporting Guide

**Campaign:** Dr. Jamil Isyaku Gwamna (Sardaunan Gombe) — 2027 APC Governorship Campaign, Gombe State  
**Coverage:** All 11 Local Government Areas, 114 Registration Areas (Wards), and 2,988 INEC Polling Units  
**Situation Room Toll-Free Hotline:** `0800 000 0779` (`+2348000000779`)

---

## 1. Core Duties of an Accredited APC Polling Unit Agent

Every accredited party agent deployed to a Gombe State polling unit represents the campaign legally under the Electoral Act 2022 and INEC Election Regulations:

1. **Arrive Early (Before 7:00 AM):** Inspect your accreditation tag and confirm you are at the exact INEC polling unit assigned to you (`15-XX-XX-XXX`). Immediately send your arrival check-in.
2. **Verify Sensitive & Non-Sensitive Materials (7:30 AM – 8:30 AM):**
   - Confirm INEC officials arrive with the BVAS machine, ballot papers, ink, voting cubicles, and blank Form **EC8A**.
   - Confirm ballot boxes are empty before they are sealed in the open.
   - Verify the serial numbers of ballot papers and Form EC8A where read aloud by the Presiding Officer (PO).
3. **Monitor Accreditation & Voting (8:30 AM – 2:30 PM):**
   - Ensure BVAS accreditation is functioning smoothly. If a BVAS fails or takes excessive time, report it immediately using code `BVAS`.
   - Ensure voters in the queue at 2:30 PM are allowed to vote in accordance with INEC guidelines.
   - Remain peaceful, calm, and lawful at all times. Never engage in violence or verbal altercations; document and escalate immediately to the Situation Room.
4. **Observe Sorting, Counting & Form EC8A Completion:**
   - Watch every ballot sorted and counted aloud.
   - Confirm that **Total Votes Cast** (`Valid Votes + Rejected Votes`) does **not** exceed **Total Accredited Voters** on the BVAS.
   - Confirm that the Presiding Officer announces the result loudly, posts a copy at the polling unit, uploads Form EC8A to INEC IReV, and gives the accredited APC agent a signed duplicate copy of Form **EC8A**.
   - **Signing Form EC8A:** Sign Form EC8A **only** if the figures match the physical count you witnessed. If figures are altered, refused, or disputed, do **not** sign under duress — note the objection, keep photographic evidence if safe, and immediately report `RES` / `EC8A` to the Legal Desk via the Situation Room.

---

## 2. How to Report Over 2G SMS (No Internet Required)

Send SMS messages to the Campaign Situation Room SMS gateway. You can use slashes (`15/01/01/003`) or hyphens (`15-01-01-003`) for your polling unit code. If you are calling or texting from your registered accredited phone number, your assigned polling unit is recognized automatically if omitted.

### A. Polling Unit Check-In (`CHK`)

Format: `CHK <PU_CODE> <MILESTONE> [BVAS_STATUS] [OPTIONAL_NOTE]`

| Milestone Keyword | Meaning | Example SMS |
|---|---|---|
| `ARR` / `ARRIVED` | Agent arrived at polling unit | `CHK 15/01/01/003 ARR` |
| `MAT` / `MATERIALS` | INEC materials arrived (`OK` or `FAIL` for BVAS) | `CHK 15/01/01/003 MAT OK` |
| `OPEN` / `STARTED` | Accreditation & voting started | `CHK 15/01/01/003 OPEN OK` |
| `CLOSED` | Polls closed | `CHK 15/01/01/003 CLOSED` |
| `COUNTED` | Ballot counting completed | `CHK 15/01/01/003 COUNTED` |
| `EC8A` | Form EC8A signed and collected | `CHK 15/01/01/003 EC8A` |
| `IREV` | Form EC8A uploaded to INEC IReV | `CHK 15/01/01/003 IREV` |

If BVAS is faulty at opening, include `BVAS FAIL`:  
`CHK 15/01/01/003 OPEN BVAS FAIL machine not reading thumbs`

### B. Form EC8A Polling Unit Results (`RES`)

Send immediately once counting finishes and the Presiding Officer announces the polling unit result:

Format: `RES <PU_CODE> ACC <ACCREDITED> APC <VOTES> PDP <VOTES> NNPP <VOTES> LP <VOTES> [REJ <REJECTED>]`

Example:  
`RES 15/01/01/003 ACC 420 APC 290 PDP 115 NNPP 8 REJ 5`

- **ACC** = Total Accredited Voters on BVAS
- **REJ** = Rejected / Void Ballots
- The Situation Room automatically checks for over-voting (`Total Votes Cast > Accredited Voters`) and cross-checks against any other reports from your unit before marking the result **VERIFIED**.

### C. Election-Day Incident Short-Codes

Format: `<CODE> <PU_CODE> <BRIEF DESCRIPTION>`

| Code | Incident Type | When to Use |
|---|---|---|
| `VI` | Violence or attack | Fighting, weapons, thugs attacking voters or officials (**CRITICAL — 5 min SLA**) |
| `SN` | Ballot box snatching | Attempted or completed snatching of ballot boxes or papers (**CRITICAL — 5 min SLA**) |
| `IN` | Voter intimidation | Threats, harassment, or chasing away voters |
| `SEC` | Security misconduct | Partisan or unlawful conduct by uniformed security personnel |
| `DIS` | Disenfranchisement | Eligible voters turned away or denied access |
| `VB` | Vote buying / inducement | Cash or material inducement near the polling unit |
| `OV` | Over-voting | More ballots cast than BVAS accredited voters |
| `UV` | Underage voting | Minors permitted to vote |
| `EC8` | Form EC8A irregularity | Altered figures, missing result sheet, refusal to provide duplicate |
| `COL` | Collation dispute | Discrepancy between polling unit EC8A and Ward/LGA collation |
| `BVAS` | BVAS failure | BVAS machine malfunctioning, dead battery, or failing authentication |
| `IREV` | IReV upload failure | Presiding Officer unable or refusing to upload EC8A to IReV |
| `MAT` | Late or missing materials | INEC officials, ballot papers, or boxes missing past 8:30 AM |
| `REL` | Polling unit relocated | Polling unit moved without official notice |
| `SECY` | Ballot secrecy breached | Open voting or lack of voting cubicle privacy |

**Safety Tip:** If you are in danger and cannot safely take a callback, write `dont call me` or `cannot talk` in your SMS. For immediate life-threatening emergencies, also call **112**.

---

## 3. Calling the Toll-Free Situation Room Hotline (`0800 000 0779`)

- Calling **`0800 000 0779`** is free of charge.
- Clearly state your **name**, **accredited agent code** (if applicable), **LGA / Ward / Polling Unit code**, and **what is happening right now** (whether it is ongoing and whether anyone is injured).
- You will be given a **5-digit incident reference number** — write it down on the back of your field sheet for follow-up with your Ward Coordinator or Legal Desk.
