# 0.5.0 exact transport request — evidence

**NOT RELEASED. This document is live.** It was created in the same commit as
`EXACT-TRANSPORT-PREREGISTRATION.md` (`RELEASE.md` step 2), and the live drift
guard in `test/selftest.mjs` is pointed at it from that commit. It is completed
as the release is built, and frozen by the first commit after publishing
(`RELEASE.md` step 17).

Pre-registration: `EXACT-TRANSPORT-PREREGISTRATION.md`, Section 4 frozen from
the commit that adds it. Baseline `fbeaa0f26f9734a26e54e12664b3cca7c33eec57`
(0.4.1 plus the step-17 freeze); the baseline counts are in the
pre-registration, not here — this document quotes only its own live counts.

## Counts, live

As of increment 3: `exact.transport` exists in the core; the transport does
not read it yet.

    refusals    44/44 carry a literal message
    selftest    237/237
    leak-audit  0 of 41 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        23/23
    wire-tls    16/16
    run-tls     12/12
    mutation    not yet run for this release
    sitting A   not yet run for this release

## Predictions

Resolved here as the release is built, each against the wording frozen in the
pre-registration's Section 4. A falsified prediction keeps its original wording
and is marked, never reworded.

| # | Prediction | Result |
| --- | --- | --- |
| P1 | refusals 43 → 46 | open |
| P2 | `src/` changes only in `url.js`, `prepare.js`, `transport/http.js` | open |
| P3 | exactly three existing checks edited | open |
| P4 | new target and IPv6 rows fail on the baseline, pass after | open |
| P5 | projection and `--json` byte-identical on every existing fixture | open |
| P6 | CI binds `::1`; no IPv6 row is skipped on CI | open |
| P7 | IPv6 HTTPS verifies with no change to TLS options | open |
| P8 | every new mutant killed on its first run | open |
| P9 | checks grow by 25–45 | open |
| P10 | mutation run completes, every mutant accounted for | open |
| P11 | at least one of P1–P10 is wrong | open |

## Oracle bites — every new check run against unfixed code first

Recorded per increment, before the fix lands.

- **Increment 1, the drift guard.** Run before this file existed: failed with
  `ENOENT` on `EXACT-TRANSPORT-EVIDENCE.md`. Run with this file's count edited
  to the baseline's 220: failed, naming the stale count and the suite's 221.
  Passes on the file as committed.
- **Increment 2, the tripwires.** Each shown to bite by setting its expected
  count one above what runs: `wire` failed "ran 23 checks, expected 24",
  `wire-tls` failed "ran 16 checks, expected 17", both exit 1. Counts unchanged:
  wire 23, wire-tls 16. The summary line keeps its format.
- **Increment 3, `transportFromHref` (D1).** The sixteen new selftest rows were
  run against the tree before the change (the increment-2 tree's `url.js` and
  `prepare.js`): **15 failed**, 14 because `exact.transport` does not exist and
  the corpus row because a resolved URL had none. **One passed on the
  baseline, and is recorded as a negative control rather than a bite:**
  "absent when the URL does not resolve" holds on any build that never builds
  a transport. It means something only beside the fifteen positive rows.
  The corpus row did NOT bite as first written — it skipped every case with no
  transport, so a build with none passed it. Rewritten before landing to
  require a transport exactly when `urlResolved`; that version fails on the
  baseline, as recorded above.
- `url.target.undeterminable` is unreachable by construction and has no row,
  the same standing as `host.undeterminable`. It is the refusal that moves
  `enumerate-refusals` from 43 to 44.
- Spot check toward P5, not its resolution: `resolve` and `resolve --json` on
  `examples/example.reqtrail.json` are byte-identical to the increment-2 tree.

## What the pre-registration did not foresee

Nothing yet.

## Release steps outside the repo

Not yet reached.
