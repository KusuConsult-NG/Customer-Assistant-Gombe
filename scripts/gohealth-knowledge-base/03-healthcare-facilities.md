# GOHEALTH Accredited Healthcare Facilities — Provider Network

## Overview

GOHEALTH maintains a network of accredited healthcare providers (**the number is NOT CONFIRMED**) across all **20 Local Government Areas (LGAs)** of Gombe State. The network includes:

- **Primary Healthcare Centres (PHCs)** — First point of contact for all enrollees
- **Secondary Hospitals** — For referrals and moderate-complexity care
- **Tertiary Hospitals** — For specialist and complex cases
- **Accredited Pharmacies** — For prescription dispensing when hospital pharmacy is out of stock
- **Diagnostic/Laboratory Centres** — For blood tests, X-rays, ultrasounds, and other investigations

---

## How to Find Your Nearest Accredited Facility

1. Visit the **GOHEALTH Provider Directory**: https://gohealth.pl.gov.ng/providers
2. Filter by **LGA** (e.g., Gombe, Akko, Dukku) and **Category** (Hospital, Pharmacy, Laboratory, etc.)
3. Or call **0700-700-1111** (24/7 toll-free) to ask a desk officer to locate a facility near you

---

## Local Government Areas Covered

Gombe State has **20** Local Government Areas. GOHEALTH reports a delivery
footprint of **323 primary health facilities**, **26 general hospitals** and the
**Specialist Hospital, Gombe**.

**Which facilities are accredited, and in which LGA, is NOT CONFIRMED in this
service.** No published source names them.

### Facilities confirmed by name

Both in **Gombe LGA**:

- **Gombe State Specialist Hospital** — the State facility, which commenced
  operations on 19 December 2018 under a 2018 State law.
- **Federal Teaching Hospital, Gombe (FTH Gombe)** — federal,
  formerly the Specialist Hospital, Gombe, taken over by the Federal
  Government in 2010.

These are two different institutions with similar names. Establish which one a
caller means before giving any detail.

### What to tell a caller about any other LGA

Say that we do not have the accredited facility list for their area, that they
can use their nearest General Hospital or Primary Health Centre, and that
GOHEALTH will confirm which facilities are accredited there. Offer a callback if
they want it confirmed.

**Never name a facility that is not listed above, and never tell a caller that a
facility is or is not accredited.**

### Why this section is short

What stood here was a list of accredited providers for 20 LGAs — hospitals,
clinics and primary health centres by name, and the wards each LGA "includes".
It belonged to a different State's scheme: its hospitals, its wards, its 17
LGAs. The rebrand had replaced the LGA headings with Gombe's and left the
hospitals and wards beneath them untouched. A citizen acts on this page by
travelling, so it was deleted rather than approximated.

### Filling it in

Get the accredited-provider list from GOHEALTH, by LGA, and load it with
`npm run catalogue:seed`. `lgasWithoutFacilities()` reports which of the 20 LGAs
are still uncovered.

---
Last updated: 2026-11-20.
