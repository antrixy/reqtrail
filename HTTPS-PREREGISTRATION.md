# HTTPS in `run` — pre-registration

**Written before the change and before it was run. Section 4 is frozen from the
commit that adds this file.** Baseline `eaff15cf96d1a9428de72bc1380e2cb8fa8001d6`
(`main` after the 2026-09-22 repair of `fc9ff7a`), codeload archive sha256
`1044ffbf182a215e597e8078d633753e71a082e14d577cc3aed32ab323e83655`. The tree is
file-for-file identical to `9a48358`; `npm test` on a clean checkout exits 0.

Scope ruled 2026-09-22: **the next release is HTTPS in `run`, plus `leak-audit`
fixtures for the channels a send opens. Nothing else.** This cuts the 0.4.0
scope in `decisions.md`, which bundles `node:https`, response-handling limits
and the UI redesign. Those become later releases, each with its own
pre-registration. The `decisions.md` entry recording the cut is still to be
written; this file does not substitute for it.

## 1. The divergence

**`resolve` shows `https://` requests. `run` refuses them.** Since 2026-09-08
the refusal is honest: `transport.unsupported`, path `url`, exit 1. But it is
still a refusal, and **every product example in the README uses HTTPS**. The
first `run` a new user attempts is refused.

The reason is that `node:https` has been carried deliberately as a gap for two
releases. `src/transport/http.js` refuses any protocol other than `http:`, and
`src/core/prepare.js` refuses `https:` before it reaches the transport.

## 2. The change, stated as properties of OUTPUTS

**P-WIRE extends to TLS, unchanged.** For every request in the corpus, the bytes
a receiver captures agree with the exact request the core built: method, target
and the header block as an ordered sequence of name/value pairs. **The receiver
terminates TLS and does not parse HTTP.** A receiver that parses before
comparing cannot check P-WIRE over TLS any better than over plain HTTP.

**P-VERIFY, new.** reqtrail never completes an HTTPS send without verifying the
server's certificate. There is no option, flag, workspace field or code path
that disables verification, **and ambient process state cannot disable it
either.** Node honours `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide. Measured
2026-09-22 on Node 22: with that variable set, a default `https.request` to a
self-signed server returned `204`, while the same request with an explicit
`rejectUnauthorized: true` failed `DEPTH_ZERO_SELF_SIGNED_CERT`. **The explicit
option wins over the environment.** P-VERIFY therefore costs one option and
invents no policy.

**P-CONTAIN is unchanged and covers the new channel.** A TLS failure reaches
every public surface as a symbolic code only. Node's TLS errors carry the
hostname in `e.message` and certificate details in `e.host` and `e.cert`, and a
hostname can be a secret (`https://{{$env.H}}/p`). `transportCode` already
copies only `e.code`, shape-checked. This release claims that property holds
for TLS errors, and adds fixtures to prove it rather than assuming it.

**Exit code 3 covers TLS failures, as `SPEC.md` already says.** Bytes were
attempted: a ClientHello went out. An untrusted certificate is not transient
and has no workspace edit that fixes it. That fits the documented meaning,
*nothing to edit; may be transient*, because "may" still holds.

## 3. The design, ruled before increment 2

**D1. Tests trust the test server through `NODE_EXTRA_CA_CERTS`, set on a child
process running the real binary.** The fixture is one committed, self-signed
certificate and key for `localhost`, used as its own trust anchor. Measured
2026-09-22: `NODE_EXTRA_CA_CERTS` pointing at a self-signed leaf is sufficient.
**No trust parameter is added to `send`, the CLI or the workspace.**

- **Rejected: a `ca` parameter on `send`.** Only tests would use it, so it
  would be a code path users never run and mutation testing would reach. It
  would also be one edit away from an insecure option.
- **Rejected: generating the certificate at test time with `openssl`.** That
  adds a system dependency the suite does not have today, and it is absent on
  stock Windows.
- **Cost, stated plainly:** a committed private key. It lives under
  `test/tls/`, both files are named `TEST-ONLY-*`, and it is valid for
  `localhost` only. Its expiry is a time bomb, so a selftest check reads
  `notAfter` through `crypto.X509Certificate` and fails well before it arrives.

`NODE_EXTRA_CA_CERTS` is ambient state that ADDS trust. For users this is a
feature, since a corporate CA works with no reqtrail option. It is named here
because P-VERIFY is about disabling verification, not about who is trusted.

**D2. `rejectUnauthorized: true` is passed explicitly on every HTTPS request.**
This is transport configuration, not request content. The header block rule in
`src/transport/http.js` (adds nothing, drops nothing, reorders nothing) is
untouched. A selftest check forbids `rejectUnauthorized` with any value other
than the literal `true` anywhere under `src/`.

**D3. `transport.unsupported` is deleted from `run`, not kept for other
schemes.** `src/core/url.js` already refuses every protocol except `http:` and
`https:`, so the refusal becomes unreachable once `https:` is allowed. `send`
keeps its own guard for anything outside those two, because it is exported and
`run` is not the only way in.

