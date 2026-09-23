# 0.4.1 honesty patch — pre-registration

**Written before the change and before it was run. Section 4 is frozen from the
commit that adds this file.** Baseline `bb0b6034ca6b748d756baed96c05ff5dc6b8bd18`
(`main`, 0.4.0), codeload archive sha256
`3d820db34d2e5e1f3df4ac64ecaa61af2832b07e4572fdf1759689485252e74a`. `npm ci &&
npm test` on a clean extraction exits 0 on Node 22.22.2: refusals 40/40,
selftest 201/201, ui 27/27, parity 7/7, server 51/51, server-slow 2/2, wire
22/22, wire-tls 16/16, run-tls 12/12.

Scope ruled 2026-09-23, from the second-pass architecture review and its
reproduction against this baseline: **0.4.1 fixes places where ReqTrail's
output says something untrue or unsafe, and touches no transport code.** The
execution boundary (display before send, delivery state, deadline, EPIPE),
the exact transport request (bare `?`, IPv6, framing headers) and the
provenance rewrite are later releases, each with its own pre-registration.
The `decisions.md` entry recording this sequence is still to be written; this
file does not substitute for it.

## 1. The divergences

Each was reproduced against the baseline before this file was written.

1. **A carriage return reaches the terminal.** `src/core/errors.js:29` escapes
   C0 except tab, LF **and CR**. An unknown key `x\rFAKE: all good` writes a raw
   CR to stderr, so a workspace can overwrite the start of the line. Unicode
   bidi controls (U+202E) also pass through raw. `test/leak-audit.mjs:154`
   uses a copy of the same regex, so the oracle cannot see what the
   implementation leaves out.
2. **A diagnostic discloses a secret by code point.** A secret `Ā` in a header
   gives `header.charset` with `"U+0100"`. For a one-character secret that is
   the whole value.
3. **The projection masks bytes that are not sent.** A zero-length secret
   range still inserts `••••`: an empty secret shows `?k=••••` when `?k=` is
   sent, and a secret `#secret` appended to a path shows
   `https://example.com/a••••` when nothing is sent after `/a`.
4. **Userinfo is displayed and dropped.** `http://user:pw@host/p` is shown with
   its credentials; the receiver saw no userinfo and no `Authorization`.
5. **Invalid UTF-8 becomes a different request.** A raw `0x80` in the URL is
   read as U+FFFD and resolves to `http://example.com/%EF%BF%BD`, exit 0.
6. **The UI does not say it is a snapshot.** It serves the startup text for its
   lifetime. The planning handoff ruled the copy must say so; it does not.
7. **Release identity has a stale third copy.** `package-lock.json` says 0.1.0
   in the document root and in `packages[""]`.
8. **Smaller untrue sentences.** Root-level refusal paths begin with a dot
   (`.oops`); the README says `ui` "opens" a browser (it prints a URL); the token
   "reaches no log" (it is printed to the terminal); `server.js` lists "uniform
   JSON errors" (node's parser answers 431 before the handler, without the
   envelope).
9. **One wire row depends on the machine's DNS.** `test/wire.mjs:124-129`
   expects `ENOTFOUND` for `secret-host.invalid`; a resolver or proxy that
   answers makes it fail with no product defect. CI jobs have no timeout.

## 2. The change, stated as properties of OUTPUTS

**P-TERMINAL, strengthened.** No human-channel output contains a code point in
`\p{Cc}` other than LF and tab, or in `\p{Bidi_Control}`, `\p{Zl}` or `\p{Zp}`,
whatever the workspace, environment or arguments contain.

**P-CONTAIN, extended to equivalent forms.** A refusal caused by a secret's
content names the reference and never a property derived from the value: code
point, byte, character or length.

**P-SHOWN-IS-SENT, narrowed to what this patch can make true.** Every
`••••` in a projection stands for at least one byte that would be sent. A URL
component that would not be sent (userinfo) is refused rather than shown.

**P-BYTES.** A workspace is either valid UTF-8 read byte-for-byte, or refused
before JSON parsing. No replacement character is ever introduced by reading.

## 3. The design, ruled before increment 2

