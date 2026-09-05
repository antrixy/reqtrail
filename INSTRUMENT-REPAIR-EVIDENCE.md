# Instrument repair — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`INSTRUMENT-REPAIR-PREREGISTRATION.md`. Baseline `b500665`.

**No product code was touched.** Two test files changed; nothing under `src/`,
`bin/` or `scripts/`. That was the condition of the sitting and it held.

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| E1 | Removing `\|\| true` makes the check fail | **right** |
| E2 | It is the only vacuous check; a scan finds no others | **right** — 0 others |
| E3 | The naive gate fails on B10 | **right** — demonstrated, exit 1 |
| E4 | Adding `pageErrors` to B1 changes nothing today | **right** |
| E5 | Replacing `cat` with `readFileSync` changes no result | **right** |
| E6 | At least one of E1–E5 wrong | **WRONG** — none was |

**E6 was wrong, and that is the result to be suspicious of.** Five for five on
predictions about one's own test files is the profile that E6 exists to flag.
The mitigating evidence is that each repaired instrument was made to fail on
purpose before being trusted — the guard, the sitting gate and the B10 collision
were each demonstrated, not asserted. Without those demonstrations this would
read as a clean sweep and mean very little.

## E1 — the `|| true` was hiding a wrong assertion, not a redundancy

    check("header spans are never transformed", () =>
      prov("https://a.example", {}, {}, [{ name: "a", value: "{{x}} b" }],)
        .length === 0 || true);

With the clause removed: `FAIL 1 of 133 — returned false, wanted true`.

The fixture substitutes one header span, so the honest length is 1 and the
assertion was simply wrong. **Someone wrote a check, watched it fail, and
silenced it rather than fixing it** — that is worse than an unfalsifiable check,
and it counted toward 133 while testing nothing.

Replaced with the discriminating property the name was reaching for: the same
value in a URL and in a header, from one workspace, transformed in the first and
not in the second. Position determines transformation, which is the reason
provenance carries one row per occurrence.

## E2 — and a permanent guard, which failed on its own documentation first

A scan of all seven test files for `|| true`, `&& true` and `=> true)` found no
others. The single instance is now impossible to reintroduce: a check walks
every test file and fails, naming file and line, on any always-true clause.
Demonstrated by planting one in an unrelated check — `FAIL ... test/selftest.mjs:438`.

**The guard's first version failed on the comment explaining the guard.** That
is the third time on this project a pattern match has confused a mention with a
use: `dangerouslySetInnerHTML` in `test/ui.mjs`, the enumerator's line window,
and now this. Comments are skipped, and the reason is written at the check
rather than in a commit message, because a check that makes documenting a rule
impossible gets deleted rather than obeyed.

## E3 — the naive repair was wrong, and it was cheaper to predict than discover

The old gate tripped only on B4–B7, so **B1, B2, B3, B8 and B9 could fail in
silence** — five of nine predictions, including every one about whether the
application works at all.

The obvious repair is "fail on any wrong prediction". Measured with the
exclusion removed:

    as committed (repaired):        exit 0
    naive gate, no META exclusion:  exit 1   <- B10 alone trips it
    repaired gate, B2 broken:       exit 1
    restored:                       exit 0

B10 is a **meta-prediction about the sitting's own error rate**. The better the
work, the more certainly B10 is wrong, so a naive gate fails hardest exactly
when nothing is wrong. **A sitting cannot be gated on its own error rate.** B10
is excluded by name, with the reason at the exclusion.

Had this been discovered mid-run rather than predicted, the likely response
would have been to drop B10 from the gate quickly and move on — the right action
for an unexamined reason, which is how a gate quietly loses the rest of its
coverage next time.

## What changed

- `test/selftest.mjs` — the silenced check replaced with a real one; a permanent
  always-true guard; `readSource` uses `readFileSync` instead of shelling out to
  `cat`, so the suite is portable. 133 → 134 checks.
- `test/sitting-browser.mjs` — B1's verdict includes `pageErrors`; B5 checks both
  halves it claims to; the gate covers every non-meta prediction.

Suite from a clean checkout: refusals 33/33 · selftest 134/134 · leak 0 of 26 ·
ui 12/12 · parity 7/7 · server 50/50. Sitting A: 9/10, exit 0.

## Still open

The sitting still has **no refusal fixture** — every prediction is measured
against a workspace that resolves. That is not repaired here because the UI
renders a blank page on any refusal, so there is nothing yet to measure. The
gate is now in a state to judge that work when it happens, which was the point
of doing this first.
