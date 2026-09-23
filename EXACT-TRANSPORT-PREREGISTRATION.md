# 0.5.0 exact transport request — pre-registration

**Written before the change and before it was run. Section 4 is frozen from the
commit that adds this file.** Baseline `fbeaa0f26f9734a26e54e12664b3cca7c33eec57`
(`main`: 0.4.1 plus the step-17 freeze), codeload archive sha256
`4f5d33b275742c8ab58fb423ef0cb2fe7d5b53407c60ae07d4367628fa756c12`. `npm ci &&
npm test` on a clean extraction exits 0 on Node 22.22.2: refusals 43/43,
selftest 220/220, leak-audit 0 of 41, ui 27/27, parity 7/7, server 51/51,
server-slow 2/2, wire 23/23, wire-tls 16/16, run-tls 12/12. The archive diffs
identical to the `main` zip whose comment names the same sha.

Scope ruled 2026-09-23 in `decisions.md`, "reqtrail 0.4.1 and the repair
sequence", item 2: **0.5.0 makes the request the transport sends the request
the core built — endpoint, target and framing — and nothing else.** Finding IDs
are from `handoffs/reqtrail/REVIEW-2026-09-23-architecture-second-pass.md` in
`project-planning`. The execution boundary (display before send, acknowledged
output, delivery state, one total deadline) is 0.6.0 and is not touched here.

This file and `EXACT-TRANSPORT-EVIDENCE.md` land in one commit, with the live
drift guard in `test/selftest.mjs` pointed at the evidence document —
`RELEASE.md` step 2, the first release to start that way.

## 1. The divergences

Each was reproduced against the baseline before this file was written, by
probes against the baseline's own `__prepareForTest`, `run`, `send` and binary.
**Three were found in reproducing and are not in the review**: they are marked.

1. **A bare `?` is shown and not sent (RT-A2).** `http://127.0.0.1:<port>/p?`
   projects as `…/p?`; the raw receiver captured the target `/p`.
   `src/transport/http.js:52` rebuilds the target as `pathname + search`, and
   `search` is `""` for a bare `?`. `http://h?` shows `http://h/?` and sends `/`;
   `http://h/p?#f` shows `…/p?` and sends `/p`.
2. **An IPv6 literal resolves and cannot be sent (RT-B2).** `http://[::1]:8080/ipv6`
   projects correctly, `Host: [::1]:8080`, and `wireTarget` returns hostname
   `[::1]` — brackets included — which `http.request` treats as a DNS name.
   `run` returns `transport.code: ENOTFOUND` in 14 ms (default port: 2 ms). The
   review's "hangs until interrupted" was its resolver answering; the decisions
   entry already downgraded it to Medium. `url.urlToHttpOptions` strips the
   brackets **and drops the bare `?`** (measured: `/p?` → path `/p`), so it
   would fix item 2 by making item 1 permanent.
3. **Framing headers change what goes on the wire, or hang (RT-A5).** Against
   the raw receiver and a real `node:http` server:
   - `Transfer-Encoding: chunked` on a GET: **node writes a body, `0\r\n\r\n`,
     after the header block.** Bytes on the wire that no projection shows.
     *(Found in reproducing.)*
   - `Content-Length: 5` on a GET with no body: the real server waits for five
     bytes that never come. With no send timeout, `run` does not return.
   - `Connection: Upgrade` + `Upgrade: websocket` against a server that answers
     `101`: node emits `upgrade`, never `response`, and `send` never settles.
   - `Transfer-Encoding: gzip`: the real server answers 400.
   - `Expect: x-unknown`: 417. `Expect: 100-continue` with no body: 200.
4. **A `Trailer` header exits 3 with nothing attempted.** *(Found in
   reproducing.)* node throws `ERR_HTTP_TRAILER_INVALID` inside `send` before any
   socket; `run` reports `not sent: ERR_HTTP_TRAILER_INVALID`, exit 3. The README
   says code 3 means bytes were attempted.
5. **Two oracles share the defect's derivation.** *(Found in reproducing.)*
   `test/wire.mjs:61` and `test/wire-tls.mjs:104` assert the captured target
   equals `u.pathname + u.search` — the same expression as the transport — so
   they pass on the bug by construction. The 0.4.1 ruling, "an oracle must not
   share text with the implementation it judges", applies directly.
