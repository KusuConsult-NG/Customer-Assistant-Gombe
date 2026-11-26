# APC Gombe 2027 Situation Room — Rapid-Response, Verification & Escalation Protocol

**Command Center:** Dr. Jamil Isyaku Gwamna (Sardaunan Gombe) 2027 Election Situation Room  
**Scope:** Real-time coordination across Gombe State's 11 LGAs (Akko, Balanga, Billiri, Dukku, Funakaye, Gombe, Kaltungo, Kwami, Nafada, Shongom, Yamaltu/Deba), 114 Registration Areas, and 2,988 Polling Units.

---

## 1. Incident Response SLAs (Minutes, Not Days)

Election-day incidents are time-critical because polls close on a strict schedule. Every incoming report (Voice, 2G SMS, USSD, or Web) is assigned a response SLA based on severity:

| Severity | Examples | Target Response SLA | Immediate Action |
|---|---|---|---|
| **CRITICAL** | Ongoing violence (`VI`), ballot snatching (`SN`), casualties or active threats | **5 minutes** | Alert LGA Security Liaison & Legal Desk immediately; confirm agent safety; advise calling **112** for active physical danger. |
| **HIGH** | BVAS malfunction (`BVAS`), missing materials past 8:30 AM (`MAT`), vote buying (`VB`), over-voting (`OV`), Form EC8A tampering (`EC8`), collation dispute (`COL`), intimidation (`IN`) | **15–30 minutes** | Dispatch Ward/LGA Coordinator to polling unit; escalate BVAS/materials issues to INEC Electoral Officer (EO) liaison; assign Legal Desk officer for integrity disputes. |
| **MEDIUM** | IReV upload delay (`IREV`), underage voting (`UV`), secrecy breach (`SECY`), unit relocation (`REL`) | **120 minutes** | Log evidence, instruct agent to obtain signed Form EC8A copy, follow up before ward collation opens. |
| **LOW** | Routine operational inquiries or non-urgent clarifications | **480 minutes** | Handle via desk officer or knowledge base response. |

---

## 2. Strict Verification & Integrity Standards

To protect the credibility of the campaign and preserve admissible evidence for INEC reviews or election petitions:

1. **Incident Verification States:**
   - **UNVERIFIED:** Single initial report received. Never announce publicly as confirmed.
   - **CORROBORATED:** Two or more independent reports received for the same polling unit and incident type within the clustering window. Still requires human verification before official briefing.
   - **VERIFIED:** Confirmed by a Situation Room Desk Officer after callback to an accredited party agent/coordinator or inspection of documentary/photographic evidence.
   - **DISPUTED / FALSE_REPORT:** Conflicting reports or refuted claims. Kept permanently in the audit log (never deleted) so the full chain of custody is preserved.
2. **Accredited vs. Public Reporters:**
   - Reports from accredited party agents matched by phone number or agent code (`ACCREDITED`) are prioritized and tracked separately from public tips (`PUBLIC`).
3. **Legal Hold:**
   - Any incident involving Form EC8A alteration, ballot snatching, over-voting, or collation disputes must be placed under **Legal Hold** immediately so audio, transcripts, SMS logs, and uploaded evidence are preserved intact.

---

## 3. Parallel Vote Tabulation (PVT) & Form EC8A Dual-Control

1. **Provisional vs. Verified Totals:**
   - Incoming Form EC8A figures from field agents enter as **PENDING_REVIEW** (Provisional).
   - Official Situation Room tallies **strictly separate Verified EC8A totals from Provisional totals** until a Desk Officer reviews the figures (and Form EC8A photograph when available) and marks the result **VERIFIED**.
2. **Automatic Integrity Flags:**
   - `OVER_VOTING`: Total votes cast exceeds BVAS accredited voters.
   - `EXCEEDS_REGISTERED`: Total votes cast exceeds INEC registered voters for the polling unit.
   - `MATH_MISMATCH`: Reported total votes cast does not equal `validVotes + rejectedVotes`.
   - `CONFLICTING_SUBMISSION`: Two different result submissions arrived for the same polling unit with different figures.
   - Any flagged submission is automatically routed to the Verification & Legal Review Queue.

---

## 4. Escalation Chain

1. **Polling Unit Agent** → Reports via Toll-Free `0800 000 0779`, 2G SMS (`CHK` / `RES` / Incident Code), or USSD.
2. **Ward (Registration Area) Coordinator** → First physical responder across the ward's polling units; verifies materials, BVAS, and Form EC8A collection at Ward Collation Center.
3. **LGA Coordinator** → Coordinates across all wards in the LGA, tracks LGA coverage gaps on the Situation Room matrix, and interfaces with INEC LGA Electoral Officer.
4. **State Situation Room & Legal Desk (Gombe)** → Monitors statewide dashboard across all 2,988 polling units, verifies critical incidents and EC8A results, and prepares rapid-response or legal briefs for the Candidate and Campaign Director-General.
