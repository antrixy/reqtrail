# Body limits on every route — pre-registration

**Written before the change and before it was run.** Section 3 is frozen.
Baseline `816139e`.

## 1. What is wrong

`/api/session` authenticates, checks the content type, and answers **without
reading the body**. Measured at `bc534d2`:

    /api/session   body=131082B  limit=65536B  ->  200
    /api/resolve   body=131082B  limit=65536B  ->  413

So server row 2 (maximum JSON body size) and row 4 (slow-upload deadline) hold
on one route and not the other. Authentication bounds the exposure, but the rows
are stated for the server and are true of half of it.

**The mutation pass made this sharper.** The mutant that removes the body-size
limit is killed — by `/api/resolve`. The row is covered on one route, uncovered
on the other, and no mutant distinguishes them. A check that passes because
*some* route enforces a limit is not a check on the limit.

Separately: **the slow-upload deadline has never been tested at all.**
`LIMITS.bodyReadTimeoutMs` is set to 5s and no check reads it. The stalled-header
case is covered; the stalled-body case is not, and they are different code paths
— `headersTimeout` is node's, `bodyReadTimeoutMs` is ours.

And the timeout path does not stop consuming: `readBody` rejects on its deadline
while leaving the `data` handler attached.

## 2. Scope

Every body-bearing route through the same bounded reader, even where the
expected body is `{}`. A route-distinguishing mutant. A slow-body check using
the shipped value.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| I1 | A mutant removing the limit **from `/api/session` alone survives** the current suite | high | it dies |
| I2 | The slow-upload deadline works as configured once tested — 408 within about 5s | medium-high | no response, or a different code |
| I3 | Routing `/api/session` through the reader changes no other result — parity, selftest and the leak audit are untouched | high | any moves |
| I4 | The mutation pass grows by **under 90 seconds**, since only server mutants pay the new check's cost | medium | more |
| I5 | At least one of I1–I4 wrong | medium | none is |

### On I2

The deadline has never fired in a test. Code that has never run is not known to
work, and "it is configured" is the same class of claim as "the row has a
check" — which the last two sittings both found to be worth less than it looks.

## 4. Recording

    I1-I4: right / wrong, with figures
    I5:    how many wrong
    Whether the slow-body path leaks a listener or keeps consuming after the
    deadline, stated either way
