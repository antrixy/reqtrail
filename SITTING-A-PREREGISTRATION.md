# Sitting A — browser pass on the 0.1.0 UI

**Written before the harness was written and before anything was run in a
browser.** Section 3 is frozen.

The 0.1.0 test suite asserts the UI security rows from a Node client. A Node
client sends no `Origin`, stores no cookies, and enforces no same-origin policy,
so three of the seven rows are only half-tested by it — and a green result from
a client that cannot exhibit the behaviour under test is the slice-0 receiver
mistake wearing different clothes. This sitting is the other half.

It is also the first time the React application is loaded by a browser at all.

## 1. What this sitting decides

- **P9 from `SLICE-0-PREREGISTRATION.md`, restated for 0.1.0**: whether `Origin`
  is absent on a top-level navigation and present on the application's `fetch`.
  P9's original subject was `--as-curl` parity, which is cut from v0; the
  Origin half is what remains reachable and it is what rows 4 and 5 rest on.
- Whether the **rebinding endgame** is actually refused by a real browser making
  a real request, rather than by a hand-written socket.
- Whether the application renders, and whether anything leaks into the DOM.

**It does not decide** whether the UI is usable. That is the Usability stage
question and needs a person who is not the author.

## 2. Setup

    npm install --no-save playwright-core
    node test/sitting-browser.mjs

Chromium only. Not part of `npm test`: it needs a browser that the package does
not depend on, and a sitting is run deliberately, not on every commit.

**The rebinding simulation, and its limit.** True DNS rebinding cannot be staged
locally. What can be staged is its endgame: `localhost` and `127.0.0.1` both
resolve to the loopback interface, so navigating a browser to
`http://localhost:PORT/` produces exactly what a rebound request produces at the
server — a request the browser considers same-origin, carrying a `Host` header
that is not `127.0.0.1:PORT`. That is the condition the Host check exists to
catch, and it is reachable. **What is NOT reproduced is the browser's own view
during rebinding**; this sitting does not claim to test that.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| B1 | The application renders: the prepared request block and the substitutions table both appear | medium-high | either is absent, or the page errors |
| B2 | `Origin` is **absent** on the top-level navigation to `GET /` | high | it is present |
| B3 | `Origin` is **present and exactly** `http://127.0.0.1:PORT` on every `fetch` the application makes | high | absent, or any other value |
| B4 | Navigating to `http://localhost:PORT/` is refused with `bad-host`, and the application does not load | high | anything renders |
| B5 | A page served from a different origin cannot read `/api/session`: the fetch rejects in the page **and** the server refuses it | high | the page obtains a body |
| B6 | No resolved secret appears anywhere in the rendered DOM | high | it appears |
| B7 | `document.cookie` is empty — the session token is not a cookie and nothing sets one | high | any cookie exists |
| B8 | The token is removed from the address bar after load, and reloading the page without it fails to authenticate | medium | the token remains, or a reload still works |
| B9 | The Content-Security-Policy blocks an injected inline script | medium | it executes |
| B10 | At least one of B1–B9 will be wrong | medium | none is |

### Why B10 is here

Four of the ten above are high-confidence assertions about code written this
week by the person predicting them. Sitting E on the previous project ran
thirteen predictions and got twelve right, which is the profile of predictions
made about one's own recent work. If all nine come back right, the more likely
explanation is that the harness is agreeing with itself — **check that the
harness can fail before believing it**, exactly as with the first parity run.

## 4. Recording

    Date / browser build / OS
    B1-B9: right / wrong / not reached, each with what was observed
    B10:   how many were wrong
    Anything unpredicted

Wrong predictions keep their original wording.
