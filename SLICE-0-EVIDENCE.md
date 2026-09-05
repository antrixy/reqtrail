# Slice 0 — evidence

**Run 2026-09-04.** Predictions frozen in `SLICE-0-PREREGISTRATION.md`, committed
before the harness was written.

    Node v22.22.2 · Linux
    Receiver: raw socket (net.createServer)  = yes
    Outcome: GO, with two rows NOT REACHED

---

## Outcome

**GO.** Across the base fixture and the adversarial set:

- **9 sendable cases: display == capture, exactly.** Byte-for-byte on
  method, request target and header block.
- **7 refusals: nothing reached the wire.** Verified by capture count, not by
  the absence of an error.

**Two rows NOT REACHED, and the Go is qualified by them:** P6 (punycode host,
untestable against `127.0.0.1`) and **P9 (`--as-curl` parity, not built)**. P9
is listed in the pre-registration as step 6 of the run. **It remains a condition
on the claim, not an omission to forget** — the claim says the view is checked
against a receiver, and the cURL renderer is a second producer of that view.

---

## THE HEADLINE FINDING — the transport is a product decision

**`fetch` cannot express reqtrail's canonical model.**

Sending the base fixture through `fetch` with `Headers.append`:

    X-Tag: alpha  +  X-Tag: beta   ->   captured as   "X-Tag: alpha, beta"

One header, comma-joined. And `fetch` injected four headers the user never
wrote: `accept`, `accept-encoding`, `user-agent`, `sec-fetch-mode`.

The same fixture through `node:http`:

    X-Tag: alpha
    X-Tag: beta            two occurrences, in file order
    Authorization          casing preserved
    X-Empty:               empty value transmitted
    runtime added: Host, Connection    — and nothing else

**Consequence.** The ordered, duplicate-preserving header array decided on
2026-09-04 — the correction that came out of `import-fidelity-spike`'s
duplicate-collapse finding — **is unrepresentable through `fetch`.** A reqtrail
built on `fetch` would display two headers and send one, which is precisely the
defect the product exists to prevent.

**The transport is therefore part of the contract, not an implementation
detail**, and belongs in SPEC.

---

## A FALSE FINDING WAS NEARLY RECORDED

The first run showed P2 falsified — duplicates collapsing — and the available
conclusion was *HTTP does not preserve duplicate header names*. **That would
have been wrong.** A follow-up probe through `node:http` distinguished *the
transport cannot* from *this harness cannot*.

**This is the F15 failure mode from `import-fidelity-spike`**, where the
harness's own serialization was mistaken for the tool's behaviour. §2 of the
pre-registration warned about it and put the guard on the **receiver**. It
appeared in the **sender** instead.

**The lesson generalises past where it was aimed.** A harness is a chain of
components, and any one of them can normalize. The receiver guard was correct
and insufficient: *check every component that touches the artifact, not the one
where the last mistake happened.*

---

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| P1 | Method and URL match capture | **right** — `/users/42?q=a%20b` both sides |
| P2 | Duplicates survive in order | **right**, on `node:http`. Wrong on `fetch` — see above |
| P3 | Empty header value transmitted, not dropped | **right** |
| P4 | Header names lowercased on the wire | **WRONG** — casing preserved |
| P5 | Non-ASCII path percent-encoded in both | **right** — `/caf%C3%A9` |
| P6 | Non-ASCII host as punycode in `Host` | **NOT REACHED** |
| P7 | Space is `%20` in both | **right** |
| P8 | Runtime adds exactly Host, Connection, Accept, Accept-Encoding, User-Agent | **WRONG** — `node:http` adds two: Host, Connection |
| P9 | `--as-curl` reaches the same captured result | **NOT REACHED** — renderer not built |
| P10 | No secret in reqtrail-generated output | **right** |
| P11 | Missing env var refuses, exits 1, sends nothing | **right** — receiver recorded no connection |
| P12 | Set-but-empty sent as empty with a warning | **right** |
| P13 | CR/LF/NUL refused before the transport sees it | **right** — refused at `headers[0]`, no bytes sent |
| P14 | Header order across distinct names preserved | **right** |
| P15 | At least two of P1–P13 wrong | **right** — exactly two |

**P4 being wrong is good news**: casing survives HTTP/1.1, so displayed casing
is a property of the sent request and the contract can claim it. Had it been
right, SPEC would have needed a display-vs-sent caveat.

### A conduct note on P8

**The expected header list was edited mid-run to match `node:http`'s behaviour**,
which is changing the assertion to fit the result. The prediction as written
named five specific headers; reality is two. **P8 is recorded as falsified and
the edit is not kept.** Noted because the edit felt like a correction at the
time and reads as one in the diff.

---

## The adversarial set, in full

**Sent, display == capture:** space in query · quote + backtick · dollar +
backslash · non-ASCII path · percent literal · dot segments · trailing slash ·
fragment · set-but-empty env.

    a'"`b       -> /x?q=a%27%22`b       both sides
    a$b\c       -> /x?q=a$b\c           both sides
    café        -> /caf%C3%A9           both sides
    100%        -> /100%                unchanged, both sides
    /a/../b     -> /b                   collapsed, both sides
    /a#frag     -> /a                   fragment dropped with a warning

**Refused, zero bytes on the wire:** CRLF in header · NUL in header · missing
env var · nested template · unmatched braces · whitespace in reference ·
undefined variable. Each named a field path and a cause.

**`/100%` is worth noting** — it is *not* percent-encoded by the URL layer and
survives verbatim. A trailing bare `%` is the case most likely to break a naive
re-encoder later.

---

## What this does and does not establish

**Established:** the prepared view can be made to match a captured request
across an adversarial set, and every refusal is deterministic and pre-wire. The
claim is true for GET, one variable scope, and one secret namespace, **on
`node:http`**.

**Not established:** that anyone wants it. Slice 0 answers whether the claim is
true, never whether it is wanted. That remains the largest risk and no further
specification reduces it.

**Next, before the two-week clock is trusted:** re-check the kill criterion
against the v0 table as it now stands. It grew through 2026-09-04 — capture
parity, selftest, timeout, the ordered header model, concrete response handling,
and now a transport constraint. If the remaining work does not look like two
weeks, the criterion has fired, and the answer is to cut scope rather than to
re-estimate.