**D0. The version is 0.4.1, although two files that resolved under 0.4.0 now
refuse.** Both were being processed wrongly: userinfo was shown and not sent,
and invalid UTF-8 was rewritten into a request the file does not express.
Refusing them fixes a false output, which is a bug fix. **Rejected: 0.5.0**,
which would imply a feature and renumber the planned releases for no gain. The
release notes name both refusals.

**D1. Decoding moves into the core.** `parse.js` gains `decodeWorkspace(bytes,
source)` using `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`, and
throws refusal `workspace.encoding` with no values. The CLI reads a Buffer and
calls it once; `ui` receives the decoded text from the same call, so `resolve`
and `ui` cannot decode differently. Exit 1: the file must be edited.
**`ignoreBOM: true` keeps today's BOM behaviour** — a BOM stays in the text and
`JSON.parse` refuses it as `schema.json`, as in 0.4.0. Accepting BOMs is a
relaxation for a later release; relaxing later breaks nothing.

**D2. The escape set gains CR and the direction and line-structure controls.**
Added to `CONTROL` as explicit ranges: `\u000d`, `\u061c`, `\u200e-\u200f`,
`\u202a-\u202e`, `\u2066-\u2069`, `\u2028-\u2029`. **ZWJ and ZWNJ (U+200C, U+200D)
are deliberately not escaped**: they are required by several scripts and by
emoji, and they cannot reorder text. The leak-audit oracle is rewritten with
Unicode property escapes (P-TERMINAL above) so it shares no text with the
implementation. The CLI argument echoed in the `ui` banner goes through the
same escape.

**D3. A zero-length range is never masked.** One condition in `maskRanges`.
The projection then shows exactly what is sent; the provenance row and the
`env.empty` warning still record that a secret was there and was empty. This
fixes the empty-secret case and the phantom fragment mask with one rule. The
fragment policy itself is the provenance release's.

**D4. Userinfo is refused as `url.userinfo`**, in `parse()` in `url.js`, with no
values, because userinfo can come from a secret. It applies whether the
userinfo is literal or substituted. Supporting it needs authentication
semantics, which is not this patch.

**D5. `header.charset` names a code point only when no secret carries one.**
When the culprit is a secret, the refusal names the reference with a template
that has no `$codepoint` slot. When the culprit is a collection variable, the
code point is taken **from that variable's value**, not from the first bad
character in the whole header. Today a literal earlier in the value can supply
the code point while the message blames the variable.

**D6. The snapshot is stated where it is seen.** The `ui` startup banner, the UI
header and the README each say the file is read once at startup and the UI
must be restarted after editing it. Change detection is a later release.

**D7. Release identity is four places, all checked.** Lockfile root and
`packages[""]` are corrected, and the selftest version check compares
`VERSION`, `package.json` and both lockfile fields.

**D8. Root paths have no leading dot.** `only(obj, allowed, "")` yields `oops`,
not `.oops`. The reversible path format is the versioned-output release's.

**D9. The untrue sentences are narrowed, not the behaviour widened.** README:
`ui` prints a local URL to open. Token: kept out of HTTP requests and `Referer`,
but printed to the terminal that started the session. `server.js` row 7:
handler-generated errors use the JSON envelope; node's parser rejects some
requests before the handler. **Rejected: a `clientError` handler**, which would
add a response path at the parser boundary to make a comment true. The
planning spec's "deterministic serialization" line is corrected in
`project-planning`, in its own commit.

**D10. The wire row becomes hermetic without losing its point.** Its point is
that node puts the target in error prose and ReqTrail keeps only the code. The
secret hostname becomes `127.0.0.1` with a port taken from a listener that is
then closed. The prose `connect ECONNREFUSED 127.0.0.1:<port>` still carries
the secret, and the row asserts it is absent from the result. The ENOTFOUND
class loses its row; it returns with an injected resolver in the execution
release. The leak-audit `.invalid` fixture stays: its assertion (no leak)
holds whether DNS fails or something answers.

**D11. CI jobs get `timeout-minutes`**: 15 for `test`, 20 for `publish`.

### Order of work — one commit per increment, each verified before the next

For every increment, the new checks are first run against the baseline and
their failures recorded in the evidence file, so each oracle is shown to bite
before the fix lands.

1. **This file.**
2. **Terminal escaping (D2)** with the independent oracle, and CR and bidi
   fixtures in `leak-audit`.
