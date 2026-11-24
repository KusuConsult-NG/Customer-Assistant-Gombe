# Gombe State polling unit register — where this came from

`gombe-polling-units.csv` holds **2,988 polling units** across all **11 Local
Government Areas** and **114 Registration Areas** of Gombe State, with INEC's
own codes in `State/LGA/RA/Unit` form (State code `15`).

## This is NOT an official INEC feed, and that matters

INEC publishes no bulk download. Its polling unit directory
(https://inecnigeria.org/polling-units/) is a lookup, and the CVR portal
(https://cvr.inecnigeria.org/pu) refused automated access during this work.

So this is a **community transcription of INEC's public CVR portal**, extracted
from the national file in
[`paul1029-ife/polling-unit-finder`](https://github.com/paul1029-ife/polling-unit-finder):

| | |
|---|---|
| Source file | `data/polling-units.csv` on branch `main` |
| Upstream SHA-256 | `28667fd3a5574eaae0436f98d4b693811886c895edb40f90cb754a2107a29484` |
| National totals | 176,846 units · 37 states/FCT · 774 LGAs · 8,809 wards |
| Retrieved | 2026-11-24 |
| Licence | MIT (preserved upstream at `data/LICENSE`) |

That repository states plainly that its file is "a community-maintained
transcription of INEC's public CVR portal, not a live official INEC API or a
guarantee of current voting assignments", and it is disciplined about the thing
that matters here: **no units are fabricated, geocoded or assigned ward
centroids.** It explicitly rejected a coordinate dataset that assigned the first
Google Places result per unit, because samples came back with Canadian
coordinates. That is why it was preferred over alternatives.

## What is therefore true and not true of this file

**True:** every code, unit name, LGA and Registration Area here came from INEC's
published data. Nothing was invented. The 11 LGAs match
`state-geography.ts` exactly, and the loader refuses any row whose LGA is not
one of the State's own — the check that would have caught a neighbouring
State's register, which matters because Gombe was carved out of Bauchi in 1996
and the two are often distributed together.

**Not true:** that this is current. Units are created, merged and relocated
between elections, and this snapshot is dated. **No coordinates are included**,
deliberately — `latitude`/`longitude` are empty for every unit, because a
guessed coordinate is worse than none when it is used to check whether a
reporter was where they said they were.

## Before the election

Get the register for the election in question from the **INEC Gombe State
office** and reload. The situation room's own observer deployment plan is
normally built from that file, so whoever assigns observers to units already
has it.

```bash
npm run units:load -- data/gombe-polling-units.csv          # report
npm run units:load -- data/gombe-polling-units.csv --apply  # write
```

The loader reports, per LGA, how many units it accepted and which of the 11
LGAs have none, so a partial or stale register is visible rather than assumed
complete.

## Unit counts per LGA in this snapshot

Akko 468 · Balanga 254 · Billiri 202 · Dukku 260 · Funakaye 258 · Gombe 408 ·
Kaltungo 247 · Kwami 237 · Nafada 131 · Shongom 122 · Yamaltu/Deba 401

Note that INEC's register spells it **YALMALTU/ DEBA**; this platform uses
**Yamaltu/Deba** and accepts both.
