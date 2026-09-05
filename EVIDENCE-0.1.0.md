# 0.1.0 — evidence

**Run 2026-09-05.** Predictions frozen in `PREREGISTRATION-0.1.0.md` and
`SITTING-A-PREREGISTRATION.md`, both committed before the code they describe was
written.

    Node v22.22.2 · Linux
    Browser: Chromium (playwright-core build 1194)
    selftest  129/129
    ui         12/12
    parity      7/7   byte-identical
    server     50/50
    mutation   22/22  accounted for, one of them an expected equivalent
    sitting A  9/10   predictions held on the second run; see B3

---

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| P1 | `new URL()` accepts a literal `{{host}}` in the host position | **right** — parses; "does it parse" cannot detect an unresolved reference |
| P2 | Braces encode in a path, pass through in a query | **right** — `%7B%7Bx%7D%7D` vs unchanged |
| P3 | Identical name **and** value survive as two header entries | **right** |
| P4 | No secret in any reqtrail-generated output | **right** — human render, `--json`, warnings, errors, and the loopback API |
| P5 | An unresolved reference exits 1 and still prints a parseable payload | **right** |
| P6 | Node's default timeouts are too permissive; ours must do the work | **right**, and it understated the problem — see below |
| P7 | An oversized header block is rejected with a status, not a bare reset | **right** — 431 before any handler runs |
| P8 | A foreign `Host` reaches our handler; the rebinding defence must be ours | **right** |
| P9 | `Origin` absent on navigation, present on `fetch` | **half wrong** — reached in sitting A as B2 and B3; see B3 |
| P10 | **The first parity run fails** | **right** |
| P11 | The shipped bundle contains no `dangerouslySetInnerHTML` | **WRONG** — it contains one |
| P12 | At least two of P1–P11 wrong | **right** — two, counting P9's failed half |

---

## P11 was wrong, and the pre-registration is why that was useful

The prediction named its own consequence: *if the string appears, the bundle grep
is void as a check and only the source check is valid.* It appears — react-dom
implements the property and names it, so **a grep of the shipped bundle can
never pass.**

Written the other way round, this would have gone badly. The natural order is to
write the check, see it fail, decide it is noisy, and drop it — leaving the
prohibition untested while the commit message says it is tested. Deciding what a
failure would mean before running it is the only reason that did not happen.

**What ships instead:** a bundle of `src/ui` alone with react and react-dom
external. It covers every current and future UI file without depending on anyone
remembering to add one, and react's internals cannot mask a real use. A planted
use is compiled in the same test to show the check can fail. The shipped-bundle
grep is kept, **asserted in the opposite direction**, so that if react ever stops
naming the property this file says so rather than silently acquiring a check that
means nothing.

## P10 was right, and what the first parity run found

Two fixtures disagreed, on every masked secret. The cause was not the adapters:
**the harness gave them different environments** — the CLI subprocess had
`API_TOKEN`, the server read the test process's own. The environment is part of
the input to a parity comparison, and the comparison was not being given one
input.

That is the slice-0 near-miss again — the harness rather than the target being
the thing that differs — and it is the second time on this project that the
first reading was a property of the measurement.

It also found something real. The server adapter was reading `process.env`
**inside a request handler**, which is precisely the "configuration read from
process state" that SPEC lists among the terminal assumptions a core acquires
when a second interface is deferred. The environment is now captured once per
session and passed in. A parity test written last would have found neither.

## P6 was right and understated

`requestTimeout` and `headersTimeout` were set to 10s and 5s. They are enforced
by a poller whose default interval is **30 seconds**, so a 5-second header
timeout without `connectionsCheckingInterval` buys a timeout that fires up to
thirty seconds late. Setting the two documented properties is the obvious half of
rows 3 and 4 and is not the whole row.

**A false pass was nearly recorded here.** The first probe of the stalled-header
case appeared to succeed — the socket closed at 1004ms with a 408. It was not
reproducible: `headersTimeout` mutated **after** `listen()` is not picked up by
the connection tracker, so the check was passing for a reason unrelated to what
it claimed to test, and only intermittently. The check now uses the shipped
values and takes five seconds. Measured: closed at 5006ms with a 408.

