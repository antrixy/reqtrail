# Two fixes from the eleventh external input — pre-registration

**Written before the change and before it was run.** Section 3 is frozen.
Baseline `2f7e19a`.

## 1. What is being fixed, and one of them is embarrassing

**A. `ui.not-built` throws instead of refusing.** `loadAssets()` constructs a
`Refusal` with the obsolete `cause` argument. The errors rewrite made `template`
mandatory, so the path throws and the CLI prints *internal error — this is a bug
in reqtrail*, exiting 0. Reproduced. **Nothing in the suite touches it.**

This is the failure sitting B fixed for bad *schemas* — a refusal escaping into
the internal-error path and telling the user their file was fine and reqtrail was
broken — reintroduced one layer over by a signature change I made afterwards.

**B. The secret-containment sentence is false for the second time.**

    original:  no plaintext is materialised on the display side at all
    my fix:    plaintext exists in exactly one place — src/core/url.js
    measured:  eight sites across three modules read env[key]
               grammar.js  nested-template check, emptiness
               prepare.js  probe(), the control-char scan, the charset scan
               url.js      normalization, span attribution

**I corrected a false absolute with a narrower false absolute, in a correction
whose subject was that an unchecked absolute is what hid a defect.** The grep
that disproves it is one command and I never ran it. This is the
SECOND-ASSUMPTION pattern held as a candidate in the toon-diff handoff — the
second assumption made while fixing the first goes unexamined because attention
is on the first — and it now has a payout.

The honest rule, per the review: secret bytes may exist transiently inside the
core's private preparation, and never in public results, protocol responses,
renderers, logs or general-purpose errors. **That is testable; "only url.js sees
them" is not, and was not true.**

## 2. Explicitly NOT in this change

The `startUi` environment divergence — `{ ...process.env }` where `resolve` uses
`io.env ?? process.env` — is real, is the same ambient-state class as the first
parity failure, and is one line. It is left out so this sitting fixes what it
says it fixes. The 0.2.0 boundary work is a separate sitting with its own
pre-registration.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| M1 | A distinct startup-failure type fixes A, and no existing check breaks | medium-high | any breaks |
| M2 | **No mutant currently aimed at the `ui.not-built` path exists**, so the fix needs a new check AND a new mutant, or it is untested again | high | one exists |
| M3 | A machine check can express the corrected rule — no secret in any public result — but **cannot** express "only these modules may read one" without naming modules, which is a grep and therefore mention-vs-use fragile | medium | a robust structural check exists |
| M4 | The eight sites are all **legitimate**: each needs the value to decide something, and none can be removed without losing a check | medium | any is gratuitous |
| M5 | At least one of M1–M4 wrong | medium | none is |

### On M4

The reflex on being told secrets are read in three modules is to consolidate.
That may be wrong: `grammar.js` needs the value to know whether it contains a
template, `prepare.js` needs it to find a control character. Consolidating for
tidiness would move the reads without reducing them. **Predicting they are all
legitimate makes the answer a measurement rather than a preference.**

## 4. Recording

    M1-M4: right / wrong, with what was observed
    M5:    how many wrong
    Every site that turns out gratuitous, named
