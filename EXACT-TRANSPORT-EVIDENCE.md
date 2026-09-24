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

As of increment 7: mutants added; the harness repaired. Where an IPv6 row could
not be run, the count says so and where.

    refusals    46/46 carry a literal message
    selftest    260/260
    leak-audit  0 of 43 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        28/28 — 27/27 observed on CI (ubuntu-latest) for
                1a864c7, reported by Ash; the 28th row landed in
                increment 6. This sandbox cannot bind ::1 and runs
                26/26 with REQTRAIL_NO_IPV6=1
    wire-tls    **FAILING ON CI** — 18/20 on 4c01b77 (run #51): both
                TRUSTED IPv6 sends fail. This sandbox runs 16/16 with
                REQTRAIL_NO_IPV6=1. Under diagnosis; see below
    run-tls     12/12
    mutation    81/81 accounted for (1 equivalent, 2 uncovered), no
                misattribution — the first VALID run; see increment 7
    sitting A   not yet run for this release

## Predictions

Resolved here as the release is built, each against the wording frozen in the
pre-registration's Section 4. A falsified prediction keeps its original wording
and is marked, never reworded.

| # | Prediction | Result |
| --- | --- | --- |
| P1 | refusals 43 → 46 | on track: 46 after increment 6, the last increment that adds a refusal |
| P2 | `src/` changes only in `url.js`, `prepare.js`, `transport/http.js` | open |
| P3 | exactly three existing checks edited | open |
| P4 | new target and IPv6 rows fail on the baseline, pass after | open |
| P5 | projection and `--json` byte-identical on every existing fixture | open |
| P6 | CI binds `::1`; no IPv6 row is skipped on CI | **held** for wire — `wire 27/27 OK` on `ubuntu-latest` (1a864c7, Ash's screenshot); wire-tls pending |
| P7 | IPv6 HTTPS verifies with no change to TLS options | **at risk** — trusted IPv6 TLS sends fail on CI, cause unknown |
| P8 | every new mutant killed on its first run | **held on the first valid run** — the first run was void (the unmutated tree was red); judged, not clean, see increment 7 |
| P9 | checks grow by 25–45 | open |
| P10 | mutation run completes, every mutant accounted for | **FALSIFIED** — the first complete run reported 78/81, three expected survivors killed; 81/81 only after repairing the harness |
| P11 | at least one of P1–P10 is wrong | **held** (P10) |

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
- **Increment 6, framing and `Connection` refusals (D3, D4), README (D10).**
  - `enumerate-refusals` 44 → **46**: `header.framing` and `header.connection`,
    one refusal site each.
  - Sixteen new selftest rows, run against the increment-5 `prepare.js`:
    **12 failed** ("did not refuse") — the five framing names, casing,
    unresolved value, message contents, and four `Connection` refusals.
    **Four passed there too and are not bites:** they are the accept side —
    `TE`/`Keep-Alive`/`Proxy-Connection` not refused, `close`/`keep-alive`
    accepted, a variable resolving to `close` accepted, an unresolved
    `Connection` reported unresolved. They pin what D3 and D4 must NOT refuse,
    and would fail if either were written too wide.
  - Two leak-audit fixtures (41 → 43), a secret as a refused framing value and
    as a refused `Connection` value: both clean on every channel.
  - One wire row pins D4's premise: a workspace `Connection: close` is the only
    `Connection` on the wire. It passes on 0.4.1 as well — it records node's
    behaviour, which D4 depends on, rather than biting a defect.
  - Through the binary: a `Trailer` header now exits **1** with a refusal; on
    0.4.1 it exited 3, `not sent: ERR_HTTP_TRAILER_INVALID` (§1 item 4).
  - README gains one paragraph under the `Host` paragraph. "`Connection` is the
    only header that reaches a receiver without appearing above" and "Code 3
    means bytes were attempted" are unedited, and are true again.
- **Increment 7, mutants — and a harness that could not have told.** Six
  mutants added, one per pre-registered target, all declared against selftest.
  - **Run 1** (the six alone): 6/6 killed. **Void** — see run 3's cause 1.
  - **Run 2** (full): never ran. Started in the background, it died when the
    tool call ended; the poll (`pgrep -f`) matched its own command line and
    reported it running for about fourteen minutes. Caught when the process
    table showed nothing.
  - **Run 3** (full, detached): completed, **78/81 accounted for**. The
    equivalent mutant (span attribution without the tautological line) and both
    uncovered mutants (server row 4's deadline, UI sequencer verdict) were
    reported killed by selftest. **P10 is falsified by this run**, on its
    wording: it completed, and three mutants were unaccounted for.
  - **Two causes, both confirmed, either sufficient alone:**
    1. **Selftest failed on the UNMUTATED tree.** The D4 mutant's replacement
       text, `|| true;`, tripped the existing check "no check in this suite is
       silenced with an always-true clause", which scans every `test/*.mjs`.
       `npm test` was not run after the mutants were added. Every
       selftest-declared mutant therefore "died" — including all six new ones,
       which is why run 1 is void.
    2. **The harness's copy filter dropped `.github/`.** It excluded any path
       containing the substring `/.git`, which matches `/.github`; increment 4's
       check that `REQTRAIL_NO_IPV6` is absent from `.github/` then failed with
       `ENOENT` in every mutant directory. Harmless until a check read
       `.github/`, since 0.4.1's run.
  - **Repairs.** The D4 mutant now replaces the allowlist test with
    `["close", "keep-alive"].length > 0` — always true, and not a pattern the
    source check flags. The copy filter matches `.git` as a path segment. And
    **the harness now runs every suite on an unmutated copy first and refuses
    to count anything if one fails** — the check whose absence let cause 1
    through. Shown to bite: with an always-true line appended to a scratch
    copy's `test/wire.mjs`, the harness printed `mutation: NOT RUN — the
    unmutated tree fails selftest.mjs` and exited 1.
  - **Run 4** (the six alone, green baseline): 6/6 killed.
  - **Run 5** (full, detached, green baseline verified by the harness):
    **81/81 accounted for** — 78 killed, the equivalent and both uncovered
    mutants surviving as argued, no mutant killed by the wrong suite.
  - **P8 is marked held, and that is a judgement for Ash to accept or not.**
    Its first run was void rather than a result, and the D4 mutant's text
    changed before the first valid run. The first valid run of each mutant
    killed it.
  - Three of the six (D1: target, brackets, default port) are caught by
    `transportFromHref`'s reconstruction refusal as well as by the rows that
    check the values. The reconstruction line itself was NOT added as an
    equivalent mutant: it would be one, since it is unreachable on a correct
    slice, but it was not pre-registered and P8 is about killed mutants.

## What the pre-registration did not foresee

- **The IPv6 TLS rows fail on CI, and `main` is red from increment 5 on.**
  Run #51 (`4c01b77`), from Ash's screenshot: `wire 28/28 OK`, then
  `FAIL 2 of 20` in wire-tls — "P-ENDPOINT/TLS an IPv6 literal is sent
  verified" and "W-REAL/TLS/IPv6 a real HTTPS server on ::1 accepts the
  request". The untrusted row and the identity-mismatch row PASS, so on CI the
  runner binds `::1`, TLS connects, and verification runs; the TRUSTED send is
  what does not succeed. The run below #51 was red too; which commits in
  between were red has not been read.
- **What was checked here, without IPv6:** the committed certificate is trusted
  as a CA both with `ca:` and via `NODE_EXTRA_CA_CERTS` in a child;
  `tls.checkServerIdentity("::1", cert)` passes; a child with only
  `NODE_EXTRA_CA_CERTS` pointing at it gets `200` from a server presenting it,
  with identity checked as `::1` (Node 22.22.2, bundled OpenSSL 3.0.13). The
  increment-5 IPv4 stand-in used a THROWAWAY certificate, not the committed one
  — it showed the rows were written correctly and could not have caught a
  problem with the certificate. Nothing checked so far explains the CI result.
- **Diagnosis first, no fix yet.** The four IPv6 TLS rows returned `false` with
  no detail. They now throw with what the child reported and what the receiver
  captured; the IPv4 stand-in still passes 20/20 with them. `test.yml` gains a
  step printing Node's and OpenSSL's versions, since `node-version: '22'` does
  not say which it resolved to, and a `workflow_dispatch` trigger, at Ash's
  request, so a run can be repeated from the Actions tab without a commit.
- **`cde63f3`, with the diagnostic rows:** both trusted IPv6 sends report
  `ERR_TLS_CERT_ALTNAME_INVALID` (Ash's screenshot; the Versions step was not
  in it). So on CI the chain is trusted and node's IDENTITY check rejects the
  `IP:::1` certificate for the send to `[::1]`. Checked here on Node 22.22.2:
  node's https agent computes identity `::1` from `send`'s exact options
  (`servername` "" because the bracket-aware `calculateServerName` strips
  `[::1]` from the `Host` header and blanks an IP), and `checkServerIdentity`
  canonicalizes IP SANs, so `0:0:0:0:0:0:0:1` matches. CI's Node differs in one
  of those two places; which, is not yet known. The child now also reports
  node's `reason`, which names the hostname compared and the certificate's
  list.
- **§6 applies if the cure is a TLS option.** Passing `servername: ""` or a
  `checkServerIdentity` would change `send`'s TLS options, which §6 says stops
  the release for a ruling, and which falsifies P7. Nothing is changed in
  `src/` until the cause is known and ruled on.

## Release steps outside the repo

Not yet reached.
