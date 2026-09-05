# Body limits on every route — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`BODY-LIMITS-PREREGISTRATION.md`. Baseline `816139e`.

    oversized body   /api/session 200 -> 413   /api/resolve 413 -> 413
    mutants          45 -> 48
    mutation pass    215s -> 520s -> 238s      (see I4)
    suite            server 51/51 + server-slow 2/2

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| I1 | A mutant removing the limit from `/api/session` alone survives the old suite | **right** |
| I2 | The slow-upload deadline works as configured once tested | **right** — 408 |
| I3 | Routing `/api/session` through the reader changes nothing else | **right** |
| I4 | The mutation pass grows by under 90 seconds | **WRONG** — it grew by 305s |
| I5 | At least one of I1–I4 wrong | **right** |

## What was wrong

`/api/session` authenticated, checked the content type, and answered **without
reading its body**, so server rows 2 and 4 held on `/api/resolve` and not on the
other route. Both now return 413 for an oversized body.

**The mutation pass is what made this legible.** The existing body-limit mutant
died — to `/api/resolve` — whatever `/api/session` did. A check that passes
because *some* route enforces a limit is not a check on the limit. A
route-distinguishing mutant now exists, and it survives the old suite: I1.

**The slow-upload deadline had never fired in a test.** `bodyReadTimeoutMs` was
configured and unexercised. It is a different mechanism from the stalled-header
case — `headersTimeout` is node's, enforced by a poller; this one is ours, in
`readBody` — so covering one said nothing about the other. Measured now: 408.

**And it leaked.** `readBody` rejected on its deadline while leaving the `data`
handler attached, so a slow sender kept spending memory after the request had
already been refused, which is most of what the deadline exists for. It now
pauses and detaches, and settles once.

## I4 was wrong, and the fix is a fourth option

`test/server.mjs` went from 10.6s to 15.9s, and sixteen of forty-eight mutants
declare it. The pass went **215s to 520s** — past the point where a mutation pass
gets run, which is the failure this project has already named more than once.

Three options were on the table: accept nine minutes; add a timeout option to
the product for testability; or exclude the slow pair from mutation. The first
loses the pass, the second puts a seam in shipped code for a test's benefit, and
the third is worst — the slow-body mutant would then be measured against a suite
that no longer contains its only oracle.

**Taken instead: split by COST, not by importance.** The two five-second
measurements move to `test/server-slow.mjs`, which runs in `npm test` like
anything else. The declared-suite mechanism already knows how to send the three
timeout mutants to the file that can kill them, so no check loses its oracle and
no value is weakened.

    test/server.mjs        15.9s -> 2.7s
    test/server-slow.mjs   13.5s, run once
    mutation pass          520s -> 238s

Nothing here is made fast by shortening a shipped timeout. That was considered
and rejected on evidence: the stalled-header case has already demonstrated once
that a timeout altered after `listen()` is silently not in effect, so a check
that appears to pass can prove nothing.

## One weakness in this sitting, recorded

The mutant *"the deadline fires but keeps consuming"* is marked `uncovered`, and
it does survive — nothing in the suite can observe continued consumption after a
refusal. But **I chose that category before running it** rather than predicting
the outcome and recording what happened. The result is honest; the method was
weaker than the rest of this sitting, and the difference is exactly the one the
pre-registration rule exists to preserve.

## Still open

- Header validation is narrower than `node:http`. Needs a decision, not a fix:
  it means claiming transport behaviour in a release with no transport.
- Duplicate JSON members are silently last-wins; variable names are not checked
  against the reference charset; a stray `}}` is accepted as literal.
- Three UI-behaviour mutants remain `uncovered`; the UI's behavioural
  correctness still rests on a browser sitting run by hand.
