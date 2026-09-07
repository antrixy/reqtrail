# The request boundary — pre-registration

**Written before the change and before it was run. Section 4 is frozen.**
Baseline `3d8add5d7798fd20f86e1ba8cdbd7e62f052ba3f`, tag `v0.1.0`, tree sha256
`b0758f8e77600825f8ed7f58a57f62af0c367fe7c0ca2830d23a9963bc652258`.

Scope ruled in `decisions.md`, *reqtrail 0.2.0 — the boundary work*, 2026-09-07:
**0.2.0 is the boundary, not the send.** Items 1, 2 and 4 of the eleventh
external input's architectural remainder. Item 3, the transport adapter, is
0.3.0 and **no transport code is written in this sitting.**

## 1. The divergence

`src/core/prepare.js:209` returns a single object whose `prepared` field is a
**masked view**:

    prepared: {
      method: request.method,
      url: urlView.display,                                   // masked
      headers: headerSegs.map((h) => ({ name: h.name, value: masked(h.segs) })),
    }

Every consumer reads it: `src/cli/render.js:19-20`, `src/ui/logic.js:37`, the
server. **It is safe to render and it cannot be sent** — sending it would
transmit `MASK` where a token belongs.

`grammar.js:99` already has `plain(segs)`, the unmasked counterpart, used by
`url.js` for probe construction and span attribution. **So both halves of the
split already exist as helpers. Neither is a first-class object, and only the
masked one has a name.**

That is the trap. A future `run()` needs unmasked bytes, finds only `prepared`,
and the cheapest available move is to build a second request for sending. **Two
construction paths falsify the claim**: `SPEC.md` states that a `resolve` which
builds its own view *can be right in every test and wrong on the one request
that matters, and that failure is invisible because both halves look correct in
isolation.*

## 2. The change, stated as a property of OUTPUTS rather than of modules

**This project has stated this boundary wrongly twice, and both times the error
was the same shape** — an absolute about which MODULES touch secrets:

    first:   no plaintext is materialised on the display side at all
    second:  plaintext exists in exactly one place — src/core/url.js
    measured: eight sites across three modules read env[key]

The tenth external input's third lesson is the correction: state guarantees as
properties of the outputs, which a suite can falsify, not as module lists, which
it cannot. **A third module-shaped absolute here would be the same defect a
third time**, in the release whose entire purpose is this boundary.

So the property, and it is the release's pass condition:

> **P-CONTAIN.** For every fixture carrying a secret, no public result, protocol
> response, renderer output, log line or general-purpose error contains the
> secret bytes.
>
> **P-DERIVE.** The public projection is a pure function of the private exact
> request. For every fixture, `project(exact)` deep-equals the public view the
> API returns. There is no input from which a consumer can obtain a public view
> that `project` would not produce from that same exact request.

P-CONTAIN is what `test/leak-audit.mjs` already measures across 28 fixtures.
**P-DERIVE is new and is the actual boundary claim** — it is what makes "one
construction path" checkable rather than asserted. Two objects with a derivation
between them is testable; "we only build it once" is a habit.

## 3. What this sitting does, in order

**Item 4 first.** `prepared` is renamed. Until it is, every subsequent line is
written against a name that makes the wrong thing look correct at the call site.

Then items 1 and 2: an exact request as a first-class private value, the public
projection derived from it by one function, and `inspect` expressed as a
consumer of that pair rather than as the thing that produces the view.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| B1 | The rename touches at least four files outside `core/` — `cli/render.js`, `ui/logic.js`, `server/server.js` and at least one test | high | three or fewer |
| B2 | A check can express P-DERIVE against every existing fixture without a new fixture corpus | medium-high | it needs new fixtures to say anything |
| B3 | A mutant that builds the public view independently of the exact request — same output, second path — **survives** unless P-DERIVE is written as a derivation check rather than an equality-of-values check | medium | it dies against a values check |
| B4 | `leak-audit` stays at 0 of 28 with no change to its fixtures. The split moves secrets around inside `core/`; it does not add a public surface | high | any fixture leaks |
| B5 | At least one of the eight `env[key]` read sites moves into the exact-request construction and stops being a separate read | medium | all eight stay where they are |
| B6 | The suite grows by 4–10 checks, and the `EVIDENCE-0.1.0.md` count guard fires at least once because the number was not regenerated | medium-high | growth outside that range, or the guard never fires |
| B7 | No transport code is written, and `node:http`/`node:https` imports are unchanged from baseline | high | any transport import changes |
| B8 | The renamed object's name will be wrong on the first attempt — chosen before the derivation is built, then found to describe the old shape | low-medium | the first name survives the sitting |

**B9, the meta-prediction: at least one of B1–B8 is wrong.**

**Confidence: low, and stated with its record.** This meta-prediction has been
wrong five sittings running, always by overestimating the error rate. It is kept
because dropping a prediction that keeps being wrong in the same direction would
discard the calibration evidence, which is the more useful result. If it is
wrong a sixth time, the honest conclusion is that the meta-prediction as
formulated measures nothing and should be replaced rather than repeated.

## 5. Explicitly NOT in this change

- **Any transport code.** No `run`, no `node:https`, no adapter. The constraint
  is recorded twice and is the reason for the release boundary.
- **The slice-0 differential rig.** It measured through a lossy adapter — the
  harness converted the ordered header array to an object before `node:http`
  saw it. Rebuilding it is 0.3.0's work and needs its own pre-registration.
- **The two carried mutation gaps**, both marked `uncovered` with arguments
  attached: the UI component's wiring to its extracted decisions, which needs a
  browser, and continued consumption after a 413, which nothing in the suite can
  observe.
- **Publishing.** 0.1.0 is on npm with provenance. The npm gate creates users
  who could be harmed by a defect; spending it on an internal boundary change
  buys nothing.

## 6. What would stop this release

- **P-DERIVE cannot be expressed without a transport consumer to check the
  exact request against.** Then the projection is unfalsifiable with nothing
  sending, item 3 has to move forward, and the 2026-09-07 ruling is wrong. This
  is revisit trigger 1 in `decisions.md` and it is the outcome that matters most
  — **record it and stop, rather than reaching for transport code mid-sitting.**
- **The work exceeds roughly two weeks.** Cut scope, do not re-estimate. Cut
  item 2 before cutting a verification row; items 4 and 1 are the release.
