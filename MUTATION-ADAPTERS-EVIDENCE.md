# Mutation coverage of the adapters — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`MUTATION-ADAPTERS-PREREGISTRATION.md`. Baseline `bbba943`.

    mutants   28 -> 45
    outcome   45/45 accounted for — 41 killed, 1 equivalent, 3 uncovered
    runtime   215s

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| H1 | At least 2 new server mutants survive | **WRONG** — 1 did |
| H2 | At least one mutant killed by a suite other than the declared one | **right** — 7, and they found a harness defect |
| H3 | Every UI-behaviour mutant survives `npm test` | **WRONG** — 3 of 4 did |
| H4 | The declared-suite scheme keeps the pass under four minutes | **right** — 215s |
| H5 | At least two of H1–H4 wrong | **right** — two |

## The harness was counting a failing import as a kill

`test/ui.mjs` imports esbuild. Mutant directories are copied without
`node_modules` for speed, so **ui.mjs threw in every mutant directory**, and the
harness recorded the throw as a kill.

The consequence is worse than a false positive on one mutant. Any mutant that
survived every other suite reached ui.mjs last and was reported dead. The first
run said `44/45 accounted for`; the true figure was `41/45`, and **the mutant
asserted to be equivalent was reported as killed**, which read as "the
equivalence argument no longer holds" and would have sent the next reader after
a defect that did not exist.

Found because the declared-suite mechanism said a *server* mutant had been
killed by the *UI* suite — a sentence that made no sense on its face. Without
H2's middle outcome the run would have reported a clean sweep.

`node_modules` is now symlinked into each mutant directory. **A harness that
cannot tell a failing check from a failing import reports no survivors and means
nothing** — the fourth instrument defect on this project, and the fourth found by
a result that looked wrong rather than by review.

## H1 was wrong: the server rows are better covered than predicted

Twelve of thirteen new server mutants were killed by `test/server.mjs`: binding
every interface, skipping the token check, dropping the Host check, accepting an
absent `Origin`, emitting a CORS allowance, removing the header-count and
body-size limits, returning the enforcement interval to its 30-second default,
accepting any content type, skipping the method check, reading the body before
authenticating, and leaking the environment across the loopback boundary.

The prediction was that a suite written one-check-per-row would assert rows
existed rather than worked. Mostly it does work. Recorded because the prediction
was made in the other direction.

**The one survivor is real and is not fixable behaviourally.** Replacing
`timingSafeEqual` with `===` passes every check: a wrong token is rejected either
way. A constant-time comparison has no behavioural signature this suite can
observe.

Added a **source-level** check, labelled as one: the code reaches for the
constant-time primitive rather than `===`. It does not establish that the
comparison is timing-safe in fact, and the check says so at the call site.

## H3 was wrong, but read the way it was wrong

Three of four UI mutants survived: re-crashing on a refusal, silently falling
back to the first request on an unknown `--request`, and removing the sequence
guard. **Every defect sitting B fixed can be reintroduced and `npm test` stays
green.**

The fourth — leaving the session token in the address bar — died, but to a
**source grep** in `test/ui.mjs` that looks for `history.replaceState`. That is
coverage of the source text, not of the behaviour. H3 is wrong on its wording and
right on its substance.

**So the three are marked `uncovered`**, a third category beside `equivalent`.
They must survive, and a run in which one dies fails — demonstrated by flipping
one to `killed`. This is the difference between a gap that is known and one that
is merely absent: if a browser check ever lands in CI, the harness reports the
status change rather than quietly gaining coverage nobody notices.

**The honest statement for the 0.1.0 evidence:** the UI's behavioural
correctness rests entirely on a browser sitting run by hand. Not on the suite.

## The declared-suite scheme

Each mutant names the suite that should kill it; that suite runs first, and the
rest run only if it survives. Three outcomes, and the middle one earned its place
immediately: seven mutants were killed by a suite other than the declared one.
Six were my own mis-declarations — escape mutants attributed to the selftest when
the leak audit is what covers them — and the seventh was the harness defect above.

Cost: 215 seconds for 45 mutants, against roughly ten minutes for running every
suite against every one.

## Still open

- Header validation is narrower than `node:http`.
- Duplicate JSON members are silently last-wins; variable names are not checked
  against the reference charset; a stray `}}` is accepted as literal.
- `/api/session` answers without reading its body, so the body limit and the
  slow-upload deadline do not apply to it. **Note that the mutant for the body
  limit passes**, because `/api/resolve` enforces it — the row is covered on one
  route and not the other, and no mutant distinguishes them.
