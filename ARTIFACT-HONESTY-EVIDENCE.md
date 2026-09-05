# Artifact honesty — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`ARTIFACT-HONESTY-PREREGISTRATION.md`. Baseline `bc534d2`.

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| G1 | `legalComments: "eof"` recovers at least one copyright notice | **right** |
| G2 | It recovers notices for all three packages | **right** — 4 `@license` blocks |
| G3 | A generated notices file covers exactly react, react-dom, scheduler | **right** |
| G4 | Shipping `slice0/` and the records grows the tarball by under 30 kB | **right** — 90.4 → 102.2 kB |
| G5 | A check running the README's first command catches both faults | **WRONG** |
| G6 | At least two of G1–G5 wrong | **WRONG** — one was |

## G5 was wrong, and the check was the defect

The check extracted the command from the README, wrote the README's workspace
example to **the filename the command names**, and ran it. Both original faults
were reintroduced and it passed:

    missing --request  ->  selftest 135/135 OK
    wrong path         ->  selftest 135/135 OK

**It manufactured the conditions the command needed.** Writing the file to
whatever name the command happens to use means a wrong path can never fail —
the check assumed the thing it existed to verify.

That is the same defect as the `expect` field in `import-fidelity-spike`'s first
fixture set, which held a human guess where a measurement belonged, and it
arrived here in a check written specifically to catch this class of error.

**Repaired by taking the two facts independently.** The filename now comes from
the README's *instruction* — "save the workspace file … as `example.reqtrail.json`" —
and the command comes from the command. A mismatch between what the reader is
told to save and what the command opens is now visible. Both faults fail:

    wrong path in the command   ->  FAIL 1 of 135
    drift in the save-as name   ->  FAIL 1 of 135

## G6 was wrong, third sitting running

Predicted at least two of G1–G5 wrong; one was. E6 and F8 went the same way.
Three consecutive meta-predictions overestimating the error rate is worth
naming rather than shrugging at: either these sittings are genuinely small
enough that little can surprise, or the meta-prediction has stopped being a
prediction and become a ritual. The evidence for the first reading is that the
one wrong prediction each time has been substantive — a check that could not
fail, a UI that silently substituted a different request, a temporal-dead-zone
bug that broke six predictions at once.

## What was untrue, and is not now

**The bundle shipped React, react-dom and scheduler with no copyright notice.**
Measured at baseline: zero occurrences of "copyright" in `dist/app.js`, while
`react-dom`'s production entry opens with `@license React … Copyright (c) Meta
Platforms`. MIT requires the notice to travel with substantial copies, so the
tarball was distributing code without its licence.

Fixed twice over, deliberately:

- `legalComments: "eof"` — the bundle now carries 4 `@license` blocks.
- **`dist/THIRD_PARTY_NOTICES.md`, generated from esbuild's own module graph.**
  Not from a maintained list: a dependency added, removed or swapped changes the
  file automatically and cannot be forgotten. The build refuses if a bundled
  package has no licence file.

Both, because a minified bundle is a poor place to discharge an obligation that
exists to be readable. Verified from a real consumer install: the tarball's
`dist/` contains `THIRD_PARTY_NOTICES.md` and the installed bundle carries five
Meta notices.

**The README's first command failed twice** — it named a file that does not
exist at the repository root, and the real example holds two requests with no
`--request`. Now it tells the reader what to save and what to run, and the check
above runs it.

**The README said the slice-0 harness could be run**, and `files` shipped
neither it nor the records. True from a clone, false from an install. `slice0/`,
`SLICE-0-PREREGISTRATION.md` and `SLICE-0-EVIDENCE.md` now ship, +11.8 kB, and
a check ties `files` to what the README points at. The README also now says
plainly that the test suite is *not* in the package.

## Checks added

`test/ui.mjs` 12 → 16: the bundle preserves licence blocks; a notices file
covers every bundled package, derived from the graph rather than a list; every
notice reproduces a licence rather than a name; `files` ships what the README
points at. Demonstrated to fail by reverting `legalComments`.

`test/selftest.mjs` 134 → 135: the README's first command, run as written.

## Still open

- No mutant is aimed at the UI or the server; mutation covers the core and the
  CLI adapter.
- Header validation is narrower than `node:http`.
- Duplicate JSON members are silently last-wins; variable names are not checked
  against the reference charset; a stray `}}` is accepted as literal.
- `/api/session` answers without reading its body, so the body limit and the
  slow-upload deadline do not apply to it.