6. **`wire.mjs` has no count tripwire.** A row that stops running is invisible.
   `wire-tls.mjs` has none either, and it is the other suite this release adds
   rows to.

Also measured, and shaping the design rather than being a defect: **when a
workspace sets `Connection`, node adds none of its own** (`Connection: close`
reaches the wire once). Repeated `Connection` headers (`close` then
`keep-alive`) are sent verbatim, both of them.

## 2. The change, stated as properties of OUTPUTS

**P-TARGET.** For every request `run` sends, the request line's target is the
normalized URL's text from the first `/` after the authority to its end — bare
`?` included. Stated so it is checkable from captured bytes and the projection
alone: for a URL that holds no secret, `projection.url` equals `scheme://` +
`Host` + the captured target.

**P-ENDPOINT.** The connection goes to the host and port the projection shows.
An IPv6 literal is connected unbracketed and shown bracketed; `Host` is
unchanged from 0.4.1.

**P-FRAMING.** No request `run` sends carries a body, a framing header, or an
expectation of a protocol switch. A workspace that declares one is refused
before anything is sent, exit 1, naming the header and never its value.

**P-SHOWN-IS-SENT, restored to the README's sentence.** After this release,
`Connection` is again the only header that reaches a receiver without appearing
in the projection, and nothing follows the header block.

## 3. The design, ruled before increment 2

**D0. The version is 0.5.0.** IPv6 literals become sendable, which is new
capability, and some newly refused shapes were not producing false output under
0.4.1 — `Expect: 100-continue` and a lone `Connection: X-Foo` send what they
say. The 0.4.1 standing ruling (a refusal is a bug fix only when the refused
input produced false output) therefore does not cover all of them, so this is
not a patch. The release notes name every newly refused header.

**D1. The exact request gains `transport`, built in the core.** `url.js` gains
`transportFromHref(href)`, returning
`{ protocol, connectHostname, port, authority, requestTarget }`, and
`prepare.js` puts it on the exact request beside `url` and `headers`. It is
private exactly as the rest of `exact` is, and `project()` does not read it.

- `authority` is `href` between `://` and the next `/` — the slice
  `hostFromHref` already takes. `Host`'s text and `authority` are one slice of
  one string; a check pins that they are equal for every corpus case.
- `requestTarget` is `href` from that `/` to the end. The fragment is already
  gone (`parse()` clears it), so a bare `?` survives.
- `connectHostname` is `authority` without a `:port` suffix, and without the
  enclosing brackets when it is an IPv6 literal.
- `port` is a number: the explicit port, or 80 / 443 by protocol when the
  normalized `href` omits it.
- **Verified by reconstruction**, like every attribution in the module:
  `protocol + "//" + authority + requestTarget` must equal `href`, and
  `connectHostname` and `port` must agree with `new URL(href)`'s `hostname`
  (brackets removed) and `port`. A mismatch refuses as
  `url.target.undeterminable` — unreachable by construction, kept as an
  executable statement of the invariant, the `host.undeterminable` pattern.

**Rejected: `url.urlToHttpOptions`** (§1, item 2). **Rejected: building these in
the transport**, which is where they were being rediscovered from display text
— the review's point, and the reason the target was lost.

**D2. The transport reads `exact.transport` and parses nothing.** `wireTarget`
is replaced by a pure `wireOptions(exact)` returning `{ protocol, hostname:
connectHostname, port, path: requestTarget, method, headers }`, which `send`
calls; the protocol guard stays, reading `exact.transport.protocol`. A selftest
check forbids `new URL(` and `urlToHttpOptions` in `src/transport/http.js` —
forbidding a shape, per the 0.4.1 ruling on prose checks. `wireOptions` being
pure is what lets selftest, which the mutation harness runs, observe the
translation; the harness does not run `wire.mjs` until 0.6.0.

**D3. Framing headers are refused as `header.framing`.** A workspace header
whose name is, ASCII case-insensitively, `Content-Length`, `Transfer-Encoding`,
`Expect`, `Upgrade` or `Trailer` is refused whatever its value — empty,
literal, substituted or unresolved — because the name is always literal. The
message names the header name and says reqtrail sends GET without a body and
does not model framing. Exit 1. `Trailer` is in the set because of §1 item 4.

**Not refused, stated so nobody re-proposes it by accident:** `TE`,
`Keep-Alive`, `Proxy-Connection`. Each was measured to be sent verbatim with no
change to what node writes. Refusing them has no divergence behind it.

