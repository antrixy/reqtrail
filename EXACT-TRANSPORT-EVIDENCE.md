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

As of increment 5: IPv6 over TLS. Where an IPv6 row could not be run, the
count says so and where.

    refusals    44/44 carry a literal message
    selftest    244/244
    leak-audit  0 of 41 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        27/27 — observed on CI (ubuntu-latest), the run for
                1a864c7, reported by Ash; this sandbox cannot bind ::1
                and runs 25/25 with REQTRAIL_NO_IPV6=1
    wire-tls    20/20 — NOT YET OBSERVED with IPv6 run; this sandbox
                runs 16/16 with REQTRAIL_NO_IPV6=1
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
| P6 | CI binds `::1`; no IPv6 row is skipped on CI | **held** for wire — `wire 27/27 OK` on `ubuntu-latest` (1a864c7, Ash's screenshot); wire-tls pending |
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
- **Increment 4, the transport reads (D2), wire rows, D5.** Run against the
  increment-3 transport, with `wireOptions` added to it as a shim exposing that
  transport's own translation under the new name, so the rows could load:
  - selftest: **4 of the 6 new rows failed** — IPv6 hostname bracketed, bare `?`
    dropped, https port `""` rather than 443, and `new URL(` present. **Two
    passed, as expected, and are not bites:** "the connect hostname is not the
    authority" targets a mutant (increment 7), not the baseline, which got DNS
    names right; the `.github/` check is a negative that holds on any tree
    without the variable.
  - wire: **both P-TARGET rows failed** — the receiver captured `/p`.
  - wire, IPv6: **not run in this sandbox** (`EAFNOSUPPORT` on `::1`). With the
    variable unset the suite failed and named it; with it set, the summary said
    `2 IPv6 rows NOT RUN`. The IPv6 bite and pass (P4) are owed to a machine
    that binds `::1`, and are recorded here with where they ran.
  - The two rewritten target rows (D6) pass on the baseline too: their fixture
    has no bare `?`, so the rewrite removes the shared derivation rather than
    biting. The P-TARGET rows are what bite.
  - wire's direct-call guard row failed after D2 with its old input
    (`TypeError` reading `transport`), and passes with the reshaped input;
    assertion unchanged. That is the third of P3's three edits.
- `slice0/receiver.mjs` gained a `host` parameter (default `127.0.0.1`) and now
  rejects on a failed bind instead of throwing from an event handler. **That
  was a freeze violation — see increment 5.**
- **CI, the run for `1a864c7`: `wire 27/27 OK`**, both IPv6 rows run on
  `ubuntu-latest`, reported by Ash with a screenshot of the Test step. The
  screenshot does not show the sha. P6 held for `wire`. The IPv6 half of P4 —
  the row failing `ENOTFOUND` on the OLD transport — is still owed to a machine
  that binds `::1`.
- **Increment 5, IPv6 over TLS (D8), and a reverted freeze violation.**
  - **`slice0/` is frozen** (`slice0/README.md`: a repair that moves no verdict,
    not new capability). Increment 4's edit to `slice0/receiver.mjs` was new
    capability and did not meet that bar; nothing checked it, and it was caught
    by reading the comment in `test/tls-receiver.mjs` that states the precedent.
    Reverted byte-identical to the frozen file; the IPv6 capture loop now lives
    in `test/ipv6-receiver.mjs`, duplicated verbatim as the TLS receiver
    duplicated it. No verdict moved while it was edited: slice-0's callers bind
    the default.
  - Second fixture `test/tls/TEST-ONLY-ipv6-loopback-cert.pem` (+ key), SAN
    `IP:::1` only, notAfter 2126-08-30. The localhost fixture is byte-identical.
    `test/tls-receiver.mjs` gained `{ ipv6, cert }` options and rejects on a
    failed bind; it is a test file, not frozen.
  - The new selftest check (both SANs pinned, IPv6 notAfter) was run with the
    IPv6 certificate absent: failed, `ENOENT`. Passes with it present.
  - Four wire-tls rows under D5: trusted `[::1]` send verified with Host and
    target on the wire; untrusted fails with no bytes; a trusted certificate for
    `localhost` served on `::1` fails `ERR_TLS_CERT_ALTNAME_INVALID` with no
    bytes; W-REAL on `::1`. **Not run in this sandbox.** As a stand-in, the same
    four rows were run in a scratch copy with an IPv4 literal and a throwaway
    `IP:127.0.0.1` certificate — the same no-SNI, IP-SAN path: 20/20. That shows
    the rows are written correctly; it is not P7's evidence, which is `::1` on
    CI with `send`'s TLS options unchanged (they are: `http.js` is untouched in
    this increment).

## What the pre-registration did not foresee

Nothing yet.

## Release steps outside the repo

Not yet reached.
