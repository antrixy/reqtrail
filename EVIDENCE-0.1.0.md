# 0.1.0 — evidence

**Regenerated 2026-09-05 from a run against commit `490fee1`, fetched as a
sha-pinned archive rather than read from a working tree.**

This replaces the version written on 2026-09-05 before an external review. That
one reported 129 checks against a suite that runs 155, and its central claim was
false: **P4 was falsified.** It carried a correction block saying so, which is
the wrong shape for a document a stranger reads first to decide whether the
release's claims are backed. Regenerated rather than edited, so every figure
below comes from one run. **The original predictions keep their wording**; only
their outcomes are added.

    node v22.22.2 · Linux · Chromium (playwright build 1194)

    refusals      37/37 carry a literal message
    selftest     157/157
    leak audit     0 of 28 fixtures leak
    ui            26/26
    parity         7/7 byte-identical
    server        51/51
    server-slow    2/2  (shipped timeout values)
    mutation      58/58 accounted for — 55 killed, 1 equivalent, 2 uncovered, 219s
    sitting A     14/16 predictions held, exit 0
    tarball       106.0 kB, 30 files, zero runtime dependencies

---

## 1. The 0.1.0 predictions

Frozen in `PREREGISTRATION-0.1.0.md` before the code they describe was written.

| # | Prediction | Result |
| --- | --- | --- |
| P1 | `new URL()` accepts a literal `{{host}}` in the host position | **right** |
| P2 | Braces encode in a path, pass through in a query | **right** |
| P3 | Identical name **and** value survive as two header entries | **right** |
| P4 | No secret in any reqtrail-generated output | **WRONG — see §2** |
| P5 | An unresolved reference exits 1 and still prints a parseable payload | **right** |
| P6 | Node's default timeouts are too permissive; ours must do the work | **right**, and it understated the problem |
| P7 | An oversized header block is rejected with a status, not a bare reset | **right** — 431 |
| P8 | A foreign `Host` reaches our handler; the rebinding defence must be ours | **right** |
| P9 | `Origin` absent on navigation, present on `fetch` | **half wrong** — see §2 |
| P10 | **The first parity run fails** | **right** |
| P11 | The shipped bundle contains no `dangerouslySetInnerHTML` | **WRONG** |
| P12 | At least two of P1–P11 wrong | **right** — three, counting P9's half |

## 2. P4 was falsified, and that is the most important line in this file

**As written:** *for a resolved secret of ≥8 characters, no reqtrail-generated
output contains it as a substring — human render, `--json`, warnings, errors.*

It was checked against a fixed set of fixtures in which the secret was always
well-formed, so it exercised the success path and reported a property. **Three
refusal paths disclosed the resolved secret**, on four channels each including
the loopback API — which also broke a named UI security row, since secrets are
not to cross that boundary in plaintext.

The root cause was not an oversight. `src/core/url.js` must materialise a secret,
because normalization has to see real bytes to report that a query-string key was
re-encoded. That exception was understood and written down inside the module —
and then `parse()` interpolated the materialised string into a refusal, and it
left. Meanwhile `src/core/prepare.js` and the README both said no code path
resolved a secret at all. **Two artifacts of my own, neither citing the other,
describing incompatible designs.**

Fixed by making refusals carry values as named fields with escaping at a single
chokepoint. `test/leak-audit.mjs` drives marked values through every refusal and
every channel and now reports **0 of 28**. Re-measured on this artifact:

    reqtrail: url: "https://••••/" is not a valid absolute URL [url.invalid]
    leak present: 0

Full account in `LEAK-AUDIT-EVIDENCE.md` and `LEAK-FIX-EVIDENCE.md`.

## 3. P9 and P11, both instructive

**P9 — half wrong, and the half that failed was a security hole.** `Origin` is
absent on a top-level navigation, as predicted. It is **also absent on a
same-origin GET**, which the prediction did not anticipate: Chromium sends none.
The Origin check on `GET /api/session` therefore permitted an absent header and
protected nothing. Measured in a browser; a Node client cannot see it, because
node's `fetch` sends no `Origin` either and the endpoint tested green. The API is
now POST-only with `Origin` required and exact.

**P11 — wrong, and its falsification clause is why that was useful.** It named
its own consequence: *if the string appears, the bundle grep is void as a check
and only the source check is valid.* It appears — react-dom implements the
property and names it. What ships instead is a bundle of `src/ui` alone with
react external, which no comment can fool, plus a planted use proving the check
can fail. The shipped-bundle grep is kept **asserted in the opposite direction**,
so that if react ever stops naming the property this file says so rather than
silently acquiring a check that means nothing.

**P10 — right, and the first parity run found two things.** The harness gave the
two adapters different environments; and the server adapter was reading
`process.env` inside a request handler, which is the "configuration read from
process state" SPEC lists among the terminal assumptions a core acquires when a
second interface is deferred. A parity test written last would have found neither.

