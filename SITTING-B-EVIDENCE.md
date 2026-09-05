# Sitting B — evidence

**Run 2026-09-05, Node v22.22.2, Chromium (playwright build 1194).**
Predictions frozen in `SITTING-B-PREREGISTRATION.md`. Baseline `b7bcabf`.

    14/16 predictions held    sitting exit 0
    F7 NOT REACHED            F8 wrong

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| F1 | A grammar refusal renders code, path and cause, zero page errors | **right** |
| F2 | An unknown `--request` id renders the same way, listing the ids | **WRONG** first run |
| F3 | An empty request list says so | **right** |
| F4 | `ui --request b` preselects `b` | **right** |
| F5 | A bad schema at startup exits 1 with a named refusal | **right** |
| F6 | No secret in the DOM on a refusal path | **right** |
| F7 | The stale-response race can be provoked in a browser | **NOT REACHED** |
| F8 | At least two of F1–F7 wrong | **WRONG** — one was |

## F2 was wrong, and it found a second divergence

`ui --request no-such-id` did not refuse. The UI looked the id up in the session
list, failed to find it, and **fell back to the first request** — showing a
different request from the one asked for, with nothing on screen saying so.

That is the failure this product exists to prevent, committed by the product.
The CLI refuses with `selection.unknown` and lists the available ids; the UI
quietly substituted.

Fixed by selecting the requested id **whether or not it exists**, and letting
the core refuse. The authority is the core, and the UI's job is to show what it
says. Second run: the refusal renders, naming the id and the available ones.

Worth noting how it was found: the fix for the *first* divergence — `--request`
being parsed and dropped — introduced the second. Honouring a flag is not the
same as honouring it correctly, and only the fixture asking for a bad id told
the difference.

## The bug that broke everything, and what it exposed

The first run of this sitting failed **six predictions including B1**, with the
page showing `internal error`. Cause: `createUiServer` gained a `requestId`
option, and `handle()` declares its own `const requestId` further down the same
function. A `const` shadows the entire function scope from the top, so reading
the outer one earlier threw a `ReferenceError` from the temporal dead zone.

**It presented as a blank 500 with no explanation**, because server protection
row 8 returns no stack trace to the browser — correctly. But the row says do not
return stack traces *to the page*; it does not say the person running the
process should be kept in the dark, and the `catch` was discarding the error
entirely.

Changed: the stack is written to **this process's stderr**, which is the terminal
the user started `reqtrail ui` in and is not a channel the page can read. Row 8
holds; the operator gets the diagnosis. The row was being over-applied, and it
cost an hour to notice.

## F7 — recorded as NOT REACHED, not as a fix

The sequence guard is implemented and is correct. But provoking the race
requires control over response arrival order, which a browser driving the real
server does not have. **This sitting has not earned the right to say the defect
was real**, so it is recorded as not reached rather than counted among the
repairs. The guard stays; the claim does not.

## F8 — wrong, and this is the second sitting in a row

Predicted at least two of F1–F7 wrong; one was. The previous sitting's E6 was
wrong the same way. Two consecutive meta-predictions overestimating the error
rate is itself a signal: either the work is genuinely converging, or the
predictions are being made about changes small enough that little can surprise.

The evidence for the first reading is F2 and the temporal-dead-zone bug — both
were real, both were found by fixtures rather than by review, and one broke six
predictions at once. **The gate repaired in the previous sitting is what caught
them**: under the old gate, which tripped only on B4–B7, this sitting's first run
would have exited 0 with six wrong predictions and a blank page.

## What changed

**Product**

- The UI renders a refusal: code, field path, cause. It previously read
  `result.prepared.method` on an error document and rendered nothing at all.
- `ui --request` is honoured, and an unknown id refuses rather than substituting.
- A refusal at `ui` startup goes through the CLI refusal handler instead of
  `internal error — this is a bug`.
- `row.note` (attribution undetermined) is rendered; the UI previously showed
  the value as though it had been attributed.
- An empty request list says so.
- A monotonic sequence guard on selection, so the last selection wins rather
  than the last response to arrive.
- The server logs internal errors to its own stderr.

**Decision recorded:** a core refusal stays **HTTP 200 with an `error`
document**. The client asked "resolve this"; the answer "it refuses, here is
where and why" is a successful call with a result. Non-2xx is reserved for
transport and authorization, so `res.ok` means one thing. Same argument as
SPEC's *a 4xx exits 0* in the CLI, one layer up.

**Instruments**

- Sitting A gains F1–F7. It measured only workspaces that resolve, which is why
  a blank page on every refusal survived it.
- `test/leak-audit.mjs` no longer reports the DOM as NOT REACHED — it is now
  measured as F6, and the file says where rather than leaving a stale caveat.

Suite: refusals 33/33 · selftest 134/134 · leak 0 of 26 · ui 12/12 · parity 7/7 ·
server 50/50 · mutation 28/28.

## Still open

- **No mutant is aimed at the UI.** Mutation covers the core and the CLI
  adapter. The refusal rendering, the sequence guard and the unknown-id
  behaviour are checked by the sitting only, and a sitting is not run on every
  commit.
- F7 remains unproven.
