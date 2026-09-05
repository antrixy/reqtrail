# Instrument repair — pre-registration

**Written before any of the repair was written and before it was run.**
Section 3 is frozen. Baseline is commit `b500665`.

## 1. Why now, and not after the next piece of work

Three instruments carry defects that make a green result mean less than it looks:

- `test/selftest.mjs:246` ends in `|| true` — a check that cannot report
  failure, in a suite whose stated rule is that such a thing is not a check.
- `test/sitting-browser.mjs:173` exits 0 unless B4–B7 fail, so **B1, B2, B3, B8
  and B9 can all fail silently**.
- B1 collects `pageErrors` and does not include them in its verdict.
- B5's verdict checks only whether the browser's `fetch` rejected, though the
  prediction claims both browser and server refusal.
- `readSource` shells out to `cat`, in an otherwise portable Node suite.

**The ordering argument is the whole reason this is its own sitting.** The next
real work is the UI refusal contract, and the way it gets verified is by adding
refusal fixtures to sitting A. Repairing a gate in the same sitting it is meant
to judge produces a result that cannot be trusted in either direction. Fix the
instruments while they have nothing to prove.

No product code changes here. If any does, this sitting has gone wrong.

## 2. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| E1 | Removing `\|\| true` makes that check **fail**, because the fixture has one substituted header span and the assertion says zero | medium-high | it passes as written |
| E2 | Grepping for `\|\| true` finds the only vacuous check; a scan for other always-true assertions finds **none** | medium | any is found |
| E3 | Widening the sitting gate to "any wrong prediction" makes sitting A **fail on B10**, because B10 is a meta-prediction that is expected to be wrong once the others hold | medium-high | the sitting passes |
| E4 | Including `pageErrors` in B1's verdict changes nothing today — the success fixture produces none | high | it changes a verdict |
| E5 | Replacing `cat` with `readFileSync` changes no result | high | any check moves |
| E6 | At least one of E1–E5 wrong | medium | none is |

### On E3

This is the interesting one. The obvious repair — fail the sitting on any wrong
prediction — is wrong as stated, because a sitting containing a meta-prediction
about its own error rate cannot use that meta-prediction as a gate: the better
the work, the more certainly the gate trips. Predicting the collision before
making the change is cheaper than discovering it and hastily excluding B10 to
get green.

### On E1

The check is `prov(...).length === 0`, and the fixture substitutes `{{x}}` into
a header value, so the honest length is 1. If that is right, the `|| true` was
covering a **wrong assertion**, not a redundant one — the author wrote a check,
watched it fail, and silenced it. That is worse than an unfalsifiable check and
should be recorded as such.

## 3. Recording

    E1-E5: right / wrong / not reached, with what was observed
    E6:    how many were wrong
    Any check that changes verdict, and why
    Any product code touched — there should be none
