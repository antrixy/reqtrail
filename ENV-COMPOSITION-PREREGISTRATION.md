# The environment is captured once — pre-registration

**Written before the change and before it was run.** Section 3 is frozen.
Baseline `51e3c4c`.

## 1. The divergence

    src/cli/main.js:128     env: io.env ?? process.env      (resolve)
    src/server/server.js:342  env: { ...process.env }       (ui)

`resolve` takes an injected environment; `ui` reads ambient process state inside
the server module and ignores whatever the CLI was given. Not a production
failure — in ordinary execution both resolve to the same object — but it is the
**same ambient-state class as the very first parity failure**, where the server
read `process.env` inside a request handler while the CLI subprocess had been
given one explicitly. That was fixed at the request level and left standing one
layer up, in composition.

The eleventh external input flagged it. It is the last item from that review not
yet closed.

## 2. The change, and why it is stated as a property rather than a patch

Capture the environment **once, at the outermost CLI entry point**, and pass it
down. `startUi` takes `env` like every other consumer; `src/server/server.js`
stops reading ambient state entirely.

That gives a checkable property rather than a fixed line:

> **`src/server/server.js` contains no reference to `process.env`.**

A composition root that reads the environment once is testable; "remember to
pass it" is a habit, which is the distinction this project has already had to
make twice — for secret masking and for message escaping.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| N1 | After the change `server.js` contains zero `process.env` references, comments excluded | high | any remains |
| N2 | No existing check breaks | high | any breaks |
| N3 | A mutant reintroducing the ambient read dies | medium-high | it survives |
| N4 | The check must strip comments to pass, because the change is worth a comment naming `process.env` — **the fifth mention-versus-use collision** | medium | it passes without stripping |
| N5 | At least one of N1–N4 wrong | medium | none is |

### On N4

Four times now a grep aimed at a forbidden construct has fired on prose
describing it. Predicting the fifth before writing the check is cheaper than
discovering it and quietly rewording the comment to get green — which is the
failure mode, not the false positive.

## 4. Recording

    N1-N4: right / wrong, with what was observed
    N5:    how many wrong
    Anything the change touched beyond composition
