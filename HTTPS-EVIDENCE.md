# HTTPS in `run` — evidence

**Complete.** `run` sends `https://`, and certificate verification cannot be
turned off. All ten predictions are resolved below; **three are falsified and
kept with their original wording.**

Pre-registration: `HTTPS-PREREGISTRATION.md`, Section 4 frozen and untouched.
Baseline `eaff15cf96d1a9428de72bc1380e2cb8fa8001d6`, fetched sha-pinned from
codeload; archive sha256
`1044ffbf182a215e597e8078d633753e71a082e14d577cc3aed32ab323e83655`.

Verified at `e036d1913e120e33508f78503da35be3833fddfc`; archive sha256
`b7872fa016e6418806758d131bc62e8e4b02e0643c9e370457f44218a2becb17`, plus the
drift guard that follows this document.

    refusals    40/40 carry a literal message
    selftest    201/201
    leak-audit  0 of 31 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        22/22
    wire-tls    16/16
    run-tls     12/12
    sitting A   NOT RE-RUN — no browser in this session; unchanged since 0.3.0

## What changed, and what a user sees

`run` refused every `https://` URL with `transport.unsupported`, exit 1, while
**every product example in the README is HTTPS**. It now sends them. Three files
in `src/` changed and no others: `transport/http.js`, `core/prepare.js`,
`cli/main.js`.

## P-VERIFY: the environment cannot turn verification off

Node reads `NODE_TLS_REJECT_UNAUTHORIZED` process-wide, so `=0` in a shell
disables certificate checking for everything that process sends. Measured on
Node 22 before any code was written: a default `https.request` to a self-signed
server returned **204** with that variable set; the same request with an
explicit `rejectUnauthorized: true` failed `DEPTH_ZERO_SELF_SIGNED_CERT`.

reqtrail passes it explicitly. `test/run-tls.mjs` drives the real binary:

    trusted certificate                         exit 0, sent, status 200
    untrusted certificate                       exit 3, not sent: DEPTH_ZERO_SELF_SIGNED_CERT
    certificate for a different host            exit 3, not sent: ERR_TLS_CERT_ALTNAME_INVALID
    untrusted + NODE_TLS_REJECT_UNAUTHORIZED=0  exit 3, not sent: DEPTH_ZERO_SELF_SIGNED_CERT

**In every failing case the receiver captured ZERO request bytes.** A refused
certificate means the request — secrets included — never left the machine.

**NODE PRINTS A WARNING THAT IS FALSE UNDER REQTRAIL.** With that variable set,
Node writes to stderr that certificate validation is disabled. reqtrail verifies
anyway, as the row above shows. The text is Node's, on stderr, and nothing
asserts it either way. **Recorded rather than fixed**: suppressing another
program's warning is a larger decision than this release.

## PREDICTIONS — resolved

| # | Prediction | Verdict |
| --- | --- | --- |
| H1 | ≤15 lines added to `src/transport/http.js`; no `src/core/` file but `prepare.js` | **WRONG on the count, held on the scope** — 20 added lines |
| H2 | `node:https` takes the flat ordered array; every P-WIRE assertion passes over TLS unedited | held |
| H3 | `Host` needs no change | held, PARTLY UNTESTED |
| H4 | `rejectUnauthorized: true` is the only TLS option | held |
| H5 | TLS failures map through the existing `transportCode` and `CODE_SHAPE` unchanged | held |
| H6 | The new `leak-audit` fixtures pass with no product change | held |
| H7 | `enumerate-refusals` drops 41 → 40 | held |
| H8 | The `TEST-ONLY` private key triggers secret-scanning friction | **WRONG** — GitHub raised nothing |
| H9 | The suite grows by 10–20 checks | **WRONG** — it grew by 27 |
| H10 | At least one of H1–H9 is wrong | held — three are |

**H1's counting rule was undefined in the prediction and was ruled AFTER the
diff was known, which is the weakest moment to rule anything.** It is recorded
that way on purpose. The diff is +20 / −12; 9 of the 20 added lines are
comments. Counting added lines including comments, 20 > 15 and H1 is falsified.
Counting code alone it is 12, and H1 would hold. **The rule chosen — every added
line counts, comments included — is now standing for line-count predictions**,
and it was chosen against the author's interest, which is the only reason it
carries any weight. The scope half of H1 held exactly: `prepare.js` is the only
`src/core/` file touched.

**H3 held but is not fully tested.** `Host` never needed an edit, and the TLS
captures show `Host: localhost:<port>`. The case the prediction was really about
— that an `https://` URL on the default port yields `Host: api.example.com` with
no `:443` — **is checked by reading `src/core/url.js`, not by a test**. Nothing
in the suite sends to port 443. Recorded as a gap rather than claimed as
verified.

**H9 is the fifth consecutive underestimate of size.** 10–20 was predicted;
27 checks and 3 leak fixtures arrived. The pattern is now long enough to be a
finding about the estimator, not about any one release.

## What the pre-registration did not foresee

**A test had to move BEFORE the product changed.** `test/wire.mjs` exercised
`send`'s protocol guard with an `https://example.com` request. Once `send` could
speak HTTPS, that row would have gone out to the internet. It now hands `send` a
hand-written `ftp://` request, which is the only way anything reaches that guard
now that the core refuses every other scheme. Same property, same count.

**`--help` said `run` refuses HTTPS, and stayed wrong for one commit.** The
sweep before D3 covered the README and the tests but not `src/`. `a45f28e`
fixed it. **No check reads that string**, which is the `main.jsx:224` family
again: prose inside source that no test can see.

**The upload page put files in the wrong directory twice, and the breadcrumb
check passed both times.** A dragged folder was flattened into `test/`; a file
uploaded from `test/` landed in `test/tls/`. Later, a typed path produced
`run-tls.msj`. All three were caught by sha-pinned verification after each
commit, and each cost one extra commit. **The check came before the action and
still verified the wrong thing** — the breadcrumb shows where you are, not where
the upload writes.

**`main` was broken for nine days before this release started.** `fc9ff7a`
overwrote `test/selftest.mjs` with another project's file, so `npm test` could
not pass and nothing could be published. Found by diffing the `v0.3.0` tag
against `main`, not by any check. The only workflow runs on manual dispatch.
**A CI workflow running `npm test` on push is open and deliberately not in this
release.**

## Carried, and stated in the release notes

- **`send` has no timeout.** TLS adds a new way to hang: a handshake against a
  silent host waits indefinitely. `SPEC.md` lists timeout under exit 3, and
  nothing implements it.
- **No proxy support, no HTTP/2, no client certificates.** None of these existed
  for plain HTTP either.
- **No port-443 `Host` test** (H3 above).
- **The `--json` document still has no version of its own.**
- **P6, a punycode host in `Host`**, still needs a non-loopback environment.
