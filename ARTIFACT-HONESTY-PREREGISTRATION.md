# Artifact honesty — pre-registration

**Written before any of the change was written and before it was run.**
Section 3 is frozen. Baseline `bc534d2`.

## 1. Scope: things a shipped file says that are not true

Three of them, all in the class this project has now fixed twice — a committed
artifact asserting something the code does not do.

- **The bundle carries React, react-dom and scheduler and no copyright notice
  at all.** `legalComments: "none"` strips them. Measured at `bc534d2`: zero
  occurrences of "copyright" in `dist/app.js`, while `react-dom`'s production
  entry opens with `@license React … Copyright (c) Meta Platforms`. MIT requires
  the notice to travel with substantial copies, so the published tarball is
  distributing code without its licence.
- **The README's first command fails.** `npx reqtrail resolve example.reqtrail.json`
  names a file that does not exist at the repository root, and the real file
  holds two requests with no `--request`, so it would refuse even with the path
  corrected. Two faults in the first command a reader runs.
- **The README says the slice-0 harness can be run**, and `files` does not ship
  `slice0/` or the evidence documents, so that is true from a clone and false
  from an install.

## 2. What is not in scope

Header validation, strict JSON handling, `/api/session`, and mutants aimed at
the UI. Named so the omission is a decision rather than an oversight.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| G1 | `legalComments: "eof"` recovers **at least one** copyright notice into the bundle | medium-high | zero |
| G2 | It recovers notices for **all three** packages — react, react-dom, scheduler | medium | fewer than three |
| G3 | A generated `THIRD_PARTY_NOTICES.md` covers exactly those three, and no more | medium-high | any other package appears |
| G4 | Shipping `slice0/` and the evidence documents grows the tarball by **under 30 kB** compressed | medium | more |
| G5 | A check that runs the README's first command **as written** would have caught both faults, and catches nothing else once fixed | medium | it finds a third |
| G6 | At least two of G1–G5 wrong | medium | fewer than two |

### On G2

react's own bundles use `@license` consistently, but esbuild only preserves a
comment it still sees after tree-shaking and minification. A package whose
licence header sits in a file that is entirely eliminated contributes nothing.
Predicting three and measuring is the point; if it is fewer, **the bundle alone
cannot discharge the obligation** and the generated notices file is not
belt-and-braces but the actual mechanism.

### On G5

The existing drift check validates the README's fenced example output. It did
not catch the opening command, because the command is prose and the check reads
a code block. That is the same shape as every other gap found here: the check
covers the part that looks checkable.

## 4. Recording

    G1-G5: right / wrong / not reached, with the observed figure
    G6:    how many were wrong
    Whether the bundle alone discharges the licence obligation, stated plainly