Same lesson as slice 0's, arriving from the third direction now: *check every
component that touches the artifact.* Here the component was the test's own
attempt to be fast.

---

## Mutation coverage

22 mutants, each a single edit breaking a stated contract. 21 killed.

**One survivor, and it is equivalent.** Removing
`if (outer + produced + suffix !== href) continue;` from `src/core/url.js`
changed nothing. It cannot fire: `produced` is sliced out of `href` between an
offset proved by `startsWith(outer)` and one proved by `endsWith(suffix)`, with
a length guard ensuring the first does not pass the second, so the three pieces
concatenate to `href` for every input.

The comment above that line called it **"the whole guarantee"**, which was
wrong — the guarantee is carried by the two preceding guards. The comment is
corrected and the mutant is now recorded as an expected equivalent, asserted in
that direction: a run in which it **dies** fails, because that would mean the
equivalence argument no longer holds.

---

## Sitting A — the browser pass

Predictions in `SITTING-A-PREREGISTRATION.md`. Two runs are recorded because the
first changed the design.

### B3 was wrong, and it was a security finding

> B3 — `Origin` is present and exactly `http://127.0.0.1:PORT` on every `fetch`
> the application makes.

**Observed on the first run:** two API calls, origins `[null, "http://127.0.0.1:PORT"]`.

Chromium sends **no `Origin` header on a same-origin GET**. `GET /api/session`
therefore arrived without one — and the server, which had to allow an absent
`Origin` for top-level navigations, allowed it. **The Origin check on that
endpoint was vacuous.** It looked like a defence, tested green from a Node
client, and protected nothing.

**Two changes, both applied:**

- The API is **POST only**, including the read-only session endpoint, so a
  browser always attaches `Origin`. The verb is a security property here, not a
  REST opinion.
- On `/api/*`, `Origin` must be **present and exact**; absent is refused. Static
  routes still permit an absent `Origin`, because a navigation has none — B2,
  measured right — and there is nothing to read there.

**Second run: B3 right**, two API calls, one origin, exact.

This is the row 4 half that a Node client cannot reach: node's `fetch` sends no
`Origin` at all, so from Node the endpoint was indistinguishable from a working
one. Asserting the browser's behaviour from a client that cannot exhibit it is
the slice-0 receiver mistake, and this is what it would have cost.

### The rest

| # | Result |
| --- | --- |
| B1 | **right** — the request block and all four provenance rows render, no page errors |
| B2 | **right** — `Origin` absent on the navigation to `GET /` |
| B4 | **right** — `http://localhost:PORT/` refused with `bad-host`; the application does not load |
| B5 | **right** — a page on another origin cannot read `/api/session`; the fetch rejects and the server logged the foreign origin |
| B6 | **right** — no secret anywhere in the DOM |
| B7 | **right** — `document.cookie` empty, cookie jar empty |
| B8 | **right** — token removed from the address bar; a reload without it fails to authenticate |
| B9 | **right** — an injected inline script is blocked by the CSP |
| B10 | **right on run 1, wrong on run 2** |

**B10 recorded honestly.** It predicted at least one of B1–B9 would be wrong.
On the first run one was, which is what the prediction was for: it establishes
that the harness can fail. On the second run, after the fix, none was — so B10
is wrong on that run. The second run is not independent evidence that the
predictions were good; it is evidence that a known defect was fixed.

**What B4 does not establish.** True DNS rebinding cannot be staged locally.
What was staged is its endgame: a request the browser considers same-origin
carrying a `Host` the server does not accept. The browser's own view during
rebinding is not reproduced and is not claimed.

---

## What this does and does not establish

**Established.** The prepared request, the provenance, and every refusal behave
as SPEC specifies; the CLI and the loopback server produce byte-identical output
from the same input; no resolved secret exists on the display side at all,
because 0.1.0 has no transport and therefore no `materialize()`; the seven UI
security rows hold against both a hand-written socket and a real browser.

**Not established.** That the prepared request matches a captured one — that is
slice 0's result, not this release's, and 0.1.0 has no transport with which to
reproduce it. That anyone wants this. Slice 0 said the claim is true; nothing
here says it is wanted, and no further specification will.
