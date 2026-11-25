# Design system

The rules the screens in `apps/web` are built from, why each one exists, and
where it is enforced. Most of them exist because something broke.

Nothing here is taste. Every colour claim in this document is asserted in
`apps/api/test/semantic-token-contrast.spec.ts`, in **both themes**, and the
brand ramp is asserted in `apps/api/test/palette-contrast.spec.ts`.

---

## 1. Both themes are first-class

An operations room runs with the lights down. Dark mode is the condition this
product is used in, not a preference.

**Never hardcode a surface.** No `bg-white`, no `bg-red-50`, no
`text-slate-600`. Use the custom properties in `globals.css`, which are
redefined under `.dark`.

The situation room shipped with `bg-red-50` panels and themed text. In dark
mode the ticket reference and incident type on every CRITICAL row rendered
`#f1f5f9` on `#fef2f2` — **1.00:1, the same colour**. The severity chip still
read CRITICAL, so the screen looked populated while the two fields saying
*which case* and *what happened* were blank.

## 2. Severity and verification are different devices, on purpose

| Axis | Question | Device |
|---|---|---|
| **Severity** | How bad is it? | Filled chip (`SeverityTag`) + 3px spine down the row |
| **Verification** | Has anyone checked? | Coloured text and a dot (`VerificationTag`). Never a fill |

The data model keeps these orthogonal, and the UI must too. Drawing them with
one device is how an unverified rumour comes to read as a confirmed emergency.

`CORROBORATED` is not `VERIFIED`. Independent reports agreeing is not somebody
having checked. They are never the same colour and never summed.

## 3. Colour never carries meaning alone

Every state is also written out. Roughly 1 in 12 men cannot separate red from
green, and this screen is read under pressure by people who did not choose it.

## 4. `edge` colours are rules; `--figure-*` colours are text

A 3px border clears the 3:1 graphical floor. The same hex as a numeral needs
4.5:1. The first draft of the redesign used an `edge` token for the coverage
percentage — the number saying how much of the State the screen can speak for
— and it measured **3.19:1**. Use `--figure-critical|warn|good` for figures.

## 5. `null` is not `0`

`null` means NOT KNOWN and renders `—`. A dashboard printing "0 open cases"
when the request failed has told an officer the agency is quiet, which is the
one thing it must never say by accident. `Figure` enforces this.

## 6. Time is relative, and the locale is en-GB

`14 min ago`, not `11/24/2026, 10:47:22 PM`. These rows are worked against a
response target measured in minutes and nobody subtracts wall-clock times at a
glance. The absolute time stays in the `title`. en-GB because this is deployed
in Nigeria, where `11/12` means 11 December.

## 7. One thing leads

A row where everything is emphasised has nothing emphasised. `KpiCard`'s
`emphasis="lead"` marks the single figure somebody acts on. The dashboard had
four identical tiles, so "total citizens" — which nobody acts on — carried the
same authority as "open cases", which is the job.

## 8. No greeting where data belongs

The dashboard opened with a 200px gradient panel whose largest text was
"Welcome back, Hadiza 👋" over a ✨ eyebrow. On a phone it filled the entire
first screen: an officer saw a greeting and had to scroll to reach a figure.
A greeting is not information.

Also banned, for the same reason: emoji as icons, decorative gradients that
encode nothing, and a badge that repeats a value already on screen.

## 9. The caveats are content

"A silent unit is not the same as a quiet one." "CORROBORATED means
independent reports agreed, NOT that anyone checked." These are the sentences
that stop the product misleading a briefing. They get the `Notice` component —
a left rule and a tinted panel, measured for contrast — not small grey text.

## 10. Machine ids never reach a person

An officer reads "Ballot box or material snatching", never `ballot_snatching`.
Where a type is missing from the taxonomy the id is humanised rather than
printed raw. See `labelFor` in `situation-room.service.ts`.

## 11. Flex children that must truncate need `min-w-0`

Without it a flex child will not shrink below its content. The top bar's
breadcrumb lacked it and pushed the theme toggle, the bell and the account
menu 122px off the right edge of every page. `body` has `overflow-x: hidden`,
so there was no scrollbar to reveal them — they were simply gone, while the
page reported no horizontal overflow.

## 12. Touch targets are at least 44px

---

## Where things live

| | |
|---|---|
| Tokens (both themes) | `src/app/globals.css` |
| Components | `src/components/ui/primitives.tsx` |
| Brand ramp | `tailwind.config.js` |
| Contrast tests | `apps/api/test/{semantic-token-contrast,palette-contrast}.spec.ts` |
| Origin guard | `apps/api/test/web-api-origin.spec.ts` |

## Checking a screen

Render it. Do not review it from the source.

```bash
node scripts/ui-contrast-audit.js
```

Measures every text node against its **composited** background — alpha
flattened through every ancestor — in both themes, and reports anything under
its WCAG floor, plus anything clipped outside the viewport that is not inside
a scrollable box. Two of the first findings on this screen were invisible to a
naive check that read `backgroundColor` literally.