3. **Secret-safe diagnostics and masks (D5, D3).**
4. **Userinfo refusal (D4).** The existing selftest check "Host excludes
   userinfo" is replaced by a refusal check. It is the only existing check this
   release rewrites, and it is rewritten because its input class is now
   refused (rule 9e), not to make it pass.
5. **Strict decoding and root paths (D1, D8).**
6. **Copy (D6, D9).**
7. **Release identity, hermetic wire row, CI timeouts (D7, D10, D11).**
8. **Mutants** for increments 2–5 in `test/mutate.mjs`, each targeting
   selftest or leak-audit, which the harness already runs.
9. **Evidence document and release**, following `RELEASE.md`.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| P1 | `enumerate-refusals` goes from 40 to **43**: `url.userinfo`, `workspace.encoding`, and the secret branch of `header.charset` | medium-high | any other count |
| P2 | **`src/transport/http.js` is not modified**, and `src/` changes touch at most `errors.js`, `exact.js`, `parse.js`, `prepare.js`, `url.js`, `cli/main.js`, `server/server.js` and `ui/main.jsx` | high | a transport change, or any other `src/` file |
| P3 | Exactly **one** existing check has its assertion changed (selftest "Host excludes userinfo"); every other existing check passes unedited | medium | any other existing check edited to pass |
| P4 | The independent oracle **fails on the baseline** for the CR fixture and the bidi fixture, and passes after D2 | high | it passes on the baseline for either |
| P5 | D3 is **one condition** in `maskRanges` and changes no test except additions | medium-high | more than one condition, or an existing check changes |
| P6 | Adding CR to the escape set changes **no existing human-output check**, because the renderers lay out with LF only | medium-high | any existing CLI or render check changes |
| P7 | A BOM-prefixed workspace is refused as `schema.json` both before and after D1 | high | any other outcome after D1 |
| P8 | Strict decoding changes the result of **no existing fixture**, because every fixture is valid UTF-8 | high | any existing row's output changes |
| P9 | Every new mutant from increment 8 is **killed on its first run** | medium | any mutant survives or is uncovered |
| P10 | The suite grows by **15–30 checks** across all files | medium | growth outside that range |

**P11, the meta-prediction: at least one of P1–P10 is wrong.**

**Confidence: medium.** Record: wrong five sittings running by overestimating
the error rate, then right for 0.2.0, 0.3.0 and 0.4.0 (HTTPS H10 held, with three
of H1–H9 wrong). Three hits after five misses is still not calibration.

**Contamination, declared.** Every divergence in Section 1 was reproduced
before this file was written, using standalone probes against the baseline's
own `resolveWorkspace`, `run` and binary. Also measured beforehand: that
`TextDecoder` with `fatal: true, ignoreBOM: true` keeps a leading BOM in the
text, and that `\p{Bidi_Control}` matches U+202E and U+2066 but not U+200D.
**No prediction above is about whether a divergence exists.** P4 is about the
new oracle, which has not been written.

## 5. Explicitly NOT in this change

- **Display before send, acknowledged output and EPIPE.** EPIPE still prints a
  stack in 0.4.1. A stopgap handler would be replaced by the output boundary
  in the execution release and could hide the ordering problem it must solve.
- **Delivery state, a total deadline, and resets after capture or mid-body.**
  The execution release.
- **The exact transport request**: bare `?`, IPv6 connect hostname, framing and
  upgrade headers. The next release.
- **Component-aware provenance**: scheme, port and fragment attribution, and the
  fragment sendability rule. Its own release.
- **Resource caps, exit code 4, duplicate-flag refusal, versioned JSON,
  reversible paths.** Later releases, as sequenced in the review response.
- **UI change detection and reload.** 0.4.1 only states the snapshot.
- **Mutation harness baselining, a Node matrix, tag-bound publishing.** Carried
  alongside later releases.

## 6. What would stop this release

- **Escaping CR or bidi controls changes a layout a user relies on** (P6 at its
  worst). Record it and rule on the renderer, not the escape set.
- **D3 changes what a secret's presence looks like in a way the leak audit
  treats as a leak.** Then the audit's model of masking is wrong; stop and
  resolve that before shipping.
- **Userinfo cannot be refused without naming its value** in some path. P-CONTAIN
  is the release's floor.
- **The work exceeds three sittings.** Cut increment 6 and ship increments 2–5
  and 7; the copy is the most deferrable part.
