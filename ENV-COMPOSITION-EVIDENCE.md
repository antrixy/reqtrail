# The environment is captured once — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`ENV-COMPOSITION-PREREGISTRATION.md`. Baseline `51e3c4c`.

    selftest   157 -> 159      mutants  60 -> 61, 221s
    suite      green

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| N1 | `server.js` contains zero `process.env` references | **right** |
| N2 | No existing check breaks | **right** |
| N3 | A mutant reintroducing the ambient read dies | **right** |
| N4 | The check needs comment stripping — the fifth mention-versus-use collision | **WRONG** |
| N5 | At least one of N1–N4 wrong | **right** — one |

## What changed

The environment is captured **once**, at the CLI composition root, and passed to
every consumer. `src/server/server.js` no longer reads ambient process state for
configuration at all.

    before   main.js    env: io.env ?? process.env      (resolve only)
             server.js  env: { ...process.env }         (ui, ignoring the CLI's)
    after    main.js    const env = io.env ?? process.env   — once
             server.js  env is a parameter

Not a production failure: in ordinary execution both resolved to the same
object. But it is the **same ambient-state class as the very first parity
failure**, where the server read `process.env` inside a request handler while
the CLI subprocess had been given one explicitly. That was fixed at the request
level and left standing one layer up, in composition — which is the shape of a
fix applied where the symptom appeared rather than where the defect lived.

**Stated as a property, not a patch:** *`src/server/server.js` contains no
reference to `process.env`.* Two checks enforce it — zero references in the
server, exactly one in the CLI — and both were demonstrated able to fail by
reintroducing the read. A composition root is testable; "remember to pass it" is
a habit, and this project has twice had to replace a habit with a mechanism.

End to end, from the CLI: `ui` resolves against the injected environment, masks
the secret, and leaks nothing.

## N4 was wrong, and the reason is worth a line

It predicted the fifth mention-versus-use collision: that a comment naming
`process.env` would trip the very grep checking for it. **The comment says
"AMBIENT PROCESS STATE" instead**, so the raw source contains zero occurrences
and stripping was never exercised.

The stripping stays. It costs nothing, `stripComments` already existed for the
transport check, and the next comment on this subject is likelier than not to use
the literal string — the four previous collisions were all written by someone who
did not expect to collide either.

## The evidence guard fired, second time in two sittings

Adding two checks moved the suite from 157 to 159, and the check that reads
`EVIDENCE-0.1.0.md` failed until the document was updated:

    EVIDENCE-0.1.0.md quotes this suite's actual count: EVIDENCE says 157/157,
    suite runs 159

That is the drift class closed. The document cannot silently fall behind the
suite again, and the cost is remembering to regenerate a number — which the suite
now enforces rather than requesting.

## Closed

**This was the last open item from the eleventh external input** that was not
architectural. What remains from that review is the 0.2.0 boundary work: the
private exact request and public safe projection, shared `inspect`/`run` use
cases, a transport adapter taking a raw ordered header array, and renaming
`prepared` — which as it stands invites the second construction path the claim
forbids. Its own sitting, with its own pre-registration, before any transport
code exists.
