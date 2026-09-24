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

As of the release-prep commit (0.5.0, version strings bumped). IPv6 rows need
`::1`: CI runs them; this sandbox cannot, and says so.

    refusals    46/46 carry a literal message
    selftest    260/260
    leak-audit  0 of 43 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        28/28 on CI (ubuntu-latest) and on Ash's Mac. Here:
                26/26, 2 IPv6 rows NOT RUN (REQTRAIL_NO_IPV6=1)
    wire-tls    20/20 on CI (Node 22.23.2, fail-closed mode for the two
                trusted IPv6 rows, nodejs/node#64144) — inferred from
                the green run for 42a1db9 as reported by Ash; the line
                itself was not pasted. 20/20 on Ash's Mac (Node
                24.4.1) in VERIFIED-SEND mode. Here: 16/16, 4 IPv6
                rows NOT RUN
    run-tls     12/12
    mutation    81/81 accounted for (1 equivalent, 2 uncovered), no
                misattribution — the first VALID run; see increment 7
    sitting A   15/17 held — B1–B9, F1–F4, F6, F8 right; B10 (meta) wrong;
                F7 answered elsewhere. Release tree 5cc5023, macOS, Chrome

## Predictions

Resolved here as the release is built, each against the wording frozen in the
pre-registration's Section 4. A falsified prediction keeps its original wording
and is marked, never reworded.

| # | Prediction | Result |
| --- | --- | --- |
| P1 | refusals 43 → 46 | **held** — 46: `header.framing`, `header.connection`, `url.target.undeterminable` |
| P2 | `src/` changes only in `url.js`, `prepare.js`, `transport/http.js` | **FALSIFIED on its wording** — `src/cli/main.js` changed: the `VERSION` string, `RELEASE.md` step 1, which every release makes and the prediction did not except. No other `src/` file changed. Held in substance; marked by the letter, as P10 was |
| P3 | exactly three existing checks edited | **held** — wire and wire-tls target rows (to literals), wire's direct-call guard (input only). Every other line removed from an existing test file is a count constant, a comment, a summary format, or the TLS child's catch widened to report `reason` (not a check) |
| P4 | new target and IPv6 rows fail on the baseline, pass after | **held in part** — both bare-`?` rows captured `/p` on the old transport and pass after. **The IPv6 half was never observed**: the IPv6 row was not run against the old transport on any machine that binds `::1`. The defect itself was reproduced (ENOTFOUND, §1 item 2); the row's bite was not |
| P5 | projection and `--json` byte-identical on every existing fixture | **held** — `resolve` and `resolve --json` through the binary, 0.4.1 (`fbeaa0f`) against the release tree, on all 39 pre-existing leak-audit fixtures and the example workspace: 80 comparisons of exit code, stdout and stderr, 0 differ. The two fixtures new in 0.5.0 excluded |
| P6 | CI binds `::1`; no IPv6 row is skipped on CI | **held** — `wire 27/27` then `28/28` observed on `ubuntu-latest`; wire-tls ran all 20 (its two failures on 4c01b77 were TLS identity, after binding); selftest forbids the skip variable under `.github/` |
| P7 | IPv6 HTTPS verifies with no change to TLS options | **FALSIFIED** — on CI's Node 22.23.2 the IPv6 HTTPS row does not verify (nodejs/node#64144); TLS options unchanged |
| P8 | every new mutant killed on its first run | **held on the first valid run** — the first run was void (the unmutated tree was red); judged, not clean, see increment 7 |
| P9 | checks grow by 25–45 | **FALSIFIED** — **+49**: selftest +40 (220 → 260), wire +5 (23 → 28), wire-tls +4 (16 → 20); leak fixtures +2 counted separately. An underestimate again, after 0.4.1's first non-underestimate |
| P10 | mutation run completes, every mutant accounted for | **FALSIFIED** — the first complete run reported 78/81, three expected survivors killed; 81/81 only after repairing the harness |
| P11 | at least one of P1–P10 is wrong | **held** — P2 (by the letter), P7, P9, P10 wrong; P4 half unobserved |

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
- **`b3ee836`: the cause, in Node.** Versions step: `node v22.23.2 openssl
  3.5.7`. Both trusted sends: `ERR_TLS_CERT_ALTNAME_INVALID`, reason `Host: ::1.
  is not cert's CN: ::1 (reqtrail TEST ONLY)`. Node v22.23.2's
  `checkServerIdentity` (read from the tag's `lib/tls.js`) gates the IP branch
  on `domainToASCII(hostname)`, and `domainToASCII("::1")` is `""` (measured
  here), so an IPv6 literal is never compared with IP SANs and falls through to
  the CN. v22.22.2's `lib/tls.js` has no `domainToASCII`. This is
  nodejs/node#64144, a regression from the CVE-2026-48618 security releases:
  fail-closed, fixed in Node 26.6.0 and on the `v24.x` branch, not on `v22.x`
  as of 2026-09-24. IPv4 literals are unaffected. **P7 is falsified**: on CI the
  IPv6 HTTPS row does not verify. `send`'s TLS options are unchanged.
- **RULED 2026-09-24 by Ash, §6: option 3 — measure the runtime.** Rejected:
  pinning CI to 22.22.2 (tests on a Node without the CVE fix, hides what users
  on current 22.x hit); working around it in `send` (reqtrail re-implementing
  identity checks, in the function the CVE was about, below the P-VERIFY
  floor); cutting IPv6-over-TLS (the behaviour is the same, untested).
  - `wire-tls.mjs` asks THIS Node's `tls.checkServerIdentity("::1", <the IPv6
    test certificate>)` first. Where it accepts, the two trusted rows assert a
    verified send, as before. Where it rejects, they assert fail-closed:
    `ERR_TLS_CERT_ALTNAME_INVALID`, no request bytes at the raw receiver, no
    request served by the real server. The summary line names the Node version
    and #64144. Count unchanged, 20.
  - In fail-closed mode, the Host and target of an IPv6 TLS send are not
    observed on the wire. The plain IPv6 wire rows observe them, and TLS adds no
    translation; stated rather than left implicit.
  - **Both modes exercised here over IPv4**, scratch copies only: a certificate
    for `IP:127.0.0.1` (runtime accepts) → 20/20; one for `IP:127.0.0.2`
    (runtime rejects) → 20/20 with the fail-closed note. **Bites both ways:**
    forcing the accept mode where the runtime rejects failed both rows; forcing
    fail-closed where it accepts failed both, one of them `1 request(s) served`.
  - README gains a paragraph under the exit-code notes naming the limitation,
    the issue, the measured version and the upstream fix.

## Release steps outside the repo

- **Step 4, clean checkout** — Ash's Mac, fresh clone at
  `5cc5023f6902ec4c724f458d6f3e325f3e4e2c3e`, **Node v24.4.1, OpenSSL 3.6.1**:
  refusals 46/46, selftest 260/260, 0 of 43 leak, ui 27/27, server 51/51,
  server-slow 2/2, **wire 28/28, wire-tls 20/20**, run-tls 12/12, all with IPv6
  run. parity passed (the next suite ran; the grep pattern did not match its
  line). **The two trusted IPv6 TLS rows ran in verified-send mode, no
  fail-closed note**: this Node predates the CVE-2026-48618 releases, so a real
  `https://[::1]` send verified against `IP:::1` with `Host [::1]:port` and the
  target observed on the wire, `send`'s TLS options unchanged. Both modes of the
  §6 ruling are therefore observed on real `::1`: verified on 24.4.1,
  fail-closed on 22.23.2. P7 stays falsified as written — it failed on CI's
  Node — but the path it predicted works where Node is not broken. Also: the
  sandbox's sha-pinned archive, `REQTRAIL_NO_IPV6=1`, green.