### Order of work — one commit per increment, each verified before the next

1. **This file.**
2. **The oracle first, as 0.3.0 did.** The `test/tls/` fixture, the `notAfter`
   check, and a TLS-terminating raw receiver in `test/`. **`slice0/` is not
   edited** — its bar for edits is stated in `slice0/README.md`. No product
   code changes.
3. **The transport.** Add the `https:` branch in `send` with D2, and P-WIRE-over-TLS
   rows that drive `send` in a child process under D1. `run` still refuses
   HTTPS, so nothing a user sees changes.
4. **`run` sends HTTPS.** Apply D3. End-to-end rows through the real binary:
   trusted certificate exits 0, untrusted exits 3, altname mismatch exits 3, and
   untrusted **with `NODE_TLS_REJECT_UNAUTHORIZED=0` set** still exits 3.
5. **`leak-audit` fixtures** for a secret in `Host` and a secret hostname
   through a TLS failure. Both have been carried as open since 0.3.0.
6. **Docs, evidence document and release**, following `RELEASE.md`.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| H1 | The `https:` branch adds **at most 15 lines** to `src/transport/http.js`, and increments 3–4 change **no file in `src/core/` other than `prepare.js`** | medium-high | more lines, or any other `core/` file changes |
| H2 | `node:https` accepts the flat ordered header array exactly as `node:http` does, and **every existing P-WIRE row passes over TLS with no row edited** | medium-high | any row differs over TLS, or needs editing to pass |
| H3 | `Host` needs no change: the normalized href already omits `:443`, so `https://api.example.com` yields `Host: api.example.com` | high | `Host` carries `:443`, or its derivation is edited |
| H4 | `rejectUnauthorized: true` is the **only** TLS option `send` sets — no `servername`, `ca`, `agent` or `minVersion` | medium | any other TLS option is added |
| H5 | TLS failures map through the existing `transportCode` and `CODE_SHAPE` unchanged, and render as `not sent: <code>` with exit 3 | medium-high | a TLS code fails `CODE_SHAPE`, or the mapping is edited |
| H6 | The new `leak-audit` fixtures **pass on first run with no product change**, because containment is structural (codes only) | medium | a product change is needed for them to pass |
| H7 | `enumerate-refusals` drops from 41 to **40**, because D3 deletes a refusal and adds none | medium-high | any other count |
| H8 | Uploading the `TEST-ONLY` private key through the GitHub web UI **triggers secret-scanning or push-protection friction** | low-medium | the upload goes through with no warning |
| H9 | The suite grows by **10–20 checks** across all files | medium | growth outside that range |

**H10, the meta-prediction: at least one of H1–H9 is wrong.**

**Confidence: medium.** This meta-prediction was wrong five sittings running by
overestimating the error rate, then right on the sixth (0.2.0: B2 and B8), then
right again for 0.3.0 (T1 was falsified). Two hits after five misses is still
not calibration.

**Contamination, declared.** Two facts in Sections 2–3 were measured before
this file was written: explicit `rejectUnauthorized: true` overriding the
environment variable, and `NODE_EXTRA_CA_CERTS` trusting a self-signed leaf.
**No prediction above is about either of them.** They are design facts that D1
and D2 rest on, and the probe used a standalone script, not the product.

## 5. Explicitly NOT in this change

- **Response-handling limits.** Settled in `SPEC.md`, still unimplemented. They
  get their own release. The carried 413 mutation gap goes with them.
- **The UI redesign**, rulings 7–10 in `decisions.md`. Its own release, with the
  browser sitting inside it.
- **A send timeout.** `send` has none today, and a TLS handshake to a silent
  host adds a new way to hang. `SPEC.md` lists timeout under exit 3. **Carried
  as a known gap and stated in the release notes**, not absorbed here.
- **Proxies, HTTP/2 and client certificates.** None exists for plain HTTP
  either.
- **Any way to skip certificate verification.** Not deferred: ruled out by
  P-VERIFY.
- **P6, punycode host in `Host`.** HTTPS does not change what it needs, which is
  a non-loopback environment.
- **A version for the `--json` output document.** Still open.
- **Re-resolve in the UI.** Unchanged.

## 6. What would stop this release

- **P-WIRE fails over TLS and the cause is in the core.** Then the exact request
  is not what goes out under TLS, which falsifies an earlier release's claim
  rather than this one's. **Record it and stop.**
- **Verification cannot be made unconditional** — some code path, environment
  variable or Node version completes a send against an untrusted certificate
  despite D2. P-VERIFY is the release; ship without it and the release is a
  regression.
- **The test fixture cannot be committed cleanly** (H8 at its worst: blocked
  with no bypass). Then re-scope D1 before writing any product code; do not fall
  back to a trust parameter on `send`.
- **The work exceeds roughly one week.** Cut scope, do not re-estimate. Cut the
  `leak-audit` increment before any P-VERIFY row.
