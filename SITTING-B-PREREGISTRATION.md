# Sitting B — the UI refusal contract

**Written before any of the change was written and before anything was run in a
browser.** Section 4 is frozen. Baseline `b7bcabf`.

## 1. The defect

The loopback API returns a core refusal as HTTP 200 with an `{ error }` body.
The UI treats any 2xx as success, stores the error document as a result, and
then reads `result.prepared.method`. Measured in a real browser at `7ab1f60`:

    grammar refusal  pageErrors=1  "Cannot read properties of undefined (reading 'method')"
                     shows: ""
    invalid url      pageErrors=1  same
    empty requests   pageErrors=0  shows: an empty shell

**A blank white page on every refusal**, for a tool whose entire subject is
telling you why something will not be sent. Sitting A never saw it because every
fixture in it loads a workspace that resolves.

## 2. The decision this forces, taken deliberately

Should the API return 4xx for a core refusal? **No — 200 stays, and the UI
learns to read `error`.**

The reason is already recorded in SPEC: *a 4xx or 5xx exits 0* in the CLI,
because a response the user asked for is a successful send. The same argument
applies one layer up. The client asked "resolve this request"; the answer "it
refuses, here is the field path and the cause" is a **successful call with a
result**, not a failed call. Reserving non-2xx for transport and authorization
failures keeps `res.ok` meaning one thing.

The cost is that a client must look at the body to know it refused, which is
exactly what the CLI adapter does with its exit code and its payload.

## 3. Scope

- UI renders a refusal: code, field path and cause.
- `ui --request <id>` is honoured — it is currently parsed, passed, and dropped
  on the floor by `startUi`.
- A refusal at `ui` startup goes through the CLI refusal handler instead of
  escaping to `internal error — this is a bug`.
- `row.note` (attribution undetermined) is rendered; the CLI shows it and the UI
  silently shows the original value as though it were attributed.
- An empty request list says so.
- A sequence guard, so a slow response for an old selection cannot replace a
  newer one.
- **Refusal fixtures are added to sitting A.** This is what moves the leak
  audit's DOM channel from NOT REACHED to measured, for the first time.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| F1 | A grammar refusal renders code, path and cause, with **zero page errors** | medium-high | anything blank, or an error |
| F2 | An unknown `--request` id renders the same way, listing the available ids | medium-high | otherwise |
| F3 | An empty request list renders a message rather than an empty shell | high | a blank shell |
| F4 | `ui --request b` preselects `b` rather than the first request | high | it shows the first |
| F5 | A bad schema at startup exits 1 with a named refusal, not `internal error` | high | the internal-error path |
| F6 | **No secret appears in the DOM on a refusal path** — the channel the leak audit could not reach | medium-high | it appears |
| F7 | The sequence guard is genuinely needed: without it, a stale response can be made to overwrite a newer selection in a real browser | medium | the race cannot be provoked |
| F8 | At least two of F1–F7 wrong | medium | fewer than two |

### On F6

The leak audit records the DOM as NOT REACHED rather than clean, because the UI
rendered nothing on a refusal and an unreachable channel is not a clean one.
This sitting is the first opportunity to measure it. **If F6 is wrong, the leak
fix was incomplete and the audit said so in advance.**

### On F7

The race is easy to assert and hard to provoke. If it cannot be provoked in a
browser, the guard is still correct but this sitting has not earned the right to
say the defect was real — that should be recorded as NOT REACHED rather than
counted as a fix.

## 5. Recording

    F1-F7: right / wrong / not reached, each with what was observed
    F8:    how many were wrong
    The gate repaired in the previous sitting must fail this sitting if any
    non-meta prediction is wrong. If it does not, the gate is the finding.