- **Step 5, sitting A** — same clone, `npm run build:ui` (`dist/app.js`,
  200192 bytes), Chrome on macOS: **15/17 held**, the 0.4.1 shape. F3's page
  text: "This view shows requests. It does not send them — run reqtrail run to
  send."
- **Step 6, the About sidebar** — read by Ash: "Shows the HTTP request it hands
  to the transport — method, URL, headers — and where every substituted value
  came from. resolve never sends; run sends and reports the status.
  Local-first, plain JSON workspaces, CLI plus a loopback web UI." Accurate for
  0.5.0; no version claim. Unchanged.
- **Steps 7–8, release notes** — every example captured from the 0.5.0 binary
  at `5cc5023`; the bare-`?` wire lines captured by a raw receiver from the
  0.4.1 binary (`GET /health HTTP/1.1`) and the 0.5.0 binary (`GET /health?
  HTTP/1.1`). Each claim checked against a measurement: the §1 probes
  (chunked body, `Content-Length` hang, `101` hang, `Trailer` exit 3 → 1,
  `Expect`/`Connection: Upgrade` sent as written by 0.4.1), selftest rows
  (`TE`, `Keep-Alive`, `Proxy-Connection`, `Connection: close` accepted), and
  the Mac run (Node 24.4.1 verifies IPv6 HTTPS).
- Tagging, publishing and steps 14–17: not yet reached.
