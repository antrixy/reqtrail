# Mutation coverage of the adapters — pre-registration

**Written before the change and before it was run.** Section 4 is frozen.
Baseline `bbba943`.

## 1. The gap

Mutation covers `src/core/` and `src/cli/main.js`. It does not cover
`src/server/server.js` — where the seventeen security rows live — or
`src/ui/main.jsx`.

The two most recent sittings both found real defects in exactly those files: a
temporal-dead-zone `ReferenceError` that broke six predictions and presented as a
blank 500, and a UI that silently substituted a different request when given an
unknown id. Both were found by fixtures written that day, not by any standing
check. **A row that has a test is not the same as a row whose test can fail**,
and nothing currently distinguishes them for the adapters.

## 2. A change to the harness, not only more mutants

Running every suite against every mutant costs about 13 seconds per mutant —
`server.mjs` alone is 10.6s, most of it the deliberate five-second stalled-header
measurement. At forty-plus mutants that is ten minutes, which is how a mutation
pass stops being run.

So each mutant declares **which suite should kill it**. The harness runs that
suite first; if the mutant survives, it runs the rest before calling it a
survivor. Three outcomes, and the middle one is new:

- **killed by the predicted suite** — the coverage story holds.
- **killed by a different suite** — the mutant dies, but the check that was
  supposed to be protecting that behaviour is not the one doing it. That is a
  finding about the suite, not a pass.
- **survivor** — nothing catches it.

## 3. What is not in scope

The browser sitting cannot be part of a mutation pass: it needs a browser the
package does not depend on and takes minutes per run. So UI *behaviour* has no
mutation oracle available in `npm test`, and this sitting will say so rather
than inventing one.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| H1 | At least **2 of the new server mutants survive** — the rows have tests, but not all of those tests can fail | medium-high | fewer than 2 |
| H2 | At least one mutant is **killed by a suite other than the one predicted**, so the middle outcome is not decorative | medium | none is |
| H3 | **Every UI-behaviour mutant survives `npm test`** — the UI is checked only by static greps and by a sitting that does not run in CI | high | any dies |
| H4 | The declared-suite scheme cuts the pass to **under four minutes** | medium | slower |
| H5 | At least two of H1–H4 wrong | medium | fewer than two |

### On H3

If H3 is right, the honest conclusion is not "add UI mutants and move on" — it
is that the UI's behavioural correctness rests entirely on a sitting run by hand.
That is a real statement about what the 0.1.0 evidence supports, and it belongs
in the evidence rather than in a comment.

### On H1

`test/server.mjs` was written from the seventeen rows, one check per row, which
is exactly the shape that produces checks asserting the row's *existence* rather
than its *effect* — the `|| true` failure in a different costume.

## 5. Recording

    H1-H4: right / wrong, with figures
    H5:    how many wrong
    Every survivor, by name, and whether it is a gap or an equivalent
    Every mutant killed by a suite other than the predicted one
