# Testable UI decisions — pre-registration

**Written before the change and before it was run.** Section 3 is frozen.
Baseline `45e7f4d`.

## 1. The gap, in my own record rather than the review's

Three UI mutants are marked `uncovered` and survive `npm test`:

- a refusal is rendered as a crash again;
- an unknown `--request` silently falls back to the first request;
- the sequence guard is removed.

**Every defect sitting B fixed can be reintroduced and the suite stays green.**
The only oracle is a browser sitting run by hand, and F7 — whether the stale
response race is real — is still NOT REACHED, because a browser driving the real
server cannot control response arrival order.

## 2. The change

All three are **decisions**, not rendering: which request to select given a
session, whether a response is a result or a refusal, and which of several
in-flight responses may be applied. None needs a DOM.

They move to `src/ui/logic.js`, a module with no React import, and the component
calls them. This is the core/adapter argument one level down: the UI adapter
should own rendering, and a decision that a CLI would have to make identically
does not belong inside a component where only a browser can reach it.

**F7 becomes reachable as a consequence.** Applying responses out of order is
trivial against a pure reducer and impossible against a real server, so the
question the browser could not answer gets answered here.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| L1 | All three `uncovered` mutants become killable, retargeted at the extracted functions | medium-high | any stays uncovered |
| L2 | F7 moves from NOT REACHED to **measured, and the race is real** — a stale response wins without the guard | medium-high | it cannot be provoked even here |
| L3 | Sitting B's predictions still hold unchanged after the extraction | high | any moves |
| L4 | At least one of the three does **not** extract cleanly and needs a judgement | medium | all three are pure |
| L5 | At least two of L1–L4 wrong | medium | fewer than two |

### On L4

"It is just a pure function" is the kind of thing that is true until the second
one. The selection decision reads a session document; the dispatch decision
reads a response that may be `null` on a parse failure; the sequence guard is
inherently stateful. Predicting that one resists is cheaper than discovering it
mid-extraction and bending the design to keep the claim.

## 4. Recording

    L1-L4: right / wrong, with what was observed
    L5:    how many wrong
    Whether the race is real, stated either way