**D4. `Connection` is allowed once, as `close` or `keep-alive`.** ASCII
case-insensitive, exact, no list. Anything else — a second `Connection`, a
token list, `Upgrade`, a custom token — is refused as `header.connection`,
naming no value, because a value can come from a secret. The check runs on the
resolved value; an unresolved value is already unsendable and is reported as
unresolved, not refused. **This is narrower than the review asked** ("conflicting
Connection shapes") on purpose: an allowlist can be relaxed later without
breaking a file, which is the reasoning 0.4.1 D1 applied to BOMs.

**D5. IPv6 rows run or fail; they never skip silently.** Wire and TLS rows that
need `::1` try to bind it. If binding fails, the suite **fails** with a message
naming `REQTRAIL_NO_IPV6=1`. With that variable set, those rows are not run,
the suite's summary line states how many were not run and why, and its
tripwire subtracts exactly that number. A selftest check forbids the variable
anywhere under `.github/`. **Measured beforehand: this chat sandbox cannot bind
`::1` (`EAFNOSUPPORT`)**, so every IPv6 end-to-end observation in the evidence
comes from CI or from Ash's macOS machine, and is recorded with where it ran.
Pure `transportFromHref` rows for IPv6 run everywhere.

**D6. New oracles state expected values as literals.** Every new target,
authority, hostname and port row writes the expected string or number in the
test, never computed with the URL API. The two existing target rows (§1 item 5)
are rewritten the same way.

**D7. Count tripwires in `wire.mjs` and `wire-tls.mjs`**, landing before any row
is added to either, in the pattern `server.mjs` uses. The next session's action
list named only `wire.mjs`; `wire-tls.mjs` is added because it receives the
IPv6 TLS rows, and D5 depends on a tripwire to make a skip visible.

**D8. IPv6 over TLS uses a second test-only certificate.** The existing fixture
stays byte-identical: its `DNS:localhost`-only SAN is what the altname-mismatch
row relies on. `test/tls/TEST-ONLY-ipv6-loopback-cert.pem` (and key) carries
`IP:::1` only, generated by the same command with that SAN, and gets its own
`notAfter` check. `send`'s TLS options do not change: node sends no SNI for an
IP literal and verifies it against the IP SAN.

**D9. Default ports are covered by pure rows only.** Binding 80 or 443 needs
privileges CI does not grant, so "no automated test sends to port 443" stays a
carried item. `transportFromHref` rows cover `http` and `https`, default and
non-default, IPv4, IPv6 and DNS names.

**D10. README.** The refusals section gains the framing and `Connection` rule.
"`Connection` is the only header that reaches a receiver without appearing
above" and "Code 3 means bytes were attempted" become true again rather than
being edited.

### Order of work — each increment verified before the next

For every increment, the new checks are first run against the code before the
fix and their failures recorded in the evidence file. Uploads are ordered so
each commit is green where that is possible (the 0.4.1 upload finding).

1. **This file, the evidence document, and the live drift guard.**
2. **Tripwires (D7).** Test-only; counts unchanged.
3. **`transportFromHref` and `exact.transport` (D1)**, with pure selftest rows.
   The transport still ignores it; every existing check passes.
4. **The transport reads it (D2)**, with the wire rows: bare `?`, IPv4
   non-default port, IPv6 capture and W-REAL under D5, the two target rows
   rewritten (D6), and the direct-call protocol guard row given the new shape.
5. **IPv6 over TLS (D8).**
6. **Framing and `Connection` refusals (D3, D4)**, leak-audit fixtures for both
   with a secret value, and the README (D10).
7. **Mutants** in `test/mutate.mjs`, each targeting selftest: target sliced as
   `pathname + search`; brackets left on `connectHostname`; default port
   dropped; `authority` used as the connect hostname in `wireOptions`; one name
   removed from the framing set; the `Connection` allowlist widened.
8. **Evidence document and release**, following `RELEASE.md`.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| P1 | `enumerate-refusals` goes from 43 to **46**: `header.framing`, `header.connection`, `url.target.undeterminable` | medium-high | any other count |
| P2 | `src/` changes touch **only** `core/url.js`, `core/prepare.js` and `transport/http.js`; `exact.js`, `errors.js`, `cli/`, `server/` and `ui/` are unchanged | medium-high | any other `src/` file changes |
| P3 | Exactly **three** existing checks are edited: the two target rows (assertion to a literal, D6) and wire's direct-call protocol guard (input shape only, assertion unchanged). Every other existing check passes unedited | medium | any other existing check edited |
| P4 | The bare-`?` wire row captures `/p` and the IPv6 wire row gets `ENOTFOUND` **on the baseline transport**, and both pass after D2 | high | either passes on the baseline, or fails after |
| P5 | For every existing fixture, the projection and `resolve --json` output are **byte-identical** to 0.4.1 | high | any byte differs |
| P6 | GitHub's `ubuntu-latest` runner binds `::1`, so CI runs every IPv6 row with `REQTRAIL_NO_IPV6` unset | medium | CI cannot bind `::1` |
| P7 | The IPv6 HTTPS row verifies against the `IP:::1` certificate with **no change** to `send`'s TLS options | medium | any TLS option added or changed |
| P8 | Every new mutant from increment 7 is **killed on its first run** | medium | any mutant survives or is uncovered |
| P9 | Checks grow by **25–45** across all suites, leak fixtures counted separately (0.4.0/0.4.1 rule) | medium | growth outside that range |
| P10 | The mutation run **completes** with every mutant accounted for, as 0.4.1's first complete run did | medium-high | the run does not finish, or any mutant is unaccounted |

**P11, the meta-prediction: at least one of P1–P10 is wrong.**

**Confidence: medium.** Record: wrong five sittings running by overestimating
the error rate, then right for 0.2.0, 0.3.0, 0.4.0 and 0.4.1 (0.4.1 P11 held,
with P3 wrong). 0.4.1's P10 was the first size prediction in six releases that
was not an underestimate; one data point, and the range here is wider for it.

**Contamination, declared.** Every divergence in Section 1 was reproduced before
this file was written. Also measured beforehand: that no existing workspace
fixture, example or leak-audit fixture declares `Content-Length`,
`Transfer-Encoding`, `Expect`, `Upgrade`, `Trailer` or `Connection` (grep); that
node adds no `Connection` when the workspace sets one; that `TE`, `Keep-Alive`
and `Proxy-Connection` pass verbatim; that this sandbox cannot bind `::1`; that
the existing certificate's SAN is `DNS:localhost` only; and that
`url.urlToHttpOptions` drops a bare `?`. **No prediction above is about whether
a divergence exists.** P4 is about rows not yet written; P6 and P7 are about
environments not yet run.

## 5. Explicitly NOT in this change

- **Display before send, acknowledged output, EPIPE, `executeOnce`.** 0.6.0,
  shipped together (RT-B4 + RT-A1).
- **One total deadline.** 0.6.0. **A server that stalls still stalls `run`**;
  0.5.0 removes the stalls reqtrail itself caused by framing, not stalls in
  general.
- **Delivery state and resets after a `200`** (RT-A3). 0.6.0.
- **ENOTFOUND with an injected resolver.** 0.6.0. The IPv6 fix needs no resolver:
  a literal is never resolved.
- **Wire, TLS and parity in the mutation harness.** 0.6.0. D2's pure
  `wireOptions` is what lets this release's mutants be killed without it.
- **Component-aware provenance** (RT-B1 as modified). 0.8.0.
- **Bodies and methods other than GET.** Not sequenced. D3 refuses framing
  because there is no body; when bodies arrive, framing is modelled then.
- **A send to port 443, IPv6 zone identifiers, punycode (P6), proxies, HTTP/2,
  client certificates.** Carried. `new URL` already refuses zone identifiers.
- **A Node matrix and the Ubuntu 26 run.** The run is a separate action due
  before 2026-10-19; if 0.5.0's CI is the first on the new image, the evidence
  says so.

## 6. What would stop this release

- **CI cannot bind `::1`** (P6 at its worst). D5 then makes CI red. Do not set
  `REQTRAIL_NO_IPV6` in a workflow to get green: rule on where IPv6 evidence
  comes from first.
- **IPv6 over TLS needs `servername`, `checkServerIdentity` or any other TLS
  option change** (P7 at its worst). P-VERIFY is the floor; stop and rule.
- **`transportFromHref` and `Host` disagree on any corpus case.** Then one of
  them was wrong in 0.4.1 too; stop and find which before shipping.
- **The work exceeds two sittings.** Cut increment 5 (IPv6 over TLS) and carry
  it; IPv6 over HTTP is the finding, and TLS adds no new translation.
