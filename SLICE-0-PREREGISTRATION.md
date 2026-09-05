# Slice 0 — pre-registration

**Written 2026-09-04, BEFORE the harness was written and before anything was
run.** Section 4 is frozen. Do not edit predictions during the run; record what
happened beside them and mark each right or wrong.

This exists because an unpredicted result is far too easy to rationalise
afterwards. On the previous project the most useful line in the evidence file
was a wrong prediction, and it was only useful because it had been written down
first.

---

## 1. What slice 0 decides

**Whether reqtrail is built at all.** It is a falsifier, not a feature, and it
has a live Stop outcome.

The claim under test:

> reqtrail shows the effective request it hands to the transport — method, URL
> and headers — and where every substituted value came from. What it shows is
> checked against what a receiver actually recorded.

Everything settled in `handoffs/reqtrail/SPEC.md` on 2026-09-04 — the contract,
normalize-before-display, refusing unresolved templates, the provenance
transformation column — is a **prediction that displayed and captured can be
made to agree**. This is where that prediction meets a wire.

**No product packaging.** No CLI surface, no `init`, no file format polish. The
harness may be ugly. It is thrown away or frozen, not shipped.

## 2. The receiver, and the one constraint that is not negotiable

**The receiver records RAW HTTP/1.1 BYTES.** `net.createServer`, read the socket
until the header block terminator, keep the buffer verbatim.

**It must not be `http.createServer`.** A parsed request object cannot prove
header casing, ordering or repeated occurrences — which are exactly the
properties under test. Node's `rawHeaders` preserves more than most, but the
request line and framing are still parsed and normalized before you see them.
**Using a parsed server here would produce a green result that proves nothing**,
and it would be an easy mistake to make, because the test would still look like
it was passing.

This is the same failure mode as F15 in `import-fidelity-spike`, where the
harness's own serialization was mistaken for the tool's behaviour. That cost a
finding. Do not repeat it one project later.

The receiver replies with a fixed minimal response. Its behaviour is not under
test.

## 3. The fixture

One GET. Base case carries, deliberately, every property the contract claims:

- one ordinary collection variable, used in the URL
- one `$env` reference, used in a header
- a duplicate header pair — `X-Tag: alpha`, `X-Tag: beta`
- one empty header value
- one header whose value is literal text plus a substitution

Adversarial pass, each run separately so a failure is attributable:

    quotes ' "        backticks `      dollar $        backslash \\
    newline \\n        CR \\r            NUL \\0
    non-ASCII path    non-ASCII host   percent literal %
    space in path     space in query   trailing slash
    dot segments      default port     uppercase host
    missing env var   set-but-empty env var

## 4. PRE-REGISTERED PREDICTIONS — frozen

Confidence is recorded so that a wrong high-confidence call reads as a bigger
miss than a wrong low-confidence one.

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| P1 | Method, URL and header values in the prepared view match the capture byte-for-byte on the base fixture | high | any difference |
| P2 | Duplicate headers survive as two occurrences, in file order | medium-high | combined into one, or reordered |
| P3 | An empty header value is transmitted as an empty value, not dropped | **medium** | the header is absent from the capture |
| P4 | Header NAMES are lowercased on the wire, so the displayed casing differs from the captured casing | **medium-low** | casing preserved, or some other transform |
| P5 | A non-ASCII path displays and captures identically as percent-encoded | high | any difference |
| P6 | A non-ASCII host appears as punycode in the captured `Host` header | medium | anything else |
| P7 | A space in path and in query is `%20` in both view and capture | high | any difference |
| P8 | The runtime adds exactly `Host`, `Connection`, `Accept`, `Accept-Encoding`, `User-Agent` and nothing else | **medium** | any additional header appears |
| P9 | The generated POSIX cURL command produces a capture semantically equal to reqtrail's own send | medium | any semantic difference |
| P10 | No resolved secret value appears anywhere in reqtrail-generated output | high | it appears anywhere |
| P11 | A missing env var causes `run` to refuse, exit 1, and send nothing — the receiver records no connection | high | anything reaches the receiver |
| P12 | A set-but-empty env var is sent as an empty value with a warning | medium | refused, or sent as the literal reference |
| P13 | CR, LF or NUL in a substituted header value is refused by reqtrail, naming field path and variable, before the transport sees it | high | undici raises it instead, or it is sent |

### P14 — the one I most expect to be interesting

**Whether header ORDER across distinct names is preserved.** P2 covers
duplicates of the same name. This is different: given `authorization`, `x-tag`,
`accept-language` in file order, does the capture show that order?

Prediction: **not guaranteed** — the transport may reorder distinct names, and
nothing in HTTP requires otherwise. Confidence: low.

**Why it matters more than it looks.** If order is not preserved, the canonical
model's ordered-array decision is still right for import fidelity, but the
*displayed* order is not a property of the request as sent, and the contract in
SPEC must say so. That is a spec change, not a bug fix.

### P15 — the prediction about the predictions

**At least two of P1–P13 will be wrong.** Sitting E ran 13 predictions and got
12 right, and that was a UI pass on code already written. This is transport
behaviour nobody here has measured. If all thirteen come back right, the more
likely explanation is that the harness is not testing what it claims — **check
the receiver before celebrating.**

## 5. Outcomes

**Go** — the prepared view matches captured semantics across the base fixture
and the adversarial set, with any differences confined to the transport-generated
list in SPEC's contract.

**Qualify** — it matches with stated exceptions. Record each exception; the
claim narrows to what survives, and SPEC's claim sentence is rewritten before
any further code.

**Stop** — transport behaviour makes the promise too qualified to state
honestly. The differentiator is gone and the CLI is not built. **This outcome is
live and is not a formality.**

## 6. Recording

    Date / Node version / OS
    Receiver: raw socket = yes/no        (if no, STOP — the run is void)
    P1-P13:  right / wrong / not reached, each with the captured bytes
    P14:     order preserved = ?
    P15:     how many of P1-P13 were wrong = ?
    Outcome: Go / Qualify / Stop
    Exceptions, if Qualify: listed individually

**A wrong prediction is a result, not a failure.** Record it as wrong and keep
the original text.

## 7. After the run

- Transcribe into an evidence file, wrong predictions and their original wording
  included.
- If Qualify: rewrite SPEC's claim sentence to what survived, before writing any
  further code. The claim is the product; a claim that outran the evidence is
  the failure mode this whole document exists to prevent.
- If Stop: record it and stop. The name stays published, the spec stays as the
  record of a question answered.
- Re-check the two-week kill criterion against the v0 table as it now stands. It
  grew through 2026-09-04 — capture parity, selftest, timeout, the ordered header
  model, concrete response handling. **If the remaining work does not look like
  two weeks, the criterion has fired, and the answer is to cut scope rather than
  to re-estimate.**
