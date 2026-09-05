# Leak fix — pre-registration

**Written before any of the fix was written and before it was run.** Section 3
is frozen. Baseline is commit `7ab1f60`, where `test/leak-audit.mjs` reports
12 of 24 fixtures leaking: 3 secret-disclosure shapes and 9 terminal-escape
paths.

## 1. The change

`decisions.md` already says *errors are data, not prose: field path, cause and
code returned by the core and rendered by adapters.* The audit found that
`cause` **is** prose with values concatenated into it, so an adapter receives a
finished sentence and can mask or escape nothing. The declared boundary exists
in the code's shape and not in its content.

So the fix is not a guard on `url.js`. It is making that sentence true:

- **`refuse()` takes a template and a values object.** The template is a string
  literal with `$name` slots and **no `${}` interpolation at all**. A call site
  therefore cannot bake a value into a message, because there is no string to
  bake it into.
- **One escaping chokepoint.** Values are escaped once, where the Refusal is
  constructed, not at each call site — call-site masking is the thing
  `decisions.md` forbids, and a helper you must remember to call is a habit
  rather than a mechanism.
- **Secrets never reach a message.** `url.js` passes the masked URL, which it
  can build without parsing.
- **The prohibition is machine-checked.** `test/enumerate-refusals.mjs` becomes
  a check: any `refuse()` whose message argument contains `${` fails the suite.
- **Human output escapes control characters** in rendered header values, since
  the audit found one success path putting an escape on the terminal with
  nothing refused.

**Deliberately NOT in this change**, named so the omission is a decision:
aligning header validation with `node:http`'s wider rejected set. That changes
what reqtrail refuses, on the strength of a transport this release does not
have. It is a separate sitting.

## 2. What "fixed" means

`node test/leak-audit.mjs` exits 0. Not "the three reported paths are patched" —
the instrument was built first precisely so the target is a number rather than a
list.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| D1 | All **3** secret-disclosure paths close | high | any remains |
| D2 | All **9** terminal-escape paths close | medium-high | any remains |
| D3 | At least **one call site cannot be converted** without losing diagnostic value, and needs a judgement rather than a mechanism | medium | all twenty convert cleanly |
| D4 | The enumerator-as-check **catches at least one call site I miss** on the first pass | medium-high | it passes first time |
| D5 | At least **3 existing selftest checks break**, because they assert exact message text | medium | fewer than 3 |
| D6 | Parity stays byte-identical without being touched | high | it moves |
| D7 | Mutation coverage produces **at least one new survivor**, because the new escaping code has no mutant aimed at it | medium-high | none survives |
| D8 | At least two of D1–D7 wrong | medium | fewer than two |

### On D3

`schema.json` interpolates `e.message` from `JSON.parse`, which is a value from
neither me nor the file exactly — it is the runtime's description of the file.
Escaping it is right; whether it should be quoted as a value or kept as prose is
a judgement, and predicting that at least one such case exists is cheaper than
discovering it mid-edit and deciding hastily.

### On D7

The audit's own lesson was that three instruments each carried a defect that
would have produced a falsely reassuring number. New code with no mutant aimed
at it is the same failure waiting to happen, so the mutation pass is part of
this change, not a follow-up.

## 4. Recording

    D1-D7: right / wrong / not reached, with what was observed
    D8:    how many were wrong
    Every call site that needed a judgement rather than a mechanism
    Anything the fix broke that the suite did not catch

No wording is edited to match an outcome.