**P6 — right and understated.** `requestTimeout` and `headersTimeout` are
enforced by a poller whose default interval is 30 seconds, so setting a 5-second
header timeout without `connectionsCheckingInterval` buys a timeout that fires up
to thirty seconds late. A false pass was nearly recorded here: the first probe
appeared to succeed and was not reproducible, because a timeout mutated after
`listen()` is not picked up.

## 4. Slice 0 still reproduces from this artifact

Run from `slice0/` at this commit:

    predictions falsified: P4, P8      matches SLICE-0-EVIDENCE.md: true
    sent 9, all display == capture: true
    refused 7, any refusal reached the wire: false

**But what slice 0 established is narrower than it claimed.** `slice0/run.mjs`
converts the ordered header array into a JavaScript object before handing it to
`node:http`, so the transport was measured through a lossy adapter. Measured on a
raw socket: the object form loses one of `X-Tag`/`x-tag`, joins duplicate
`Cookie` values with `; `, and reorders numeric field names. The flat raw array
preserves all three.

The conclusion — `node:http`, not `fetch` — stands. **`run` must pass the raw
array and re-test against a capture**, and `node:https` is exercised by nothing.

## 5. The browser sitting

14 of 16 predictions held; the gate is exit 0.

B1–B9 cover rendering, `Origin` on navigation and on fetch, the rebinding
endgame refused by the `Host` check, a cross-origin page unable to read the API,
no secret in the DOM, no cookies, the token removed from the address bar, and the
CSP blocking an injected inline script. F1–F6 cover the refusal contract: a
grammar refusal and an unknown request id both render code, path and cause with
zero page errors, an empty workspace says so, `--request` is honoured, and **a
refusal carrying a secret puts nothing in the DOM** — the channel the leak audit
could not reach until the UI stopped rendering a blank page on every refusal.

**F7 is answered elsewhere, and says so.** The stale-response race could not be
provoked through a browser driving the real server. The decision now lives in
`src/ui/logic.js` and `test/ui.mjs` measures it: the race is real, and the guard
refuses the stale response.

**B10 is wrong on this run.** It predicted at least one of B1–B9 would be wrong;
none was. It was right on its first run, when it caught a real defect, and that
is what it is for — establishing that the harness can fail. A clean second run is
evidence a known defect was fixed, not that the predictions were good.

## 6. Mutation

58 mutants, 219 seconds. 55 killed, and three that must survive:

- **One equivalent.** A reconstruction check in `src/core/url.js` is a tautology
  given the two guards above it. The comment that used to call it "the whole
  guarantee" was wrong and is corrected. Asserted in that direction: a run in
  which it **dies** fails.
- **Two uncovered**, each with its argument attached. The component's wiring to
  the extracted UI decisions, which needs a browser; and continued consumption
  after a 413, which nothing in the suite can observe.

Marking them is the difference between a gap that is known and one that is merely
absent: if a browser check ever lands in CI, the harness reports the status
change rather than quietly gaining coverage nobody notices.

## 7. What this establishes, and what it does not

**Established on this artifact.** The prepared request, the provenance and every
refusal behave as SPEC specifies. The CLI and the loopback server produce
byte-identical output from the same input. No reqtrail-generated output discloses
a resolved secret on any of five channels, across 28 fixtures. Header values are
refused exactly where `node:http` refuses them, a set established by exhaustive
measurement. Duplicate object members are refused at any depth with the full
field path. The seventeen server and UI security rows hold against a hand-written
socket and a real browser. The tarball installs with zero runtime dependencies
and carries its third-party licence notices.

**Not established.** That the prepared request matches a captured one — that is
slice 0's result, qualified in §4, and 0.1.0 has no transport with which to
reproduce it. That the UI's wiring is correct, which rests on a sitting run by
hand. That anyone wants this. Slice 0 said the claim is true; nothing here says
it is wanted, and no further specification will.

## 8. Reproducing this

    curl -sSL https://codeload.github.com/antrixy/reqtrail/tar.gz/490fee10ee67b51581a34cb83ada9a0cac56d634 | tar xz
    npm ci && npm test
    npm run test:mutation

    npm install --no-save playwright-core
    node test/sitting-browser.mjs

**Two of the 157 selftest checks read this file**, comparing the count above
against the suite's own tripwire and confirming P4 is recorded as falsified. They
fired on their own introduction — adding them moved the count from 155 to 157 —
which is the drift they exist to catch, caught immediately. The figures above are
from the run made after they were added.

Every pre-registration in this repository was committed before the run it
describes. Wrong predictions keep their original wording; there are eleven of
them across nine sittings, and each is recorded with what it cost.
